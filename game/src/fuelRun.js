// fuelRun: the Harbor Fuel Run job. Load fuel at a depot, then deliver it to three marina boat berths.
// States: IDLE -> TO_DEPOT -> TO_BOAT (x3 legs) -> (PAID | FAILED) -> 20s cooldown -> IDLE.
// Sites come only from world.layout anchors (xs x zs); rings and the drum are pooled so rounds never grow the scene.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// public constants (max run total = 3 * 250 + 150 + 200 = $1,100)
export const FUEL_RUN = {
  PER_BOAT: 250,
  BASE_PAY: 150,
  ON_TIME_BONUS: 200,
  LEAK_PER_HP: 2,
  LEAK_MAX: 120,
};

const BOATS_TOTAL = 3;
const FIRST_DELAY = 12; // seconds after load before the first round
const OUT_TIME_LIMIT = 20; // seconds continuously out of the car during TO_DEPOT / TO_BOAT
const SITE_R = 7; // distance to depot / berth for loading and delivery
const DWELL = 1.0; // seconds stopped inside the ring
const COOLDOWN = 20; // seconds after PAID / FAILED
const MIN_SITE_DIST = 120; // min distance between any two sites
const MARINA_Z = 150; // berths prefer anchors at or beyond this z (the waterfront)
const MAX_Z = 330; // anchors must stay on land (sea is z > 340)
const LEG_SPEED = 11; // m/s used to size a leg timer
const LEG_BASE_TIME = 30; // seconds added to every leg timer
const FORCE_AHEAD = 35; // forceFuel: berth ring this far ahead of the car
const FORCE_LEG_TIME = 60;
const DEPOT_COLOR = 0xff9933;
const BERTH_COLOR = 0x33ccff;

// shared geometry
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const drumGeom = new THREE.CylinderGeometry(0.5, 0.5, 1.0, 14);
const drumMat = new THREE.MeshLambertMaterial({ color: 0xd9531e });

// bobbing ground ring
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.baseY = 0;
    scene.add(this.mesh);
  }
  setPos(x, y, z) {
    this.baseY = y;
    this.mesh.position.set(x, y, z);
  }
  show(v) { this.mesh.visible = v; }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
}

export class FuelRunService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < MAX_Z) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 4993 + 13) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;
    this.lastPlayer = null;

    // pooled site objects (created once, hidden until a round places them)
    this.depot = { x: 0, z: 0, marker: new Marker(scene, DEPOT_COLOR) };
    this.drum = new THREE.Mesh(drumGeom, drumMat);
    this.drum.visible = false;
    scene.add(this.drum);
    this.boats = [];
    for (let i = 0; i < BOATS_TOTAL; i++) this.boats.push({ x: 0, z: 0, marker: new Marker(scene, BERTH_COLOR) });

    this.paySoFar = 0; // per-boat pay earned this run
    this.legIndex = 0;
    this.legTimeTotal = 0;
    this.legTimeLeft = 0;
    this.legDamage = 0;
    this.allOnTime = true;
    this.outTime = 0;
    this.dwellTimer = 0;
  }

  _dist(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  _groundY(x, z) {
    const L = this.world.layout;
    return (L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08;
  }

  // Farthest-point sampling continuing from `picked`: each new site is the candidate farthest from the nearest
  // picked one, among those at least minDist away. Returns the sites added (fewer than n if the spacing can't be met).
  _extend(picked, list, n, minDist) {
    const added = [];
    while (added.length < n) {
      let best = null, bestD = -1;
      for (const a of list) {
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

  // depot first, then three berths in sampled order (berths prefer the waterfront when >= 3 anchors qualify)
  _chooseSites() {
    if (this.anchors.length === 0) return null;
    const depot = this.rng.pick(this.anchors);
    const marina = this.anchors.filter((a) => a.z >= MARINA_Z && a !== depot);
    const pools = marina.length >= BOATS_TOTAL ? [marina, this.anchors] : [this.anchors];
    for (const pool of pools) {
      const berths = this._extend([depot], pool, BOATS_TOTAL, MIN_SITE_DIST);
      if (berths.length === BOATS_TOTAL) return [depot, ...berths];
    }
    return null;
  }

  _setupSites() {
    const sites = this._chooseSites();
    if (!sites) return false;
    this.depot.x = sites[0].x;
    this.depot.z = sites[0].z;
    const dy = this._groundY(this.depot.x, this.depot.z);
    this.depot.marker.setPos(this.depot.x, dy, this.depot.z);
    this.drum.position.set(this.depot.x + 1.2, dy + 0.5, this.depot.z);
    this.boats.forEach((b, i) => {
      b.x = sites[i + 1].x;
      b.z = sites[i + 1].z;
      b.marker.setPos(b.x, this._groundY(b.x, b.z), b.z);
    });
    return true;
  }

  // marker/drum visibility is a pure function of the state
  _syncVisuals() {
    const toDepot = this.state === 'TO_DEPOT';
    const toBoat = this.state === 'TO_BOAT';
    this.depot.marker.show(toDepot);
    this.drum.visible = toDepot;
    this.boats.forEach((b, i) => b.marker.show(toBoat && i === this.legIndex));
  }

  _resetRun() {
    this.paySoFar = 0;
    this.legIndex = 0;
    this.legTimeTotal = 0;
    this.legTimeLeft = 0;
    this.legDamage = 0;
    this.allOnTime = true;
    this.outTime = 0;
    this.dwellTimer = 0;
  }

  _startRound() {
    if (!this._setupSites()) {
      this.cooldown = COOLDOWN; // no valid layout: retry later instead of spinning
      return;
    }
    this._resetRun();
    this.state = 'TO_DEPOT';
  }

  // the leg timer is fixed here from the straight-line distance and never recomputed
  _startLeg(index) {
    const start = index === 0 ? this.depot : this.boats[index - 1];
    this.legIndex = index;
    this.legTimeTotal = this._dist(start, this.boats[index]) / LEG_SPEED + LEG_BASE_TIME;
    this.legTimeLeft = this.legTimeTotal;
    this.legDamage = 0;
    this.dwellTimer = 0;
  }

  _end(phase) {
    this.state = phase; // 'PAID' | 'FAILED'
    this.cooldown = COOLDOWN;
    this.dwellTimer = 0;
    this.outTime = 0;
  }

  // forceFuel: staging for ?shot=fuel. carPos is the car position and heading its yaw (forward = (sin h, cos h)).
  // Loading is complete and the first berth ring sits FORCE_AHEAD metres ahead of the car.
  forceFuel(carPos, heading = 0) {
    this._setupSites();
    this._resetRun();
    const b = this.boats[0];
    b.x = carPos.x + Math.sin(heading) * FORCE_AHEAD;
    b.z = carPos.z + Math.cos(heading) * FORCE_AHEAD;
    b.marker.setPos(b.x, this._groundY(b.x, b.z), b.z);
    this.legIndex = 0;
    this.legTimeTotal = FORCE_LEG_TIME;
    this.legTimeLeft = FORCE_LEG_TIME;
    this.state = 'TO_BOAT';
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this._syncVisuals();
  }

  // out-of-car timer shared by TO_DEPOT and TO_BOAT; returns true when the job failed
  _checkOut(dt, inCar, onEvent) {
    if (inCar) { this.outTime = 0; return false; }
    this.outTime += dt;
    if (this.outTime <= OUT_TIME_LIMIT) return false;
    const timeLeft = this.state === 'TO_BOAT' ? this.legTimeLeft : 0;
    if (onEvent) onEvent({ type: 'fuel', phase: 'failed', pay: 0, bonus: 0, timeLeft });
    this._end('FAILED');
    return true;
  }

  _deliver(onEvent) {
    const late = this.legTimeLeft <= 0;
    const leak = Math.min(FUEL_RUN.LEAK_MAX, Math.floor(this.legDamage) * FUEL_RUN.LEAK_PER_HP);
    let boatPay = Math.max(0, FUEL_RUN.PER_BOAT - leak);
    if (late) {
      boatPay = Math.floor(boatPay / 2);
      this.allOnTime = false;
    }
    this.paySoFar += boatPay;
    if (onEvent) onEvent({ type: 'fuel', phase: 'delivered', pay: boatPay, bonus: 0, timeLeft: this.legTimeLeft });
    if (this.legIndex + 1 < BOATS_TOTAL) {
      this._startLeg(this.legIndex + 1);
    } else {
      const bonus = this.allOnTime ? FUEL_RUN.ON_TIME_BONUS : 0;
      if (onEvent) onEvent({ type: 'fuel', phase: 'paid', pay: FUEL_RUN.BASE_PAY, bonus, timeLeft: this.legTimeLeft });
      this._end('PAID');
    }
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, carDamageDelta, onEvent } = ctx;
    if (!carPos || !(dt > 0)) return;
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this.time += dt;
    const stopped = !!inCar && Math.abs(carSpeed || 0) < 1;

    switch (this.state) {
      case 'IDLE':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this._startRound();
        break;

      case 'TO_DEPOT':
        if (this._checkOut(dt, inCar, onEvent)) break;
        if (stopped && this._dist(carPos, this.depot) <= SITE_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= DWELL) {
            if (onEvent) onEvent({ type: 'fuel', phase: 'loaded', pay: 0, bonus: 0, timeLeft: 0 });
            this._startLeg(0);
            this.state = 'TO_BOAT';
          }
        } else {
          this.dwellTimer = 0;
        }
        break;

      case 'TO_BOAT': {
        if (this._checkOut(dt, inCar, onEvent)) break;
        this.legTimeLeft = Math.max(0, this.legTimeLeft - dt); // late legs stay at 0, never fail
        if (Number.isFinite(carDamageDelta) && carDamageDelta > 0) this.legDamage += carDamageDelta;
        if (stopped && this._dist(carPos, this.boats[this.legIndex]) <= SITE_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= DWELL) this._deliver(onEvent);
        } else {
          this.dwellTimer = 0;
        }
        break;
      }

      case 'PAID':
      case 'FAILED':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this.state = 'IDLE';
        break;
    }

    this._syncVisuals();
    this.depot.marker.bob(this.time);
    for (const b of this.boats) b.marker.bob(this.time);
  }

  hudState() {
    const visible = this.state === 'TO_DEPOT' || this.state === 'TO_BOAT';
    let distanceLeft = 0;
    const t = this.targetPos();
    if (t && this.lastPlayer) {
      const d = this._dist(this.lastPlayer, t);
      distanceLeft = Number.isFinite(d) ? d : 0;
    }
    const inLeg = this.state === 'TO_BOAT';
    const timeLeft = inLeg && Number.isFinite(this.legTimeLeft) ? this.legTimeLeft : 0;
    const timeTotal = inLeg && Number.isFinite(this.legTimeTotal) ? this.legTimeTotal : 0;
    const pay = Number.isFinite(this.paySoFar) ? this.paySoFar : 0;
    return { visible, label: 'FUEL RUN', pay, distanceLeft, timeLeft, timeTotal };
  }

  targetPos() {
    if (this.state === 'TO_DEPOT') return { x: this.depot.x, z: this.depot.z };
    if (this.state === 'TO_BOAT') {
      const b = this.boats[this.legIndex];
      return { x: b.x, z: b.z };
    }
    return null;
  }
}
