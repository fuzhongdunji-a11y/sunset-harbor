// foodCourier: the Costa Food Delivery job. Drive to a lit restaurant, stop, take the insulated bag, run it to a customer before it goes cold; up to MAX_CHAIN drops in a row.
// States: IDLE -> TO_PICKUP -> TO_DROPOFF -> (next TO_PICKUP while the chain continues | CHAIN_PAID | FAILED) -> 20 s cooldown -> IDLE.
// Money routing (main.js pays exactly what the events carry, nothing else):
//   'dropPaid'  event: ev.reward is paid per drop. Hot (more than half the freshness timer left): PER_DROP + HOT_TIP + chain * CHAIN_BONUS, chain counts hot drops 1, 2, 3...
//               Warm (timer running but under half): PER_DROP flat, chain kept. Cold (timer expired): floor(PER_DROP / 2), chain reset to 0, the run continues.
//   'chainPaid' event: ev.pay (BASE_PAY) is paid ONCE, right after the MAX_CHAIN-th drop. A failed run keeps the drops already paid but never earns BASE_PAY.
// The freshness timer is FIXED at pickup: straight-line restaurant-to-customer distance / PAR_SPEED + 30 s, then counts down.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const FOOD_COURIER = {
  BASE_PAY: 100,
  PER_DROP: 180,
  CHAIN_BONUS: 150,
  HOT_TIP: 200,
  MAX_CHAIN: 4,
};

// Mission constants
const PICKUP_R = 6; // stop within 6 m of the restaurant ring
const PICKUP_SPEED = 1; // m/s: the car must be stopped (speed, not distance: the old draft reused PICKUP_R here)
const DROP_R = 8; // the customer ring triggers within 8 m
const MIN_DISTANCE = 150; // restaurant and customer at least 150 m apart
const PAR_SPEED = 14; // m/s: freshness timer = straight-line distance / 14 + GRACE
const GRACE = 30; // s added to the freshness timer
const OUT_LIMIT = 20; // s out of the car during TO_DROPOFF before failure
const COOLDOWN = 20;
const HANDOFF_TIME = 1.0; // s: bag to the car at pickup, customer to the car at delivery
const SITE_COUNT = 8; // restaurants/customers are drawn from this fixed, farthest-point-sampled anchor set
const SEA_Z = 330; // intersections south of this are beach/sea

// Rings share one geometry; each Marker owns its own mesh so it can sit at its own spot. Restaurant = warm orange, customer = teal-green.
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const ringMatFor = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
const restaurantMat = ringMatFor(0xff8a3d);
const customerMat = ringMatFor(0x14d6a0);

// Bag (insulated box + warm lid) and customer (three bright boxes), flat shaded, shared geometry/materials.
const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const bagBodyGeom = new THREE.BoxGeometry(0.46, 0.34, 0.3);
const bagLidGeom = new THREE.BoxGeometry(0.5, 0.1, 0.34);
const bagBodyMat = flat(0x2c3340);
const bagLidMat = flat(0xff7a2e);
const torsoGeom = new THREE.BoxGeometry(0.52, 0.7, 0.34);
const legsGeom = new THREE.BoxGeometry(0.46, 0.8, 0.3);
const headGeom = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const torsoMat = flat(0xff3d8b);
const legsMat = flat(0x2b6cff);
const headMat = flat(0xf0c9a0);

class Marker {
  constructor(scene, material) {
    this.mesh = new THREE.Mesh(ringGeom, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.baseY = 0;
    scene.add(this.mesh);
  }
  setPos(x, y, z) {
    this.baseY = y;
    this.mesh.position.set(x, y, z);
    this.mesh.visible = true;
  }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
  hide() {
    this.mesh.visible = false;
  }
}

// A short straight-line carry of a Group from one point to another over HANDOFF_TIME (same pattern as taxi.js's Passenger).
class Carrier {
  constructor(scene, group) {
    group.visible = false;
    scene.add(group);
    this.group = group;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.t = 0;
    this.active = false;
  }
  start(from, to) {
    this.from.copy(from);
    this.to.copy(to);
    this.t = 0;
    this.active = true;
    this.group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    this._place();
    this.group.visible = true;
  }
  // Jump to a fraction of the walk and hold there (used by the ?shot=courier staging).
  pose(from, to, t) {
    this.start(from, to);
    this.t = t;
    this.active = false;
    this._place();
  }
  _place() {
    this.group.position.lerpVectors(this.from, this.to, this.t);
  }
  // Returns true on the frame the carry finishes.
  update(dt) {
    if (!this.active) return false;
    this.t = Math.min(1, this.t + dt / HANDOFF_TIME);
    this._place();
    this.group.position.y += Math.abs(Math.sin(this.t * Math.PI * 3)) * 0.08;
    if (this.t >= 1) {
      this.hide();
      return true;
    }
    return false;
  }
  hide() {
    this.group.visible = false;
    this.active = false;
  }
}

function buildBag() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bagBodyGeom, bagBodyMat);
  const lid = new THREE.Mesh(bagLidGeom, bagLidMat);
  lid.position.y = 0.22;
  g.add(body, lid);
  return g;
}

function buildCustomer() {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(legsGeom, legsMat);
  legs.position.y = 0.4;
  const torso = new THREE.Mesh(torsoGeom, torsoMat);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.y = 1.67;
  g.add(legs, torso, head);
  return g;
}

export class FoodCourierService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    // Anchors are the road intersections of the generated grid (xs x zs), inland of the beach.
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < SEA_Z) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 4099 + 17);
    // Fixed anchor set (farthest-point sampled once, here): every restaurant and customer is one of these.
    this.sites = this._spreadSites(this.anchors, SITE_COUNT);
    this.state = 'IDLE';
    this.cooldown = 0;
    this.time = 0;
    this.restaurantMarker = new Marker(scene, restaurantMat);
    this.customerMarker = new Marker(scene, customerMat);
    this.bag = new Carrier(scene, buildBag());
    this.customer = new Carrier(scene, buildCustomer());
    this.activeRestaurant = null;
    this.activeCustomer = null;
    this.recent = []; // last few picked sites, so legs of one chain do not keep revisiting the same spots
    this.handing = false; // the bag is still being handed over
    this.chainCount = 0; // hot drops in a row (bonus multiplier)
    this.dropsDone = 0;
    this.earned = 0; // drop pay earned in the current run (HUD)
    this.timeTotal = 0; // freshness timer, FIXED at pickup
    this.timeLeft = 0;
    this.outTime = 0;
    this.carPos = null;
  }

  // Farthest-point sampling: start from a seeded random anchor, then repeatedly take the anchor farthest from everything picked.
  _spreadSites(list, n) {
    if (list.length === 0) return [];
    const picked = [this.rng.pick(list)];
    while (picked.length < Math.min(n, list.length)) {
      let best = null, bd = -1;
      for (const a of list) {
        const d = Math.min(...picked.map((p) => Math.hypot(a.x - p.x, a.z - p.z)));
        if (d > bd) { bd = d; best = a; }
      }
      picked.push(best);
    }
    return picked;
  }

  _groundY(x, z) {
    return (this.world.layout.groundHeightAt ? this.world.layout.groundHeightAt(x, z) : 0) + 0.08;
  }

  // Next leg: a restaurant from the site set (not one of the recent picks when there is a choice), then the customer by farthest-point
  // sampling among the sites at least MIN_DISTANCE away: the one farthest from everything recently used.
  _pickLeg() {
    if (this.sites.length < 2) return false;
    const fresh = this.sites.filter((s) => !this.recent.includes(s));
    const rest = this.rng.pick(fresh.length > 0 ? fresh : this.sites);
    let pool = this.sites.filter((s) => s !== rest && Math.hypot(s.x - rest.x, s.z - rest.z) >= MIN_DISTANCE);
    if (pool.length === 0) pool = this.sites.filter((s) => s !== rest); // tiny layouts only
    const pts = [rest, ...this.recent];
    let cust = pool[0], bd = -1;
    for (const a of pool) {
      const d = Math.min(...pts.map((p) => Math.hypot(a.x - p.x, a.z - p.z)));
      if (d > bd) { bd = d; cust = a; }
    }
    this.activeRestaurant = rest;
    this.activeCustomer = cust;
    this.recent = [rest, cust, ...this.recent].slice(0, 4);
    this.restaurantMarker.setPos(rest.x, this._groundY(rest.x, rest.z), rest.z);
    this.customerMarker.hide();
    return true;
  }

  // Put the service on the pickup of a given leg right away (used by the ?shot=courier staging).
  forceLeg(rest, cust) {
    this.activeRestaurant = rest;
    this.activeCustomer = cust;
    this.restaurantMarker.setPos(rest.x, this._groundY(rest.x, rest.z), rest.z);
    this.customerMarker.hide();
    this.state = 'TO_PICKUP';
    this.cooldown = 0;
  }

  // Skip straight to "bag aboard, heading for the customer" (used by the ?shot=courier staging).
  forcePickedUp(chain, dropsDone, timeLeft) {
    const c = this.activeCustomer;
    this.restaurantMarker.hide();
    this.customerMarker.setPos(c.x, this._groundY(c.x, c.z), c.z);
    this.timeTotal = this._timerFor(this.activeRestaurant, c);
    this.timeLeft = Math.min(timeLeft, this.timeTotal);
    this.chainCount = chain;
    this.dropsDone = dropsDone;
    this.earned = dropsDone * FOOD_COURIER.PER_DROP;
    this.handing = false;
    this.outTime = 0;
    this.state = 'TO_DROPOFF';
  }

  // Customer already stepping out toward the car (used by the ?shot=courier staging); t = fraction of the walk, frozen there.
  poseCustomer(carX, carZ, t) {
    const c = this.activeCustomer;
    const y = this._groundY(c.x, c.z);
    this.customer.pose(new THREE.Vector3(c.x, y, c.z), this._beside(c, carX, carZ, y), t);
  }

  _timerFor(rest, cust) {
    return Math.hypot(cust.x - rest.x, cust.z - rest.z) / PAR_SPEED + GRACE;
  }

  // A point 1.4 m short of the car on the line from `from` (so the figure stops beside the car, not inside it).
  _beside(from, carX, carZ, y) {
    const dx = carX - from.x, dz = carZ - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, d - 1.4) / d;
    return new THREE.Vector3(from.x + dx * k, y, from.z + dz * k);
  }

  targetPos() {
    if (this.state === 'TO_PICKUP' && this.activeRestaurant) return { x: this.activeRestaurant.x, z: this.activeRestaurant.z };
    if (this.state === 'TO_DROPOFF' && this.activeCustomer && !this.handing) return { x: this.activeCustomer.x, z: this.activeCustomer.z };
    return null;
  }

  _clearLeg() {
    this.restaurantMarker.hide();
    this.customerMarker.hide();
    this.bag.hide();
    this.activeRestaurant = null;
    this.activeCustomer = null;
    this.handing = false;
    this.outTime = 0;
  }

  // The run is over (chain complete or failed): cooldown, then IDLE.
  _finish(success) {
    this.state = success ? 'CHAIN_PAID' : 'FAILED';
    this.cooldown = COOLDOWN;
    this._clearLeg();
    this.chainCount = 0;
    this.dropsDone = 0;
    this.earned = 0;
    this.timeLeft = this.timeTotal = 0;
  }

  // ctx = { carPos, carSpeed, inCar, carDamageDelta, wrecked?, onEvent }. carDamageDelta is accepted for parity with taxi/photoTour but this job scores freshness, not damage.
  update(dt, ctx) {
    const { carPos, carSpeed, inCar, wrecked, onEvent } = ctx;
    this.time += dt;
    this.carPos = carPos;
    this.restaurantMarker.bob(this.time);
    this.customerMarker.bob(this.time);
    const bagDone = this.bag.update(dt);
    this.customer.update(dt);

    switch (this.state) {
      case 'IDLE':
        if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown <= 0) {
          this.chainCount = 0;
          this.dropsDone = 0;
          this.earned = 0;
          if (this._pickLeg()) this.state = 'TO_PICKUP';
        }
        break;

      case 'TO_PICKUP': {
        if (!inCar || Math.abs(carSpeed) >= PICKUP_SPEED) break; // must be stopped (< 1 m/s)
        const rest = this.activeRestaurant;
        if (Math.hypot(carPos.x - rest.x, carPos.z - rest.z) > PICKUP_R) break;
        // The freshness timer is fixed now from the straight-line distance; it starts counting once the bag is in the car.
        this.timeTotal = this._timerFor(rest, this.activeCustomer);
        this.timeLeft = this.timeTotal;
        this.outTime = 0;
        this.handing = true;
        const y = this._groundY(rest.x, rest.z) + 1.0;
        this.bag.start(new THREE.Vector3(rest.x, y, rest.z), new THREE.Vector3(carPos.x, y + 0.3, carPos.z));
        this.restaurantMarker.hide();
        this.state = 'TO_DROPOFF';
        if (onEvent) onEvent({ type: 'courier', phase: 'pickup', dropsDone: this.dropsDone, timeTotal: this.timeTotal });
        break;
      }

      case 'TO_DROPOFF': {
        if (this.handing && bagDone) {
          this.handing = false; // bag aboard: the customer ring comes up
          const c = this.activeCustomer;
          this.customerMarker.setPos(c.x, this._groundY(c.x, c.z), c.z);
        }
        if (!this.handing) this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (wrecked) { // a wrecked car ends the run (drop pay already paid stays; BASE_PAY is lost)
          this._finish(false);
          if (onEvent) onEvent({ type: 'courier', phase: 'failed', reason: 'wrecked' });
          break;
        }
        if (!inCar) {
          this.outTime += dt;
          if (this.outTime > OUT_LIMIT) {
            this._finish(false);
            if (onEvent) onEvent({ type: 'courier', phase: 'failed', reason: 'abandoned' });
          }
          break;
        }
        this.outTime = 0;
        const cust = this.activeCustomer;
        if (!this.handing && Math.hypot(carPos.x - cust.x, carPos.z - cust.z) <= DROP_R) this._deliver(carPos, onEvent);
        break;
      }

      case 'CHAIN_PAID':
      case 'FAILED':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown <= 0) this.state = 'IDLE';
        break;
    }
  }

  // Drop at the customer: judge freshness against the timer fixed at pickup, pay, then chain on (next restaurant at once) or end the run after MAX_CHAIN drops.
  _deliver(carPos, onEvent) {
    const cust = this.activeCustomer;
    const hot = this.timeLeft > this.timeTotal / 2;
    const cold = this.timeLeft <= 0;
    let reward;
    if (hot) {
      this.chainCount += 1; // increment first: the first hot drop already earns 1 x CHAIN_BONUS
      reward = FOOD_COURIER.PER_DROP + FOOD_COURIER.HOT_TIP + this.chainCount * FOOD_COURIER.CHAIN_BONUS;
    } else if (cold) {
      reward = Math.floor(FOOD_COURIER.PER_DROP / 2);
      this.chainCount = 0;
    } else {
      reward = FOOD_COURIER.PER_DROP; // warm: timer still running but past half; no tip, no bonus, chain untouched
    }
    this.dropsDone += 1;
    this.earned += reward;
    const y = this._groundY(cust.x, cust.z);
    this.customer.start(new THREE.Vector3(cust.x, y, cust.z), this._beside(cust, carPos.x, carPos.z, y));
    const done = this.dropsDone >= FOOD_COURIER.MAX_CHAIN;
    if (onEvent) onEvent({ type: 'courier', phase: 'dropPaid', reward, hot, cold, chain: this.chainCount, dropsDone: this.dropsDone });
    if (done) {
      this._finish(true);
      if (onEvent) onEvent({ type: 'courier', phase: 'chainPaid', pay: FOOD_COURIER.BASE_PAY });
      return;
    }
    this._clearLeg();
    this.timeLeft = this.timeTotal = 0;
    if (this._pickLeg()) this.state = 'TO_PICKUP'; // no cooldown between legs
    else this.state = 'IDLE';
  }

  // { visible, label, pay (drop pay so far this run), dropsDone, dropsTotal, chain (hot drops in a row), timeLeft/timeTotal (s, only during TO_DROPOFF), distanceLeft (m) }
  hudState() {
    if (this.state !== 'TO_PICKUP' && this.state !== 'TO_DROPOFF') {
      return { visible: false, label: '', pay: 0, dropsDone: 0, dropsTotal: FOOD_COURIER.MAX_CHAIN, chain: 0, timeLeft: 0, timeTotal: 0, distanceLeft: 0 };
    }
    const t = this.targetPos();
    const distanceLeft = t && this.carPos ? Math.hypot(t.x - this.carPos.x, t.z - this.carPos.z) : 0;
    const dropoff = this.state === 'TO_DROPOFF';
    return {
      visible: true,
      label: !dropoff ? 'FOOD: PICK UP' : this.handing ? 'FOOD: BAG ABOARD' : 'FOOD: DELIVER',
      pay: this.earned,
      dropsDone: this.dropsDone,
      dropsTotal: FOOD_COURIER.MAX_CHAIN,
      chain: this.chainCount,
      timeLeft: dropoff ? this.timeLeft : 0,
      timeTotal: dropoff ? this.timeTotal : 0,
      distanceLeft,
    };
  }
}
