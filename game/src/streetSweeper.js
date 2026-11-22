// streetSweeper: the Street Sweeper job. Drive to checkpoints, clean streets, earn money.
// States: IDLE -> SWEEPING -> (PAID | FAILED) -> 20s cooldown -> IDLE.
// First round starts after 12s. Five farthest-point sampled checkpoints from world.layout xs/zs intersections
// with z<330 and >=100m apart, exposed as this.anchors and this.checkpoints.
// legClean advances ONLY while inCar and 3<=|carSpeed|<=9, legNeed=legDist/6 fixed at leg start.
// leg completes within 8m of checkpoint emitting 'checkpoint'. After 5th checkpoint emit 'paid' with pay=floor(800*finalCleanRate) and bonus=300.
// fail on >20s out of car emitting 'failed'. All onEvent payloads carry {type:'sweeper', phase, pay, bonus, timeLeft}.
// Pooled mint 0x35f2c8 ring marker and pooled checkpoint props built once in constructor.
// hudState() and targetPos() per brief, forceSweep(carPos, heading) per brief.
// imports only three from '../vendor/three.module.min.js' and makeRng from './rng.js'.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// Public constants
export const SWEEP = {
  BASE_PAY: 800,
  FINISH_BONUS: 300,
  CHECKPOINTS_TOTAL: 5,
  SPEED_MIN: 3, // sweeping speed band (m/s)
  SPEED_MAX: 9,
  SITE_R: 8, // checkpoint ring radius (matches COMPLETE_R)
  COMPLETE_R: 8, // leg completes within this distance of the checkpoint
  OUT_OF_CAR_LIMIT: 20,
  COOLDOWN: 20,
  FORCE_AHEAD: 35,
  CRITERION_MIN_DIST: 100,
  MAX_Z: 330,
  FIRST_DELAY: 12,
};

const {
  BASE_PAY,
  FINISH_BONUS,
  CHECKPOINTS_TOTAL,
  SPEED_MIN,
  SPEED_MAX,
  SITE_R,
  COMPLETE_R,
  OUT_OF_CAR_LIMIT,
  COOLDOWN,
  FORCE_AHEAD,
  CRITERION_MIN_DIST,
  MAX_Z,
  FIRST_DELAY,
} = SWEEP;

// pooled mint 0x35f2c8 ring marker
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(SITE_R - 0.8, SITE_R, 40, 1, 0, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  setPos(x, y, z) { this.mesh.position.set(x, y, z); }
  show(v) { this.mesh.visible = v; }
}

// simple checkpoint prop (small cone with slight glow)
function buildCheckpointProp() {
  const g = new THREE.Group();
  const coneGeom = new THREE.ConeGeometry(0.3, 0.6, 12);
  const mat = new THREE.MeshLambertMaterial({ color: 0x35f2c8, flatShading: true });
  const cone = new THREE.Mesh(coneGeom, mat);
  cone.position.y = 0.3;
  g.add(cone);
  g.visible = false;
  return g;
}

export class StreetSweeperService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < MAX_Z) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 6151 + 29) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.outTime = 0;

    this.legClean = 0;
    this.legNeed = 0;
    this.legStartDist = 0;
    this.legPending = false;
    this.totalLegClean = 0;
    this.totalLegNeed = 0;
    this.checkpoints = [];
    this.checkpointIndex = 0;
    this.checkpointProps = [];
    this.currentCheckpoint = null;
    this.lastSeenCarPos = null;

    // pooled ring marker
    this.ringMarker = new Marker(scene, 0x35f2c8);

    // pooled checkpoint props (one per potential checkpoint)
    for (let i = 0; i < CHECKPOINTS_TOTAL; i++) {
      const prop = buildCheckpointProp();
      scene.add(prop);
      this.checkpointProps.push(prop);
    }
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  _groundY(x, z) { const L = this.world.layout; return (L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08; }

  // farthest-point sampling over anchors; every pick >= minDist from earlier picks
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
    const first = this.rng.pick(this.anchors);
    const rest = this._extend([first], CHECKPOINTS_TOTAL - 1, CRITERION_MIN_DIST);
    if (rest.length === CHECKPOINTS_TOTAL - 1) {
      return [first, ...rest].map(a => ({ x: a.x, z: a.z }));
    }
    return null;
  }

  _placeCheckpoints() {
    for (let i = 0; i < this.checkpoints.length; i++) {
      const p = this.checkpoints[i];
      const y = this._groundY(p.x, p.z);
      const prop = this.checkpointProps[i];
      prop.position.set(p.x, y, p.z);
    }
  }

  _syncProps() {
    // hide all props first
    for (const prop of this.checkpointProps) prop.visible = false;
    this.ringMarker.show(false);
    if (this.state === 'SWEEPING' && this.currentCheckpoint) {
      const idx = this.checkpoints.findIndex(c => c === this.currentCheckpoint);
      if (idx >= 0) {
        this.checkpointProps[idx].visible = true;
        const y = this._groundY(this.currentCheckpoint.x, this.currentCheckpoint.z);
        this.ringMarker.setPos(this.currentCheckpoint.x, y, this.currentCheckpoint.z);
        this.ringMarker.show(true);
      }
    }
  }

  _hideAll() {
    for (const prop of this.checkpointProps) prop.visible = false;
    this.ringMarker.show(false);
  }

  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') {
      ctx.onEvent({ type: 'sweeper', phase, pay, bonus, timeLeft: Math.max(0, timeLeft) });
    }
  }

  _fail(ctx) {
    this._emit(ctx, 'failed', 0, 0, 0);
    this.state = 'FAILED';
    this.cooldown = COOLDOWN;
    this._hideAll();
  }

  static _validPos(p) { return !!p && Number.isFinite(p.x) && Number.isFinite(p.z); }

  // start a leg from `from` (legClean reset, legDist/legNeed fixed once here); without a valid
  // position the need is fixed on the first update that sees the car.
  _beginLeg(from) {
    this.legClean = 0;
    if (StreetSweeperService._validPos(from) && this.currentCheckpoint) {
      this.legStartDist = this._dist(from, this.currentCheckpoint);
      this.legNeed = this.legStartDist / 6;
      this.legPending = false;
    } else {
      this.legStartDist = 0;
      this.legNeed = 0;
      this.legPending = true;
    }
  }

  _beginRound(sites, carPos) {
    this.checkpoints = sites;
    this.checkpointIndex = 0;
    this.currentCheckpoint = sites[0];
    this._placeCheckpoints();
    this.totalLegClean = 0;
    this.totalLegNeed = 0;
    this.outTime = 0;
    this.lastSeenCarPos = StreetSweeperService._validPos(carPos) ? { x: carPos.x, z: carPos.z } : null;
    this._beginLeg(this.lastSeenCarPos);
    this.state = 'SWEEPING';
    this._syncProps();
  }

  _startRound(carPos) {
    const sites = this._chooseSites();
    if (!sites) return false;
    this._beginRound(sites, carPos);
    return true;
  }

  // staging helper: first checkpoint = the anchor nearest the point FORCE_AHEAD m ahead of the car
  forceSweep(carPos, heading = 0) {
    if (!StreetSweeperService._validPos(carPos) || this.anchors.length === 0) return;
    const h = Number.isFinite(heading) ? heading : 0;
    const ahead = { x: carPos.x + Math.sin(h) * FORCE_AHEAD, z: carPos.z + Math.cos(h) * FORCE_AHEAD };
    let first = null; let bestD = Infinity;
    for (const a of this.anchors) {
      const d = this._dist(a, ahead);
      if (d < bestD) { bestD = d; first = a; }
    }
    if (!first) return;
    const rest = this._extend([first], CHECKPOINTS_TOTAL - 1, CRITERION_MIN_DIST);
    if (rest.length !== CHECKPOINTS_TOTAL - 1) return;
    // staging preset: the ahead anchor is checkpoint index 2; legs 0 and 1 are already done at
    // a 0.5 clean fraction (legNeed from the real leg distances), the current leg is untouched.
    const sites = [rest[0], rest[1], first, rest[2], rest[3]].map(a => ({ x: a.x, z: a.z }));
    this._beginRound(sites, carPos);
    const need0 = this._dist(carPos, sites[0]) / 6;
    const need1 = this._dist(sites[0], sites[1]) / 6;
    this.totalLegNeed = need0 + need1;
    this.totalLegClean = 0.5 * this.totalLegNeed;
    this.checkpointIndex = 2;
    this.currentCheckpoint = sites[2];
    this._beginLeg(this.lastSeenCarPos);
    this._syncProps();
    this.cooldown = 0;
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};

    if (this.state === 'IDLE') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (!this._startRound(ctx.carPos)) this.cooldown = COOLDOWN;
      }
      return;
    }

    if (this.state === 'SWEEPING') {
      const carPos = ctx.carPos && Number.isFinite(ctx.carPos.x) && Number.isFinite(ctx.carPos.z) ? ctx.carPos : null;
      if (carPos) this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
      const inCar = !!ctx.inCar;

      // out-of-car timer
      if (inCar) {
        this.outTime = 0;
      } else {
        this.outTime += dt;
        if (this.outTime > OUT_OF_CAR_LIMIT) { this._fail(ctx); return; }
      }

      // legNeed not yet fixed (round began without a car position): fix it now, once
      if (this.legPending && carPos) this._beginLeg(carPos);

      // leg progress: only in the car at sweeping speed; capped at legNeed
      const rawSpeed = Number(ctx.carSpeed);
      const speed = Number.isFinite(rawSpeed) ? Math.abs(rawSpeed) : 0;
      if (inCar && carPos && !this.legPending && speed >= SPEED_MIN && speed <= SPEED_MAX && this.currentCheckpoint) {
        this.legClean = Math.min(this.legNeed, this.legClean + dt);
      }

      // check completion
      if (this.currentCheckpoint && carPos && !this.legPending) {
        const d = this._dist(carPos, this.currentCheckpoint);
        if (d <= COMPLETE_R) {
          // checkpoint completed: weighted by legNeed, per-leg clean capped at legNeed
          this.totalLegClean += Math.min(this.legClean, this.legNeed);
          this.totalLegNeed += this.legNeed;
          this._emit(ctx, 'checkpoint', 0, 0, 0);
          this.checkpointIndex += 1;
          if (this.checkpointIndex >= CHECKPOINTS_TOTAL) {
            const pay = Math.floor(BASE_PAY * this._cleanRate());
            this._emit(ctx, 'paid', pay, FINISH_BONUS, 0);
            this.state = 'PAID';
            this.cooldown = COOLDOWN;
            this._hideAll();
          } else {
            // start next leg from where the car is now
            this.currentCheckpoint = this.checkpoints[this.checkpointIndex];
            this._beginLeg(carPos);
            this._syncProps();
          }
        }
      }
      return;
    }

    // PAID / FAILED cooldown
    if (this.state === 'PAID' || this.state === 'FAILED') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.state = 'IDLE';
        this.cooldown = 0;
      }
    }
  }

  // clean rate over completed legs plus the current one, weighted by legNeed; finite, in [0,1]
  _cleanRate(includeCurrent = false) {
    let clean = this.totalLegClean;
    let need = this.totalLegNeed;
    // an untouched current leg does not dilute the rate of the completed legs
    if (includeCurrent && this.legClean > 0) { clean += Math.min(this.legClean, this.legNeed); need += this.legNeed; }
    const r = need > 0 ? clean / need : 0;
    return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  }

  hudState() {
    const sweeping = this.state === 'SWEEPING';
    let distanceLeft = 0;
    if (sweeping && this.currentCheckpoint && this.lastSeenCarPos) {
      const d = this._dist(this.lastSeenCarPos, this.currentCheckpoint);
      distanceLeft = Number.isFinite(d) ? d : 0;
    }
    const frac = sweeping && this.legNeed > 0 ? Math.min(1, Math.max(0, this.legClean / this.legNeed)) : 0;
    const rate = sweeping ? this._cleanRate(true) : 0;
    return {
      visible: sweeping,
      label: 'STREET SWEEPER',
      pay: sweeping ? Math.floor(BASE_PAY * rate) : 0,
      bonus: FINISH_BONUS,
      checkpoint: Math.min(this.checkpointIndex, CHECKPOINTS_TOTAL),
      checkpointsTotal: CHECKPOINTS_TOTAL,
      cleanRate: rate,
      distanceLeft,
      timeLeft: 0,
      distanceDone: sweeping ? Math.max(0, this.legStartDist - distanceLeft) : 0,
      legFrac: frac,
    };
  }

  targetPos() {
    return this.state === 'SWEEPING' && this.currentCheckpoint ? { x: this.currentCheckpoint.x, z: this.currentCheckpoint.z } : null;
  }
}
