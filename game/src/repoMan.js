// repoMan: the Repo Man job. Drive to three parked cars, hook and haul to depot.
// States: IDLE -> TO_TARGET -> TO_DEPOT (x3 cars) -> (PAID | FAILED) -> 20s cooldown -> IDLE.
// Sites derived from world.layout anchors (xs x zs); props and rings are pooled.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// public constants
export const REPO = { PER_CAR: 250, NO_ARREST_BONUS: 300, CARS_TOTAL: 3 };

const FIRST_DELAY = 12; // seconds after load before the first round
const COOLDOWN = 20; // seconds after PAID / FAILED
const OUT_TIME_LIMIT = 20; // seconds continuously out of the car during TO_TARGET / TO_DEPOT
const SITE_R = 7; // distance to a car / the depot for pickup and return
const DWELL = 1.0; // seconds stopped inside the ring
const CAR_GAP = 120; // min distance between two target cars
const DEPOT_GAP = 100; // min distance between the depot and any target car
const MAX_Z = 330; // anchors must stay on land (sea is z > 340)
const FORCE_AHEAD = 35; // forceRepo: depot ring placed ~35 m ahead of the car
const CRIMSON = 0xff3355;
const GOLD = 0xffe14d;

// shared geometry / materials (same as buggyRoundup for consistency)
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const bodyGeom = new THREE.BoxGeometry(1.8, 0.6, 3.6);
const cabGeom = new THREE.BoxGeometry(1.5, 0.9, 1.4);
const axleGeom = new THREE.BoxGeometry(2.4, 0.5, 0.6);
const bodyMat = new THREE.MeshLambertMaterial({ color: CRIMSON, flatShading: true });
const cabMat = new THREE.MeshLambertMaterial({ color: 0x2b3a1a, flatShading: true });
const axleMat = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true });

// pooled bobbing ground ring
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.baseY = 0;
    scene.add(this.mesh);
  }
  setPos(x, y, z) { this.baseY = y; this.mesh.position.set(x, y, z); }
  show(v) { this.mesh.visible = v; }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
}

// simple low‑poly car prop (local +Z is forward)
function buildCarProp() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.7;
  const cab = new THREE.Mesh(cabGeom, cabMat);
  cab.position.set(0, 1.4, -0.2);
  const front = new THREE.Mesh(axleGeom, axleMat);
  front.position.set(0, 0.4, 1.3);
  const rear = new THREE.Mesh(axleGeom, axleMat);
  rear.position.set(0, 0.4, -1.3);
  g.add(body, cab, front, rear);
  g.visible = false;
  return g;
}

export class RepoManService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < MAX_Z) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 6151 + 29) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;
    this.lastPlayer = null;

    // pooled sites
    this.depot = { x: 0, z: 0, marker: new Marker(scene, GOLD) };
    this.cars = [];
    for (let i = 0; i < REPO.CARS_TOTAL; i++) {
      const prop = buildCarProp();
      scene.add(prop);
      this.cars.push({ x: 0, z: 0, prop });
    }
    this.targetRing = new Marker(scene, CRIMSON);

    this.carsDone = 0;
    this.arrested = false;
    this.outTime = 0;
    this.dwellTimer = 0;
    this.paySoFar = 0;
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  _groundY(x, z) { const L = this.world.layout; return (L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08; }

  // farthest-point sampling of n target cars
  _pickCars(depot, list) {
    const added = [];
    while (added.length < REPO.CARS_TOTAL) {
      let best = null, bestD = -1;
      for (const a of list) {
        if (a === depot || added.includes(a)) continue;
        const dDepot = this._dist(a, depot);
        if (dDepot < DEPOT_GAP) continue;
        let dCar = Infinity;
        for (const p of added) dCar = Math.min(dCar, this._dist(a, p));
        if (dCar < CAR_GAP) continue;
        const d = Math.min(dDepot, dCar);
        if (d > bestD) { bestD = d; best = a; }
      }
      if (!best) return null;
      added.push(best);
    }
    return added;
  }

  _chooseSites() {
    if (this.anchors.length === 0) return null;
    const depot = this.rng.pick(this.anchors);
    const candidates = this.anchors.filter(a => this._dist(a, depot) >= DEPOT_GAP);
    const spots = this._pickCars(depot, candidates);
    if (!spots) return null;
    return [depot, ...spots];
  }

  _setupSites() {
    const sites = this._chooseSites();
    if (!sites) return false;
    const depot = sites[0];
    this.depot.x = depot.x; this.depot.z = depot.z;
    this.depot.marker.setPos(depot.x, this._groundY(depot.x, depot.z), depot.z);
    for (let i = 0; i < REPO.CARS_TOTAL; i++) {
      const spot = sites[i + 1];
      this.cars[i].x = spot.x; this.cars[i].z = spot.z;
      this.cars[i].prop.position.set(spot.x, this._groundY(spot.x, spot.z), spot.z);
    }
    return true;
  }

  _syncVisuals() {
    const targetIdx = this.carsDone;
    this.cars.forEach((c, i) => { c.prop.visible = this.state === 'TO_TARGET' && i === targetIdx; });
    if (this.state === 'TO_TARGET') {
      const c = this.cars[targetIdx];
      this.targetRing.setPos(c.x, this._groundY(c.x, c.z), c.z);
    }
    this.targetRing.show(this.state === 'TO_TARGET');
    this.depot.marker.show(this.state === 'TO_DEPOT');
  }

  _resetRun() {
    this.carsDone = 0;
    this.arrested = false;
    this.outTime = 0;
    this.dwellTimer = 0;
    this.paySoFar = 0;
  }

  _startRound() {
    if (!this._setupSites()) {
      this.cooldown = COOLDOWN;
      return;
    }
    this._resetRun();
    this.state = 'TO_TARGET';
  }

  _end(phase) { this.state = phase; this.cooldown = COOLDOWN; this.dwellTimer = 0; this.outTime = 0; }

  forceRepo(carPos, heading = 0) {
    this._setupSites(); // best effort: staging must not depend on site selection succeeding
    this._resetRun();
    const x = carPos.x + Math.sin(heading) * FORCE_AHEAD;
    const z = carPos.z + Math.cos(heading) * FORCE_AHEAD;
    this.depot.x = x; this.depot.z = z;
    this.depot.marker.setPos(x, this._groundY(x, z), z);
    this.carsDone = 1;
    this.paySoFar = REPO.PER_CAR;
    this.arrested = false;
    this.state = 'TO_DEPOT';
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this._syncVisuals();
  }

  _checkOut(dt, inCar, onEvent) {
    if (inCar) { this.outTime = 0; return false; }
    this.outTime += dt;
    if (this.outTime <= OUT_TIME_LIMIT) return false;
    if (onEvent) onEvent({ type: 'repo', phase: 'failed', pay: 0, bonus: 0, timeLeft: 0 });
    this._end('FAILED');
    return true;
  }

  _collect(onEvent) {
    if (onEvent) onEvent({ type: 'repo', phase: 'collected', pay: 0, bonus: 0, timeLeft: 0 });
    if (this.world.wanted && typeof this.world.wanted.raiseTo === 'function') {
      const stars = this.world.wanted.stars || 0;
      this.world.wanted.raiseTo(Math.min(stars + 1, 3));
    }
    this.state = 'TO_DEPOT';
    this.dwellTimer = 0;
  }

  _deliver(onEvent) {
    this.carsDone++;
    this.paySoFar += REPO.PER_CAR;
    if (onEvent) onEvent({ type: 'repo', phase: 'delivered', pay: REPO.PER_CAR, bonus: 0, timeLeft: 0 });
    if (this.carsDone < REPO.CARS_TOTAL) {
      this.state = 'TO_TARGET';
    } else {
      if (onEvent) onEvent({ type: 'repo', phase: 'paid', pay: 0, bonus: this.arrested ? 0 : REPO.NO_ARREST_BONUS, timeLeft: 0 });
      this._end('PAID');
    }
    this.dwellTimer = 0;
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, onEvent } = ctx;
    if (!carPos || !(dt > 0)) return;
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this.time += dt;
    const stopped = !!inCar && Math.abs(carSpeed || 0) < 1;

    switch (this.state) {
      case 'IDLE':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this._startRound();
        break;

      case 'TO_TARGET':
        if (this._checkOut(dt, inCar, onEvent)) break;
        if (this.world.fx && this.world.fx.kind === 'busted') { this.arrested = true; if (onEvent) onEvent({ type: 'repo', phase: 'failed', pay: 0, bonus: 0, timeLeft: 0 }); this._end('FAILED'); break; }
        if (stopped && this._dist(carPos, this.cars[this.carsDone]) <= SITE_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= DWELL) this._collect(onEvent);
        } else {
          this.dwellTimer = 0;
        }
        break;

      case 'TO_DEPOT':
        if (this._checkOut(dt, inCar, onEvent)) break;
        if (this.world.fx && this.world.fx.kind === 'busted') { this.arrested = true; if (onEvent) onEvent({ type: 'repo', phase: 'failed', pay: 0, bonus: 0, timeLeft: 0 }); this._end('FAILED'); break; }
        if (stopped && this._dist(carPos, this.depot) <= SITE_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= DWELL) this._deliver(onEvent);
        } else {
          this.dwellTimer = 0;
        }
        break;

      case 'PAID':
      case 'FAILED':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this.state = 'IDLE';
        break;
    }

    this._syncVisuals();
    this.depot.marker.bob(this.time);
    this.targetRing.bob(this.time);
  }

  hudState() {
    const visible = this.state === 'TO_TARGET' || this.state === 'TO_DEPOT';
    let distanceLeft = 0;
    const t = this.targetPos();
    if (t && this.lastPlayer) {
      const d = this._dist(this.lastPlayer, t);
      distanceLeft = Number.isFinite(d) ? d : 0;
    }
    const pay = Number.isFinite(this.paySoFar) ? this.paySoFar : 0;
    return { visible, label: 'REPO MAN', pay, distanceLeft, timeLeft: 0, timeTotal: 0, carsDone: this.carsDone, carsTotal: REPO.CARS_TOTAL };
  }

  targetPos() {
    if (this.state === 'TO_TARGET') return { x: this.cars[this.carsDone].x, z: this.cars[this.carsDone].z };
    if (this.state === 'TO_DEPOT') return { x: this.depot.x, z: this.depot.z };
    return null;
  }
}
