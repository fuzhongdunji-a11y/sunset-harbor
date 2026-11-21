// Sunset Escort job service: meet a VIP at a parked car, then drive them through 4 waypoints; the VIP car follows your breadcrumb trail and its trust meter drains whenever you stray outside the 12-45 m band.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const ESCORT = {
  PER_STOP: 200,
  BASE_PAY: 150,
  TRUST_MAX: 100,
  TRUST_BONUS_MAX: 300,
  BAND_MIN: 12,
  BAND_MAX: 45,
  STOPS_TOTAL: 4,
};

const FIRST_DELAY = 12;
const COOLDOWN = 20;
const MAX_OUT = 20; // s continuously out of the car
const MEET_RADIUS = 7;
const MEET_DWELL = 1.0;
const WP_RADIUS = 10;
const TRIP_MIN_DIST = 120; // each waypoint >= this far from the previous point
const FOLLOW_GAP = 15; // m of trail between player and VIP
const VIP_MAX_SPEED = 22; // m/s
const CRUMB_STEP = 1.0; // m between breadcrumbs
const MAX_CRUMBS = 600; // ring buffer capacity (~600 m of trail)
const TRUST_DRAIN = 4;
const TRUST_GAIN = 1.5;
const VISIBLE_RING_COLOR = 0xb26bff;
const VIP_COLOR = 0xf2ead8;
const GOLD_TRIM_COLOR = 0x8c7b4d;

// Geometry and materials shared by the single pooled VIP car + ring
const bodyGeom = new THREE.BoxGeometry(3, 1, 6);
const cabinGeom = new THREE.BoxGeometry(2.5, 1.2, 4);
const wheelGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.6, 12).rotateZ(Math.PI / 2);
const bodyMat = new THREE.MeshLambertMaterial({ color: VIP_COLOR, flatShading: true });
const cabinMat = new THREE.MeshLambertMaterial({ color: GOLD_TRIM_COLOR, flatShading: true });
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true });
const ringMat = new THREE.MeshBasicMaterial({ color: VISIBLE_RING_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
const ringGeom = new THREE.RingGeometry(1.2, 2.2, 32, 1, 0, Math.PI * 2);

function buildVIP(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.9;
  const cabin = new THREE.Mesh(cabinGeom, cabinMat);
  cabin.position.set(0, 2.0, -0.5);
  group.add(body, cabin);
  for (const [x, z] of [[-1.3, -2.0], [1.3, -2.0], [-1.3, 2.0], [1.3, 2.0]]) {
    const w = new THREE.Mesh(wheelGeom, wheelMat);
    w.position.set(x, 0.4, z);
    group.add(w);
  }
  group.visible = false;
  scene.add(group);
  return group;
}

export class SunsetEscortService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < 330) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 4111 + 37);
    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;
    this.vip = buildVIP(scene);
    this.ring = new THREE.Mesh(ringGeom, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
    this.ringBaseY = 0;
    this.outTime = 0;
    this.metTimer = 0;
    // preallocated breadcrumb ring buffer (no per-frame allocation)
    this.crumbs = [];
    for (let i = 0; i < MAX_CRUMBS; i++) this.crumbs.push({ x: 0, z: 0 });
    this.crumbHead = 0; // index of the newest crumb
    this.crumbCount = 0;
    this.waypoints = [];
    this.waypointIndex = 0;
    this.currentWaypoint = null;
    this.stopsDone = 0;
    this.trust = ESCORT.TRUST_MAX;
    this.paySoFar = 0;
    this.lastX = 0;
    this.lastZ = 0;
  }

  _groundY(x, z) { return (this.world.layout.groundHeightAt ? this.world.layout.groundHeightAt(x, z) : 0) + 0.08; }

  _placeRing(x, z) {
    this.ringBaseY = this._groundY(x, z);
    this.ring.position.set(x, this.ringBaseY + 0.3, z);
    this.ring.visible = true;
  }

  _placeVip(x, z, heading) {
    this.vip.position.set(x, this._groundY(x, z), z);
    if (heading !== undefined) this.vip.rotation.y = heading;
    this.vip.visible = true;
  }

  _clearCrumbs() { this.crumbCount = 0; this.crumbHead = 0; }

  _pushCrumb(x, z) {
    this.crumbHead = (this.crumbHead + 1) % MAX_CRUMBS;
    const c = this.crumbs[this.crumbHead];
    c.x = x; c.z = z;
    if (this.crumbCount < MAX_CRUMBS) this.crumbCount++;
  }

  _hideProps() {
    this.vip.visible = false;
    this.ring.visible = false;
  }

  // Farthest-point sampling: each stop is the anchor farthest from the previous point, and must be >= TRIP_MIN_DIST away.
  _pickWaypoints(start) {
    const picks = [];
    let prev = start;
    for (let i = 0; i < ESCORT.STOPS_TOTAL; i++) {
      let best = null, bestD = TRIP_MIN_DIST - 1e-6;
      for (const a of this.anchors) {
        if (a === start || picks.includes(a)) continue;
        const d = Math.hypot(a.x - prev.x, a.z - prev.z);
        if (d > bestD) { bestD = d; best = a; }
      }
      if (!best) return null;
      picks.push(best);
      prev = best;
    }
    return picks;
  }

  // Chooses the VIP start + waypoints. Returns false (state untouched) if sampling fails.
  _setupRound() {
    if (!this.anchors.length) return false;
    const start = this.rng.pick(this.anchors);
    const waypoints = this._pickWaypoints(start);
    if (!waypoints) return false;
    this.startPos = start;
    this.waypoints = waypoints;
    this.waypointIndex = 0;
    this.currentWaypoint = waypoints[0];
    this.stopsDone = 0;
    this.trust = ESCORT.TRUST_MAX;
    this.paySoFar = 0;
    this.outTime = 0;
    this.metTimer = 0;
    this._clearCrumbs();
    return true;
  }

  // Shot/debug helper: instantly ESCORTING with the current waypoint ring 35 m ahead of the car and the VIP 15 m behind.
  forceEscort(carPos, heading = 0) {
    if (!this._setupRound()) return;
    const dirX = Math.sin(heading), dirZ = Math.cos(heading);
    // stop 1 already done; the (copied, so shared anchors stay intact) current waypoint sits ahead of the car
    this.waypointIndex = 1;
    this.currentWaypoint = { x: carPos.x + dirX * 35, z: carPos.z + dirZ * 35 };
    this.waypoints[1] = this.currentWaypoint;
    this._placeRing(this.currentWaypoint.x, this.currentWaypoint.z);
    const vx = carPos.x - dirX * 15, vz = carPos.z - dirZ * 15;
    this._placeVip(vx, vz, heading);
    this._pushCrumb(vx, vz);
    this.lastX = carPos.x; this.lastZ = carPos.z;
    this.state = 'ESCORTING';
    this.stopsDone = 1;
    this.paySoFar = ESCORT.PER_STOP;
    this.trust = ESCORT.TRUST_MAX;
  }

  // VIP goes to the trail point FOLLOW_GAP metres of trail behind the player, speed-capped; waits if the trail is too short.
  _followTrail(dt, px, pz) {
    let ax = px, az = pz, acc = 0;
    let idx = this.crumbHead;
    for (let n = 0; n < this.crumbCount; n++) {
      const c = this.crumbs[idx];
      const seg = Math.hypot(c.x - ax, c.z - az);
      if (acc + seg >= FOLLOW_GAP) {
        const k = seg > 1e-6 ? (FOLLOW_GAP - acc) / seg : 0;
        const tx = ax + (c.x - ax) * k, tz = az + (c.z - az) * k;
        const vx = this.vip.position.x, vz = this.vip.position.z;
        const dx = tx - vx, dz = tz - vz;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-4) {
          const step = Math.min(dist, VIP_MAX_SPEED * dt);
          const nx = vx + (dx / dist) * step, nz = vz + (dz / dist) * step;
          this.vip.position.set(nx, this._groundY(nx, nz), nz);
          if (step > 1e-3) this.vip.rotation.y = Math.atan2(dx, dz);
        }
        return;
      }
      acc += seg;
      ax = c.x; az = c.z;
      idx = (idx - 1 + MAX_CRUMBS) % MAX_CRUMBS;
    }
    // trail exhausted: wait
  }

  _end(onEvent, phase, pay, bonus) {
    this.state = phase === 'paid' ? 'PAID' : 'FAILED';
    this.cooldown = COOLDOWN;
    this._hideProps();
    this.currentWaypoint = null;
    onEvent({ type: 'escort', phase, pay, bonus, timeLeft: 0 });
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, onEvent } = ctx;
    const px = carPos.x, pz = carPos.z;
    this.lastX = px; this.lastZ = pz;
    this.time += dt;

    if (this.state === 'IDLE') {
      if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown <= 0) {
        if (this._setupRound()) {
          this._placeVip(this.startPos.x, this.startPos.z, 0);
          this._placeRing(this.startPos.x, this.startPos.z);
          this.state = 'TO_VIP';
        } else {
          this.cooldown = COOLDOWN; // sampling failed: retry after cooldown
        }
      }
      return;
    }

    if (this.state === 'PAID' || this.state === 'FAILED') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown <= 0) { this.state = 'IDLE'; this.outTime = 0; this.metTimer = 0; }
      return;
    }

    // TO_VIP / ESCORTING: ring bob + out-of-car timer
    this.ring.position.y = this.ringBaseY + 0.4 + Math.sin(this.time * 3) * 0.25;
    if (inCar) this.outTime = 0; else this.outTime += dt;
    if (this.outTime > MAX_OUT) { this._end(onEvent, 'failed', 0, 0); return; }

    if (this.state === 'TO_VIP') {
      const near = inCar && Math.abs(carSpeed) < 1 && Math.hypot(px - this.vip.position.x, pz - this.vip.position.z) <= MEET_RADIUS;
      this.metTimer = near ? this.metTimer + dt : 0;
      if (this.metTimer >= MEET_DWELL) {
        this.metTimer = 0;
        this.state = 'ESCORTING';
        this.trust = ESCORT.TRUST_MAX;
        this.waypointIndex = 0;
        this.currentWaypoint = this.waypoints[0];
        this._placeRing(this.currentWaypoint.x, this.currentWaypoint.z);
        this._clearCrumbs();
        this._pushCrumb(this.vip.position.x, this.vip.position.z);
        onEvent({ type: 'escort', phase: 'met', pay: 0, bonus: 0, timeLeft: 0 });
      }
      return;
    }

    // ESCORTING: breadcrumb trail (a new crumb every CRUMB_STEP m of player travel)
    const head = this.crumbs[this.crumbHead];
    if (this.crumbCount === 0 || Math.hypot(px - head.x, pz - head.z) >= CRUMB_STEP) this._pushCrumb(px, pz);
    this._followTrail(dt, px, pz);

    // trust
    const d = Math.hypot(px - this.vip.position.x, pz - this.vip.position.z);
    if (d < ESCORT.BAND_MIN || d > ESCORT.BAND_MAX) this.trust = Math.max(0, this.trust - TRUST_DRAIN * dt);
    else this.trust = Math.min(ESCORT.TRUST_MAX, this.trust + TRUST_GAIN * dt);
    if (this.trust <= 0) { this._end(onEvent, 'failed', 0, 0); return; }

    // waypoint reached by the VIP (not the player)
    const wp = this.currentWaypoint;
    if (wp && Math.hypot(this.vip.position.x - wp.x, this.vip.position.z - wp.z) <= WP_RADIUS) {
      this.stopsDone += 1;
      this.paySoFar = this.stopsDone * ESCORT.PER_STOP;
      onEvent({ type: 'escort', phase: 'stop', pay: ESCORT.PER_STOP, bonus: 0, timeLeft: 0 });
      if (this.stopsDone >= ESCORT.STOPS_TOTAL) {
        const bonus = Math.floor(this.trust / ESCORT.TRUST_MAX * ESCORT.TRUST_BONUS_MAX);
        this._end(onEvent, 'paid', ESCORT.BASE_PAY, bonus);
      } else {
        this.waypointIndex += 1;
        this.currentWaypoint = this.waypoints[this.waypointIndex];
        this._placeRing(this.currentWaypoint.x, this.currentWaypoint.z);
      }
    }
  }

  hudState() {
    const t = this.targetPos();
    const visible = this.state === 'TO_VIP' || this.state === 'ESCORTING';
    const distanceLeft = t ? Math.hypot(t.x - this.lastX, t.z - this.lastZ) : 0;
    return {
      visible,
      label: 'SUNSET ESCORT',
      pay: ESCORT.PER_STOP * this.stopsDone,
      distanceLeft: Number.isFinite(distanceLeft) ? distanceLeft : 0,
      timeLeft: 0,
      timeTotal: 0,
      stopsDone: this.stopsDone,
      stopsTotal: ESCORT.STOPS_TOTAL,
      trust: Math.round(this.trust),
    };
  }

  targetPos() {
    if (this.state === 'TO_VIP') return { x: this.vip.position.x, z: this.vip.position.z };
    if (this.state === 'ESCORTING' && this.currentWaypoint) return { x: this.currentWaypoint.x, z: this.currentWaypoint.z };
    return null;
  }
}
