// lighthouseSupply: the Lighthouse Supply job. Deliver cargo to the lighthouse from a depot, passing checkpoints and earning money.
// States: IDLE -> LOADING -> HAULING -> (PAID | FAILED) -> 20s cooldown -> IDLE. First round after 12s.
// Sites: delivery nearest lighthouse (-110,419), two checkpoints farthest-point sampled from all anchors with min 100m spacing and from delivery, pickup random anchor.
// Props: one pale‑gold ring marker, one crate stack at pickup, one at delivery, small markers at checkpoints. All built once.
import * as THREE from '../vendor/three.module.min.js';

// Public constants
export const SUPPLY = {
  BASE_PAY: 900,
  INTACT_BONUS: 250,
  CHECKPOINT_TIME: 25,
  CHECKPOINTS_TOTAL: 2,
};

const SITE_R_LOADING = 6;      // radius to load cargo
const SITE_R_CP = 8;           // radius to hit a checkpoint
const SITE_R_DELIVERY = 7;     // radius to deliver
const MIN_SITE_DIST = 100;     // spacing between checkpoints and delivery
const MAX_Z = 330;             // anchors stay on land
const FIRST_DELAY = 12;
const COOLDOWN = 20;
const OUT_OF_CAR_LIMIT = 20;
const FORCE_AHEAD = 35;
const ACCENT = 0xffe27a; // pale‑gold

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Helper: pooled pale‑gold ring marker (radius 7)
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(SITE_R_CP - 0.8, SITE_R_CP, 40, 1, 0, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  setPos(x, y, z) { this.mesh.position.set(x, y, z); }
  show(v) { this.mesh.visible = v; }
}

// Helper: simple crate stack (three small boxes)
const CRATE_GEOM = new THREE.BoxGeometry(1.6, 1.9, 1.6);
const CRATE_MAT = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
function buildCrateStack() {
  const m = new THREE.Mesh(CRATE_GEOM, CRATE_MAT);
  m.userData.lift = 0.95;
  m.visible = false;
  return m;
}

// Helper: small marker for checkpoints (cylinder)
function buildSmallMarker() {
  const group = new THREE.Group();
  const cylGeom = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12);
  const cylMat = new THREE.MeshLambertMaterial({ color: ACCENT });
  const cyl = new THREE.Mesh(cylGeom, cylMat);
  cyl.position.set(0, 0.05, 0);
  group.add(cyl);
  group.visible = false;
  return group;
}

const finiteVal = (v, d = 0) => (Number.isFinite(v) ? v : d);

export class LighthouseSupplyService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < MAX_Z) this.anchors.push({ x, z });
    this.loadedTimer = 0;
    this.targetTimer = 0;

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.outTime = 0;
    this.timeLeft = 0;
    this.timeTotal = 0;
    this.checkpointsDone = 0;
    this.cargoDamage = 0;
    this.lastSeenCarPos = null;
    this.deliverySite = null;
    this.pickupSite = null;
    this.checkpoints = [];
    this.currentTarget = null;

    // pooled marker
    this.ringMarker = new Marker(scene, ACCENT);

    // crate stacks
    this.pickupStack = buildCrateStack();
    this.deliveryStack = buildCrateStack();
    scene.add(this.pickupStack, this.deliveryStack);

    // checkpoint markers
    this.checkpointMarkers = [];
    for (let i = 0; i < SUPPLY.CHECKPOINTS_TOTAL; i++) {
      const m = buildSmallMarker();
      scene.add(m);
      this.checkpointMarkers.push(m);
    }
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  _groundY(x, z) { const L = this.world.layout; return finiteVal(L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08; }

  // farthest-point sampling over anchors; every pick >= minDist from all earlier picks
  _extend(picked, n, minDist) {
    const added = [];
    while (added.length < n) {
      let best = null; let bestD = -1;
      for (const a of this.anchors) {
        if (picked.includes(a) || added.includes(a)) continue;
        let d = Infinity;
        for (const p of picked) d = Math.min(d, this._dist(a, p));
        for (const p of added) d = Math.min(d, this._dist(a, p));
        if (d < minDist) continue;
        if (d > bestD) { bestD = d; best = a; }
      }
      if (!best) break;
      added.push(best);
    }
    return added;
  }

  _chooseSites() {
    if (this.anchors.length === 0) return null;
    // delivery: nearest to lighthouse (-110,419)
    const lighthouse = { x: -110, z: 419 };
    let best = null; let bestD = Infinity;
    for (const a of this.anchors) {
      const d = this._dist(a, lighthouse);
      if (d < bestD) { bestD = d; best = a; }
    }
    const delivery = best;
    if (!delivery) return null;
    // pickup + checkpoints: farthest-point sampling, each >= MIN_SITE_DIST from all earlier picks
    const picks = this._extend([delivery], SUPPLY.CHECKPOINTS_TOTAL + 1, MIN_SITE_DIST);
    if (picks.length < SUPPLY.CHECKPOINTS_TOTAL + 1) return null;
    return { pickup: picks[0], checkpoints: picks.slice(1), delivery };
  }

  _placeProps() {
    if (this.pickupSite) {
      const y = this._groundY(this.pickupSite.x, this.pickupSite.z);
      this.pickupStack.position.set(this.pickupSite.x, y + 0.95, this.pickupSite.z);
      this.pickupStack.visible = true;
    }
    if (this.deliverySite) {
      const y = this._groundY(this.deliverySite.x, this.deliverySite.z);
      this.deliveryStack.position.set(this.deliverySite.x, y + 0.95, this.deliverySite.z);
      this.deliveryStack.visible = true;
    }
    for (let i = 0; i < this.checkpoints.length; i++) {
      const ck = this.checkpoints[i];
      const m = this.checkpointMarkers[i];
      const y = this._groundY(ck.x, ck.z);
      m.position.set(ck.x, y, ck.z);
      m.visible = true;
    }
  }

  _hideAll() {
    this.ringMarker.show(false);
    this.pickupStack.visible = false;
    this.deliveryStack.visible = false;
    for (const m of this.checkpointMarkers) m.visible = false;
  }

  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') {
      ctx.onEvent({ type: 'lighthouse', phase, pay, bonus, timeLeft: Math.max(0, finiteVal(timeLeft)) });
    }
  }

  _startRound(carPos) {
    const sites = this._chooseSites();
    if (!sites) return false;
    this.pickupSite = sites.pickup;
    this.checkpoints = sites.checkpoints;
    this.deliverySite = sites.delivery;
    this.checkpointsDone = 0;
    this.cargoDamage = 0;
    this.timeLeft = 0;
    this.timeTotal = 0;
    this.outTime = 0;
    this.lastSeenCarPos = carPos ? { x: carPos.x, z: carPos.z } : null;
    this.loadedTimer = 0;      // reset dwell timer for loading
    this.targetTimer = 0;      // reset dwell timer for checkpoints
    this._placeProps();
    this.state = 'LOADING';
    return true;
  }

  _fail(ctx) {
    this._emit(ctx, 'failed', 0, 0, 0);
    this.state = 'FAILED';
    this.cooldown = COOLDOWN;
    this._hideAll();
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};

    const inCar = !!ctx.inCar;
    const carPos = ctx.carPos && Number.isFinite(ctx.carPos.x) && Number.isFinite(ctx.carPos.z) ? ctx.carPos : null;
    if (carPos) this.lastSeenCarPos = { x: carPos.x, z: carPos.z };

    // out-of-car timer (only during LOADING or HAULING)
    if (this.state === 'LOADING' || this.state === 'HAULING') {
      if (inCar) this.outTime = 0; else { this.outTime += dt; if (this.outTime > OUT_OF_CAR_LIMIT) { this._fail(ctx); return; } }
    }

    if (this.state === 'IDLE') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (!this._startRound(ctx.carPos)) this.cooldown = COOLDOWN;
      }
      return;
    }

    if (this.state === 'LOADING') {
      const radius = SITE_R_LOADING;
      const dwell = 1.0;
      let loaded = false;
      if (inCar && carPos && this._dist(carPos, this.pickupSite) <= radius && Math.abs(finiteVal(ctx.carSpeed)) < 1) {
        if (!this.loadedTimer) this.loadedTimer = 0;
        this.loadedTimer += dt;
        if (this.loadedTimer >= dwell) {
          loaded = true;
          this.loadedTimer = 0;
        }
      } else {
        this.loadedTimer = 0;
      }
      // show ring marker during loading
      this.ringMarker.show(true);
      this.ringMarker.setPos(this.pickupSite.x, this._groundY(this.pickupSite.x, this.pickupSite.z), this.pickupSite.z);
      if (loaded) {
        // start HAULING
        const routeDist = this._dist(this.pickupSite, this.checkpoints[0]) + this._dist(this.checkpoints[0], this.checkpoints[1]) + this._dist(this.checkpoints[1], this.deliverySite);
        this.timeTotal = this.timeLeft = routeDist / 11 + 60;
        this.state = 'HAULING';
        this._emit(ctx, 'loaded', 0, 0, this.timeLeft);
      }
      return;
    }

    if (this.state === 'HAULING') {
      const target = this.checkpointsDone < SUPPLY.CHECKPOINTS_TOTAL ? this.checkpoints[this.checkpointsDone] : this.deliverySite;
      const radius = this.checkpointsDone < SUPPLY.CHECKPOINTS_TOTAL ? SITE_R_CP : SITE_R_DELIVERY;
      // update timer
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this._fail(ctx); return; }
      // cargo damage
      const dmg = Number(ctx.carDamageDelta);
      if (Number.isFinite(dmg) && dmg > 0) this.cargoDamage += dmg;
      // dwell logic for checkpoints/delivery
      // checkpoints are drive-through; only the delivery needs a stopped 1.0 s dwell
      const isDelivery = this.checkpointsDone >= SUPPLY.CHECKPOINTS_TOTAL;
      let reached = false;
      if (inCar && carPos && this._dist(carPos, target) <= radius) {
        if (!isDelivery) { reached = true; }
        else if (Math.abs(finiteVal(ctx.carSpeed)) < 1) {
          this.targetTimer = (this.targetTimer || 0) + dt;
          if (this.targetTimer >= 1.0) { reached = true; this.targetTimer = 0; }
        } else this.targetTimer = 0;
      } else {
        this.targetTimer = 0;
      }
      if (reached) {
        if (this.checkpointsDone < SUPPLY.CHECKPOINTS_TOTAL) {
          this.checkpointsDone++;
          this.timeLeft += SUPPLY.CHECKPOINT_TIME;
          this._emit(ctx, 'checkpoint', 0, 0, this.timeLeft);
        } else {
          // delivery
          const cargoPct = Math.max(0, Math.min(1, 1 - this.cargoDamage / 100));
          const pay = Math.floor(SUPPLY.BASE_PAY * cargoPct);
          const bonus = this.cargoDamage <= 0 ? SUPPLY.INTACT_BONUS : 0;
          this._emit(ctx, 'paid', pay, bonus, this.timeLeft);
          this.state = 'PAID';
          this.cooldown = COOLDOWN;
          this._hideAll();
        }
      }
      // sync props visibility
      this.ringMarker.show(true);
      this.ringMarker.setPos(target.x, this._groundY(target.x, target.z), target.z);
      return;
    }

    // PAID / FAILED cooldown
    if (this.state === 'PAID' || this.state === 'FAILED') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.state = 'IDLE';
        this.cooldown = 0;
        this._hideAll();
      }
    }
  }

  hudState() {
    const hauling = this.state === 'HAULING';
    const distanceLeft = hauling && this.lastSeenCarPos ? finiteVal(this._dist(this.lastSeenCarPos, this.checkpointsDone < SUPPLY.CHECKPOINTS_TOTAL ? this.checkpoints[this.checkpointsDone] : this.deliverySite)) : 0;
    const cargoPct = Math.round(Math.max(0, Math.min(1, 1 - this.cargoDamage / 100)) * 100);
    const pay = hauling ? Math.floor(SUPPLY.BASE_PAY * Math.max(0, Math.min(1, 1 - this.cargoDamage / 100))) : 0;
    return {
      visible: hauling,
      label: 'LIGHTHOUSE SUPPLY',
      pay,
      distanceLeft,
      cargoPct,
      checkpointsDone: this.checkpointsDone,
      checkpointsTotal: SUPPLY.CHECKPOINTS_TOTAL,
      timeLeft: hauling ? Math.ceil(this.timeLeft) : 0,
    };
  }

  targetPos() {
    if (this.state === 'LOADING') return { x: this.pickupSite.x, z: this.pickupSite.z };
    if (this.state === 'HAULING') return this.checkpointsDone < SUPPLY.CHECKPOINTS_TOTAL ? this.checkpoints[this.checkpointsDone] : this.deliverySite;
    return null;
  }

  forceSupply(carPos, heading = 0) {
    const sites = this._chooseSites();
    if (!sites) return;
    // place first checkpoint ahead
    const ahead = { x: carPos.x + Math.sin(heading) * FORCE_AHEAD, z: carPos.z + Math.cos(heading) * FORCE_AHEAD };
    sites.checkpoints[0] = ahead;
    this.pickupSite = sites.pickup;
    this.checkpoints = sites.checkpoints;
    this.deliverySite = sites.delivery;
    this.checkpointsDone = 0;
    this.cargoDamage = 20; // 80% left
    this.timeTotal = this.timeLeft = 90; // preset
    this.state = 'HAULING';
    this.cooldown = 0;
    this.outTime = 0;
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this.loadedTimer = 0;
    this.targetTimer = 0;
    this._placeProps();
    // show props
    this.ringMarker.show(true);
    this.ringMarker.setPos(ahead.x, this._groundY(ahead.x, ahead.z), ahead.z);
  }
}
