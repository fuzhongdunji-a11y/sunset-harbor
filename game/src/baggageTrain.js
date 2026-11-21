// baggageTrain: Airport Baggage Train job service (tow a baggage cart to 3 parked planes).
// States: IDLE -> TO_CART -> COUPLING -> HAULING -> (PAID | FAILED) -> 20s cooldown -> IDLE (first round after 12s).
// All sites come from world.layout intersections; one pooled cart, one pooled ring, three pooled plane props.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const BAGGAGE = {
  PER_PLANE: 300,
  DETACHED_PAY: 120,
  ALL_SAFE_BONUS: 250,
  PLANES_TOTAL: 3,
  DETACH_DAMAGE: 60,
};

const { PER_PLANE, DETACHED_PAY, ALL_SAFE_BONUS, PLANES_TOTAL, DETACH_DAMAGE } = BAGGAGE;

const FIRST_DELAY = 12;
const COOLDOWN = 20;
const MAX_OUT = 20;          // seconds continuously out of the car before the job fails
const COUPLE_TIME = 1.0;
const DELIVERY_TIME = 1.0;
const COUPLE_DIST = 6;
const DELIVERY_DIST = 7;
const STOP_SPEED = 1;
const TRAIL_SPACING = 5;     // cart trails the player by ~5 m along the breadcrumb path
const CRUMB_STEP = 1;
const MAX_CRUMBS = 600;
const SEA_Z = 330;           // anchors must stay on land
const MIN_PLANE_GAP = 100;
const MIN_AIRPORT_DIST = 120;
const FORCE_AHEAD = 35;
const MARKER_COLOR = 0x4dc3ff;

const finite = (v) => (Number.isFinite(v) ? v : 0);
const isPos = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);

// Pooled bobbing ring (sky-blue) at the current target.
function buildRing() {
  const geom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
  const mat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}

// Baggage cart prop: flatbed deck on one pair of axle bars.
function buildCartProp() {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 3), new THREE.MeshLambertMaterial({ color: 0xc9ccd1, flatShading: true }));
  deck.position.y = 0.55;
  g.add(deck);
  const axles = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.4, 2.4), new THREE.MeshLambertMaterial({ color: 0x2c2f36, flatShading: true }));
  axles.position.y = 0.2;
  g.add(axles);
  g.visible = false;
  return g;
}

// Plane prop (shared geometry/material across the three pooled instances).
function buildPlanePropFactory() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xe8edf2, flatShading: true });
  const fusGeom = new THREE.CylinderGeometry(1.5, 1.2, 14, 10).rotateX(Math.PI / 2);
  const wingGeom = new THREE.BoxGeometry(16, 0.3, 3);
  return () => {
    const g = new THREE.Group();
    const fus = new THREE.Mesh(fusGeom, mat);
    fus.position.y = 2;
    g.add(fus);
    const wing = new THREE.Mesh(wingGeom, mat);
    wing.position.set(0, 1.6, 0.5);
    g.add(wing);
    g.visible = false;
    return g;
  };
}

export class BaggageTrainService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < SEA_Z) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 4099 + 19);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.outTime = 0;
    this.coupleTimer = 0;
    this.deliveredTimer = 0;
    this.time = 0;

    this.airportSite = { x: 0, z: 0 };
    this.planeSites = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
    this.cartPos = { x: 0, z: 0 };
    this.cartHeading = 0;
    this.cartDamage = 0;
    this.legDetached = false;
    this.anyDetached = false;
    this.planesDone = 0;
    this.totalPay = 0;
    this.currentPlaneIdx = 0;
    this.coupled = false;
    this.crumbs = [];
    this.lastSeenCarPos = null;

    // pooled props, built once
    this.cart = buildCartProp();
    scene.add(this.cart);
    const makePlane = buildPlanePropFactory();
    this.planes = [];
    for (let i = 0; i < PLANES_TOTAL; i++) {
      const p = makePlane();
      p.rotation.y = i * 0.9;
      scene.add(p);
      this.planes.push(p);
    }
    this.ring = buildRing();
    this.ringBaseY = 0;
    scene.add(this.ring);
  }

  _groundY(x, z) {
    const f = this.world.layout.groundHeightAt;
    return (f ? finite(f(x, z)) : 0) + 0.08;
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  _active() { return this.state === 'TO_CART' || this.state === 'COUPLING' || this.state === 'HAULING'; }

  // Farthest-point sampling: airport anchor, then 3 plane anchors >=100 m apart and >=120 m from the airport.
  _chooseSites() {
    if (this.anchors.length === 0) return false;
    const airport = this.rng.pick(this.anchors);
    const picked = [];
    for (let n = 0; n < PLANES_TOTAL; n++) {
      let best = null;
      let bestD = -1;
      for (const a of this.anchors) {
        if (picked.includes(a) || a === airport) continue;
        if (this._dist(a, airport) < MIN_AIRPORT_DIST) continue;
        let d = this._dist(a, airport);
        let ok = true;
        for (const p of picked) {
          const dp = this._dist(a, p);
          if (dp < MIN_PLANE_GAP) { ok = false; break; }
          d = Math.min(d, dp);
        }
        if (ok && d > bestD) { bestD = d; best = a; }
      }
      if (!best) return false;
      picked.push(best);
    }
    this.airportSite = { x: airport.x, z: airport.z };
    this.planeSites = picked.map(a => ({ x: a.x, z: a.z }));
    return true;
  }

  _resetRound() {
    this.crumbs = [];
    this.cartPos = { x: this.airportSite.x, z: this.airportSite.z };
    this.cartHeading = 0;
    this.cartDamage = 0;
    this.legDetached = false;
    this.anyDetached = false;
    this.planesDone = 0;
    this.totalPay = 0;
    this.currentPlaneIdx = 0;
    this.coupled = false;
    this.coupleTimer = 0;
    this.deliveredTimer = 0;
    this.outTime = 0;
  }

  _emit(ctx, phase, pay, bonus) {
    if (ctx && typeof ctx.onEvent === 'function') ctx.onEvent({ type: 'baggage', phase, pay, bonus, timeLeft: 0 });
  }

  _fail(ctx) {
    this._emit(ctx, 'failed', 0, 0);
    this.state = 'FAILED';
    this.cooldown = COOLDOWN;
    this.coupled = false;
    this.outTime = 0;
  }

  _endPaid(ctx) {
    this._emit(ctx, 'paid', 0, this.anyDetached ? 0 : ALL_SAFE_BONUS);
    this.state = 'PAID';
    this.cooldown = COOLDOWN;
    this.coupled = false;
  }

  // Staging: plane #2 (planesDone = 1) sits ~35 m ahead of the car along heading; forward = (sin h, cos h).
  forceBaggage(carPos, heading = 0) {
    if (!isPos(carPos)) return;
    const sx = Math.sin(heading), sz = Math.cos(heading);
    if (!this._chooseSites()) {
      // fallback sites relative to the car (only if the layout cannot satisfy the spacing rules)
      this.airportSite = { x: carPos.x - sx * 150, z: carPos.z - sz * 150 };
      this.planeSites = [
        { x: carPos.x - sx * 60, z: carPos.z - sz * 60 },
        { x: carPos.x, z: carPos.z },
        { x: carPos.x + sx * 140, z: carPos.z + sz * 140 },
      ];
    }
    this._resetRound();
    this.planeSites[1] = { x: carPos.x + sx * FORCE_AHEAD, z: carPos.z + sz * FORCE_AHEAD };
    this.currentPlaneIdx = 1;
    this.planesDone = 1;
    this.totalPay = PER_PLANE;
    this.coupled = true;
    this.cartHeading = heading;
    this.cartPos = { x: carPos.x - sx * TRAIL_SPACING, z: carPos.z - sz * TRAIL_SPACING };
    this.crumbs = [{ x: this.cartPos.x, z: this.cartPos.z }, { x: carPos.x, z: carPos.z }];
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this.state = 'HAULING';
    this._syncProps();
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};
    this.time += dt;
    if (isPos(ctx.carPos)) this.lastSeenCarPos = { x: ctx.carPos.x, z: ctx.carPos.z };
    const carPos = this.lastSeenCarPos;
    const inCar = !!ctx.inCar;
    const stopped = Math.abs(Number(ctx.carSpeed)) < STOP_SPEED;

    // out-of-car timer: only while a round is active
    if (this._active()) {
      if (inCar) this.outTime = 0;
      else {
        this.outTime += dt;
        if (this.outTime > MAX_OUT) { this._fail(ctx); this._syncProps(); return; }
      }
    } else {
      this.outTime = 0;
    }

    switch (this.state) {
      case 'IDLE':
        this.cooldown -= dt;
        if (this.cooldown <= 0) {
          if (this._chooseSites()) {
            this._resetRound();
            this.state = 'TO_CART';
          } else {
            this.cooldown = COOLDOWN;
          }
        }
        break;

      case 'TO_CART':
        if (carPos && inCar && stopped && this._dist(carPos, this.cartPos) <= COUPLE_DIST) {
          this.state = 'COUPLING';
          this.coupleTimer = 0;
        }
        break;

      case 'COUPLING':
        if (!carPos || !inCar || !stopped || this._dist(carPos, this.cartPos) > COUPLE_DIST) {
          this.state = 'TO_CART';
          this.coupleTimer = 0;
        } else {
          this.coupleTimer += dt;
          if (this.coupleTimer >= COUPLE_TIME) {
            this.coupled = true;
            this.coupleTimer = 0;
            this.deliveredTimer = 0;
            this.crumbs = [{ x: this.cartPos.x, z: this.cartPos.z }, { x: carPos.x, z: carPos.z }];
            this.state = 'HAULING';
            this._emit(ctx, 'coupled', 0, 0);
          }
        }
        break;

      case 'HAULING': {
        if (!carPos) break;
        // damage accrues only while hauling; detaches exactly once per leg
        const dmg = Number(ctx.carDamageDelta);
        if (Number.isFinite(dmg) && dmg > 0) {
          this.cartDamage += dmg;
          if (this.cartDamage >= DETACH_DAMAGE && !this.legDetached) {
            this.legDetached = true;
            this.anyDetached = true;
            this.coupled = false;
            this.deliveredTimer = 0;
            this.state = 'TO_CART'; // cart stays where the trail left it (this.cartPos)
            this._emit(ctx, 'detached', 0, 0);
            break;
          }
        }
        // breadcrumb trail
        const last = this.crumbs[this.crumbs.length - 1];
        if (!last || this._dist(carPos, last) >= CRUMB_STEP) {
          this.crumbs.push({ x: carPos.x, z: carPos.z });
          if (this.crumbs.length > MAX_CRUMBS) this.crumbs.shift();
        }
        this._followTrail(carPos);
        // delivery: cart at the plane site and the car stopped
        const target = this.planeSites[this.currentPlaneIdx];
        if (inCar && stopped && this._dist(this.cartPos, target) <= DELIVERY_DIST) {
          this.deliveredTimer += dt;
          if (this.deliveredTimer >= DELIVERY_TIME) {
            const pay = this.legDetached ? DETACHED_PAY : PER_PLANE;
            this.totalPay += pay;
            this.planesDone += 1;
            this._emit(ctx, 'delivered', pay, 0);
            this.legDetached = false;
            this.cartDamage = 0;
            this.deliveredTimer = 0;
            this.coupled = false;
            this.crumbs = [];
            this.cartPos = { x: this.airportSite.x, z: this.airportSite.z };
            this.cartHeading = 0;
            if (this.planesDone >= PLANES_TOTAL) {
              this._endPaid(ctx);
            } else {
              this.currentPlaneIdx = this.planesDone;
              this.state = 'TO_CART';
            }
          }
        } else {
          this.deliveredTimer = 0;
        }
        break;
      }

      case 'PAID':
      case 'FAILED':
        this.cooldown -= dt;
        if (this.cooldown <= 0) {
          this.state = 'IDLE';
          this.cooldown = 0;
        }
        break;
    }

    this._syncProps();
  }

  // Walk back along the trail from the car and place the cart TRAIL_SPACING metres behind it.
  _followTrail(car) {
    const c = this.crumbs;
    let need = TRAIL_SPACING;
    let ax = car.x, az = car.z;
    for (let i = c.length - 1; i >= 0; i--) {
      const seg = Math.hypot(c[i].x - ax, c[i].z - az);
      if (seg >= need && seg > 1e-4) {
        const k = need / seg;
        const x = ax + (c[i].x - ax) * k;
        const z = az + (c[i].z - az) * k;
        this.cartPos = { x, z };
        this.cartHeading = Math.atan2(ax - x, az - z);
        return;
      }
      need -= seg;
      ax = c[i].x;
      az = c[i].z;
    }
  }

  _syncProps() {
    const active = this._active();
    this.cart.visible = active;
    if (active) {
      this.cart.position.set(this.cartPos.x, this._groundY(this.cartPos.x, this.cartPos.z), this.cartPos.z);
      this.cart.rotation.y = this.cartHeading;
    }
    for (let i = 0; i < this.planes.length; i++) {
      const p = this.planes[i];
      p.visible = active;
      if (active) {
        const s = this.planeSites[i];
        p.position.set(s.x, this._groundY(s.x, s.z), s.z);
      }
    }
    const tgt = this.targetPos();
    if (tgt) {
      const y = this._groundY(tgt.x, tgt.z);
      const bob = Math.sin(this.time * 3);
      this.ring.position.set(tgt.x, y + 0.35 + 0.25 * bob, tgt.z);
      const s = 1 + 0.06 * bob;
      this.ring.scale.set(s, s, 1);
      this.ring.visible = true;
    } else {
      this.ring.visible = false;
    }
  }

  hudState() {
    const tgt = this.targetPos();
    let distanceLeft = 0;
    if (tgt && this.lastSeenCarPos) distanceLeft = finite(this._dist(this.lastSeenCarPos, tgt));
    return {
      visible: this._active(),
      label: 'BAGGAGE TRAIN',
      pay: finite(this.totalPay),
      distanceLeft,
      planesDone: this.planesDone,
      planesTotal: PLANES_TOTAL,
      coupled: !!this.coupled,
    };
  }

  targetPos() {
    if (this.state === 'TO_CART' || this.state === 'COUPLING') return { x: this.cartPos.x, z: this.cartPos.z };
    if (this.state === 'HAULING') {
      const s = this.planeSites[this.currentPlaneIdx];
      return { x: s.x, z: s.z };
    }
    return null;
  }
}
