// valetRush: the Marina Hotel Valet Parking job. Drive to a violet hotel ring, stop, hand the car to a guest, then park it in a bay ring; three parks in a row end the run.
// States: IDLE -> TO_HOTEL -> TO_BAY -> (next TO_HOTEL while parks remain | PAID | FAILED) -> 20 s cooldown -> IDLE.
// Money routing (main.js pays exactly what the events carry, nothing else):
//   'parked' event: ev.reward (PER_PARK = 250) is paid per park, including the third.
//   'paid'   event: ev.pay is paid ONCE after the third park = BASE_PAY + TIP_FAST (run time <= driven distance / 14) + TIP_CLEAN (run damage < 30). Max 600; a full run pays at most 3*250 + 600 = 1350.
//   A failed run (leg timer 0, wreck, >20 s out of the car) keeps the parks already paid but never earns the final event.
// The per-leg timer is FIXED at handover: straight-line hotel-to-bay distance / LEG_SPEED + LEG_GRACE, then counts down during TO_BAY only.
// Wreck is derived from ctx.carDamageDelta: damage summed over the active run reaching WRECK_DAMAGE (a car has 100 health) ends the run.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const VALET = {
  BASE_PAY: 150,
  PER_PARK: 250,
  TIP_FAST: 200,
  TIP_CLEAN: 250,
  MAX_PARKS: 3,
};

const HOTEL_R = 6; // stop within 6 m of the hotel ring
const HOTEL_SPEED = 1; // m/s: the car must be stopped
const BAY_R = 3; // park inside 3 m of the bay ring centre
const BAY_SPEED = 1; // m/s
const PARK_HOLD = 1.0; // s stopped inside the bay before the park counts
const HANDOFF_TIME = 1.0; // s the guest walks to the car
const LEG_SPEED = 12; // m/s: leg timer = straight-line distance / 12 + GRACE
const LEG_GRACE = 40; // s
const FAST_SPEED = 14; // m/s: TIP_FAST needs total run time <= total driven distance / 14
const CLEAN_DAMAGE = 30; // TIP_CLEAN needs total run damage below this
const WRECK_DAMAGE = 100; // run damage that counts as a wreck (full car health)
const OUT_LIMIT = 20; // s out of the car during TO_BAY before failure
const MIN_DISTANCE = 150; // hotel and bay at least 150 m apart
const COOLDOWN = 20;
const SITE_COUNT = 8; // hotels and bays are drawn from this fixed, farthest-point-sampled anchor set
const SEA_Z = 330; // intersections south of this are beach/sea
const JUMP_LIMIT = 60; // m: a one-frame move bigger than this (respawn) is not driven distance

// Rings share one geometry; both hotel and bay are violet.
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xc44dff, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });

class Marker {
  constructor(scene) {
    this.mesh = new THREE.Mesh(ringGeom, ringMat);
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

// Guest figure: three flat-shaded boxes, shared geometry/materials.
const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const torsoGeom = new THREE.BoxGeometry(0.52, 0.7, 0.34);
const legsGeom = new THREE.BoxGeometry(0.46, 0.8, 0.3);
const headGeom = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const torsoMat = flat(0x8e44ad);
const legsMat = flat(0x2c2540);
const headMat = flat(0xf0c9a0);

class Guest {
  constructor(scene) {
    const g = new THREE.Group();
    const legs = new THREE.Mesh(legsGeom, legsMat);
    legs.position.y = 0.4;
    const torso = new THREE.Mesh(torsoGeom, torsoMat);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.67;
    g.add(legs, torso, head);
    g.visible = false;
    scene.add(g);
    this.group = g;
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
  // Jump to a fraction of the walk and hold there (used by the ?shot=valet staging).
  pose(from, to, t) {
    this.start(from, to);
    this.t = t;
    this.active = false;
    this._place();
  }
  _place() {
    this.group.position.lerpVectors(this.from, this.to, this.t);
  }
  // Returns true on the frame the walk finishes.
  update(dt) {
    if (!this.active) return false;
    this.t = Math.min(1, this.t + dt / HANDOFF_TIME);
    this._place();
    this.group.position.y += Math.abs(Math.sin(this.t * Math.PI * 4)) * 0.08;
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

export class ValetRushService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    // Anchors are the road intersections of the generated grid (xs x zs), inland of the beach.
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < SEA_Z) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 6151 + 29);
    // Fixed anchor set (farthest-point sampled once, here): every hotel and bay is one of these.
    this.sites = this._spreadSites(this.anchors, SITE_COUNT);
    this.state = 'IDLE';
    this.cooldown = 0;
    this.time = 0;
    this.hotelMarker = new Marker(scene);
    this.bayMarker = new Marker(scene);
    this.guest = new Guest(scene);
    this.activeHotel = null;
    this.activeBay = null;
    this.recent = []; // last few picked sites, so legs of one run do not keep revisiting the same spots
    this.carPos = null; // last car position seen by update() (HUD distance)
    this.prevCarPos = null; // last in-car position (driven distance)
    this._resetRun();
  }

  // Everything that belongs to one run (reset on run start and on return to IDLE).
  _resetRun() {
    this.parksDone = 0;
    this.totalTime = 0; // s of the active run
    this.totalDistance = 0; // m driven in the car during the run
    this.totalDamage = 0;
    this.timeTotal = 0; // per-leg timer, FIXED at handover
    this.timeLeft = 0;
    this.outTime = 0;
    this.parkHold = 0;
    this.handing = false;
    this.prevCarPos = null;
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

  // Next leg: a hotel from the site set (not a recent pick when there is a choice); its bay is the site >= MIN_DISTANCE away that is farthest from everything recently used.
  _pickLeg() {
    if (this.sites.length < 2) return false;
    const fresh = this.sites.filter((s) => !this.recent.includes(s));
    const hotel = this.rng.pick(fresh.length > 0 ? fresh : this.sites);
    let pool = this.sites.filter((s) => s !== hotel && Math.hypot(s.x - hotel.x, s.z - hotel.z) >= MIN_DISTANCE);
    if (pool.length === 0) pool = this.sites.filter((s) => s !== hotel); // tiny layouts only
    const pts = [hotel, ...this.recent];
    let bay = pool[0], bd = -1;
    for (const a of pool) {
      const d = Math.min(...pts.map((p) => Math.hypot(a.x - p.x, a.z - p.z)));
      if (d > bd) { bd = d; bay = a; }
    }
    this.activeHotel = hotel;
    this.activeBay = bay;
    this.recent = [hotel, bay, ...this.recent].slice(0, 4);
    this.hotelMarker.setPos(hotel.x, this._groundY(hotel.x, hotel.z), hotel.z);
    this.bayMarker.hide();
    return true;
  }

  // Per-leg timer, FIXED at handover from the straight-line hotel-to-bay distance.
  _legTimer() {
    return Math.hypot(this.activeBay.x - this.activeHotel.x, this.activeBay.z - this.activeHotel.z) / LEG_SPEED + LEG_GRACE;
  }

  // A point 1.4 m short of the car on the line from `from` (so the figure stops beside the car, not inside it).
  _beside(from, carX, carZ, y) {
    const dx = carX - from.x, dz = carZ - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, d - 1.4) / d;
    return new THREE.Vector3(from.x + dx * k, y, from.z + dz * k);
  }

  // Put the service on the hotel of a given leg right away (used by the ?shot=valet staging and tests).
  forceLeg(hotel, bay) {
    this._resetRun();
    this.activeHotel = hotel;
    this.activeBay = bay;
    this.hotelMarker.setPos(hotel.x, this._groundY(hotel.x, hotel.z), hotel.z);
    this.bayMarker.hide();
    this.guest.hide();
    this.state = 'TO_HOTEL';
    this.cooldown = 0;
  }

  // Skip straight to "car handed over, heading for the bay" with parksDone parks behind us (used by the staging and tests).
  forceToBay(parksDone, timeLeft) {
    const b = this.activeBay;
    this.hotelMarker.hide();
    this.bayMarker.setPos(b.x, this._groundY(b.x, b.z), b.z);
    this.parksDone = parksDone;
    this.timeTotal = this._legTimer();
    this.timeLeft = Math.min(timeLeft, this.timeTotal);
    this.handing = false;
    this.outTime = 0;
    this.parkHold = 0;
    this.state = 'TO_BAY';
  }

  // Guest already stepping out toward the car, frozen at fraction t of the walk (used by the ?shot=valet staging).
  poseGuest(carX, carZ, t) {
    const h = this.activeHotel;
    const y = this._groundY(carX, carZ);
    // the guest starts 6 m from the car on the hotel side (the hotel itself can be hundreds of metres away in a staged frame)
    const dx = h.x - carX, dz = h.z - carZ;
    const d = Math.hypot(dx, dz) || 1;
    const from = new THREE.Vector3(carX + (dx / d) * 6, y, carZ + (dz / d) * 6);
    this.guest.pose(from, this._beside(from, carX, carZ, y), t);
  }

  targetPos() {
    if (this.state === 'TO_HOTEL' && this.activeHotel) return { x: this.activeHotel.x, z: this.activeHotel.z };
    if (this.state === 'TO_BAY' && this.activeBay) return { x: this.activeBay.x, z: this.activeBay.z };
    return null;
  }

  _clearMarkers() {
    this.hotelMarker.hide();
    this.bayMarker.hide();
    this.guest.hide();
  }

  // The run is over (three parks or failed): cooldown, then IDLE. Run stats stay for the final event that already used them; they reset when IDLE returns.
  _finish(success) {
    this.state = success ? 'PAID' : 'FAILED';
    this.cooldown = COOLDOWN;
    this._clearMarkers();
    this.parksDone = 0;
    this.timeLeft = this.timeTotal = 0;
    this.handing = false;
    this.parkHold = 0;
    this.outTime = 0;
  }

  _fail(reason, onEvent) {
    this._finish(false);
    if (onEvent) onEvent({ type: 'valet', phase: 'failed', reason });
  }

  // ctx = { carPos, carSpeed, inCar, carDamageDelta, onEvent }
  update(dt, ctx) {
    const { carPos, carSpeed, inCar, onEvent } = ctx;
    this.time += dt;
    this.carPos = carPos;
    this.hotelMarker.bob(this.time);
    this.bayMarker.bob(this.time);
    const walked = this.guest.update(dt);
    if (walked) this.handing = false;

    if (this.state === 'IDLE') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown <= 0 && this._pickLeg()) {
        this._resetRun(); // a fresh run starts here
        this.state = 'TO_HOTEL';
      }
      return;
    }
    if (this.state === 'PAID' || this.state === 'FAILED') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown <= 0) {
        this._resetRun();
        this.state = 'IDLE';
      }
      return;
    }

    // Active run (TO_HOTEL / TO_BAY): clocks, damage and distance, then the wreck check, before any state logic.
    this.totalTime += dt;
    this.totalDamage += ctx.carDamageDelta || 0;
    if (inCar) {
      if (this.prevCarPos) {
        const step = Math.hypot(carPos.x - this.prevCarPos.x, carPos.z - this.prevCarPos.z);
        if (step < JUMP_LIMIT) this.totalDistance += step;
      }
      this.prevCarPos = { x: carPos.x, z: carPos.z };
    } else {
      this.prevCarPos = null; // walking is not driven distance
    }
    if (this.totalDamage >= WRECK_DAMAGE) {
      this._fail('wrecked', onEvent);
      return;
    }

    if (this.state === 'TO_HOTEL') {
      if (!inCar || Math.abs(carSpeed) >= HOTEL_SPEED) return; // must be stopped (< 1 m/s)
      const h = this.activeHotel;
      if (Math.hypot(carPos.x - h.x, carPos.z - h.z) > HOTEL_R) return;
      // Handover: the leg timer is fixed now from the straight-line distance, the guest walks to the car.
      const b = this.activeBay;
      this.timeTotal = this._legTimer();
      this.timeLeft = this.timeTotal;
      this.outTime = 0;
      this.parkHold = 0;
      this.handing = true;
      const y = this._groundY(h.x, h.z);
      this.guest.start(new THREE.Vector3(h.x, y, h.z), this._beside(h, carPos.x, carPos.z, y));
      this.hotelMarker.hide();
      this.bayMarker.setPos(b.x, this._groundY(b.x, b.z), b.z);
      this.state = 'TO_BAY';
      if (onEvent) onEvent({ type: 'valet', phase: 'handover', parksDone: this.parksDone, timeTotal: this.timeTotal });
      return;
    }

    // TO_BAY
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      this._fail('timeout', onEvent);
      return;
    }
    if (!inCar) {
      this.parkHold = 0;
      this.outTime += dt;
      if (this.outTime > OUT_LIMIT) this._fail('abandoned', onEvent);
      return;
    }
    this.outTime = 0;
    const bay = this.activeBay;
    if (Math.abs(carSpeed) < BAY_SPEED && Math.hypot(carPos.x - bay.x, carPos.z - bay.z) <= BAY_R) {
      this.parkHold += dt;
      if (this.parkHold >= PARK_HOLD) this._parked(onEvent);
    } else {
      this.parkHold = 0;
    }
  }

  // The car is parked: pay PER_PARK; after the third, ONE final event pays BASE_PAY + tips; otherwise the next hotel comes up at once.
  _parked(onEvent) {
    this.parksDone += 1;
    this.parkHold = 0;
    if (onEvent) onEvent({ type: 'valet', phase: 'parked', reward: VALET.PER_PARK, parksDone: this.parksDone });
    if (this.parksDone >= VALET.MAX_PARKS) {
      const fast = this.totalDistance > 0 && this.totalTime <= this.totalDistance / FAST_SPEED;
      const clean = this.totalDamage < CLEAN_DAMAGE;
      const tipFast = fast ? VALET.TIP_FAST : 0;
      const tipClean = clean ? VALET.TIP_CLEAN : 0;
      this._finish(true);
      if (onEvent) onEvent({ type: 'valet', phase: 'paid', pay: VALET.BASE_PAY + tipFast + tipClean, base: VALET.BASE_PAY, tipFast, tipClean });
      return;
    }
    this.bayMarker.hide();
    this.timeLeft = this.timeTotal = 0;
    this.handing = false;
    if (this._pickLeg()) this.state = 'TO_HOTEL';
    else this._fail('nosites', onEvent);
  }

  // { visible, label, pay (park pay so far this run), parksDone, parksTotal, timeLeft/timeTotal (s, only during TO_BAY), distanceLeft (m) }
  hudState() {
    if (this.state !== 'TO_HOTEL' && this.state !== 'TO_BAY') {
      return { visible: false, label: '', pay: 0, parksDone: 0, parksTotal: VALET.MAX_PARKS, timeLeft: 0, timeTotal: 0, distanceLeft: 0 };
    }
    const t = this.targetPos();
    const distanceLeft = t && this.carPos ? Math.hypot(t.x - this.carPos.x, t.z - this.carPos.z) : 0;
    const toBay = this.state === 'TO_BAY';
    return {
      visible: true,
      label: toBay ? 'VALET: PARK' : 'VALET: HOTEL',
      pay: this.parksDone * VALET.PER_PARK,
      parksDone: this.parksDone,
      parksTotal: VALET.MAX_PARKS,
      timeLeft: toBay ? this.timeLeft : 0,
      timeTotal: toBay ? this.timeTotal : 0,
      distanceLeft,
    };
  }
}
