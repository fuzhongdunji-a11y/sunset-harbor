// driftKing: the Drift King job. Drive through 6 corners, build score while drifting.
// Implements pattern similar to CheckpointRallyService.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// Configuration constants.
export const DRIFT = {
  PER_CORNER: 150,
  BASE_PAY: 100,
  SCORE_BONUS_PER_POINT: 0.25,
  SCORE_BONUS_CAP: 400,
  CORNERS_TOTAL: 6,
  CORNER_TARGET: 300,
};

const ZONE_RADIUS = 18;
const OUT_OF_CAR_LIMIT = 20;
const COOLDOWN = 20;
const FIRST_DELAY = 12;
const MIN_CORNERS = 100; // spacing between sampled anchors
const DRIFT_SPEED = 12; // used for clock calculation
const DRIFT_BASE_CLOCK = 60; // extra seconds added after route time

// Bobbing orange‑red ring marker for current corner.
class Marker {
  constructor(scene, color) {
    const geom = new THREE.RingGeometry(ZONE_RADIUS - 1.2, ZONE_RADIUS, 48, 1, 0, Math.PI * 2);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.baseY = 0;
    scene.add(this.mesh);
  }
  setPos(x, y, z) {
    this.baseY = y;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.set(1, 1, 1);
  }
  show(v) { this.mesh.visible = v; }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
}

// Utility helpers.
function finiteXZ(p) { return !!p && Number.isFinite(p.x) && Number.isFinite(p.z); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// Farthest‑point sampling for anchors.
// Removed unused placeholder extend function
export class DriftKingService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < 330) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 6151 + 29) >>> 0);
    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.timeTotal = 0;
    this.timeLeft = 0;
    this.lastCarPos = null;
    this.cornersDone = 0;
    this.cornersTotal = DRIFT.CORNERS_TOTAL;
    this.outTime = 0;
    this.cornerScore = 0;
    this.totalScore = 0;
    this.currentCornerIndex = 0;
    this.gates = [];
    this.ringMarker = new Marker(scene, 0xff6a33);
    this.ringTime = 0;
  }

  // Sampling helpers.
  _extend(picked, n, minDist) {
    const added = [];
    while (added.length < n) {
      let best = null;
      let bestD = -1;
      for (const a of this.anchors) {
        if (picked.includes(a) || added.includes(a)) continue;
        let d = Infinity;
        for (const p of picked) d = Math.min(d, dist(a, p));
        for (const p of added) d = Math.min(d, dist(a, p));
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
    const rest = this._extend([first], DRIFT.CORNERS_TOTAL - 1, MIN_CORNERS);
    if (rest.length === DRIFT.CORNERS_TOTAL - 1) return [first, ...rest].map(a => ({ x: a.x, z: a.z }));
    return null;
  }

  _fixClock() {
    if (!finiteXZ(this.lastCarPos)) {
      // No car position yet; use distance between gates only
      let route = 0;
      for (let i = 0; i < this.gates.length - 1; i++) {
        route += dist(this.gates[i], this.gates[i + 1]);
      }
      this.timeTotal = route / DRIFT_SPEED + DRIFT_BASE_CLOCK;
      this.timeLeft = this.timeTotal;
      return;
    }
    let route = dist(this.lastCarPos, this.gates[0]);
    for (let i = 0; i < DRIFT.CORNERS_TOTAL - 1; i++) route += dist(this.gates[i], this.gates[i + 1]);
    this.timeTotal = route / DRIFT_SPEED + DRIFT_BASE_CLOCK;
    this.timeLeft = this.timeTotal;
  }

  _resetRound() {
    this.cornersDone = 0;
    this.totalScore = 0;
    this.cornerScore = 0;
    this.outTime = 0;
    this.currentCornerIndex = 0;
    this.ringMarker.show(false);
  }

  _end(phase) {
    this.state = phase;
    this.cooldown = COOLDOWN;
    this._syncVisuals();
  }

  _syncVisuals() {
    const vis = this.state === 'DRIFTING';
    this.ringMarker.show(vis);
  }

  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') ctx.onEvent({ type: 'drift', phase, pay, bonus, timeLeft });
  }

  _fail(ctx) {
    this.timeLeft = Math.max(0, this.timeLeft);
    this._emit(ctx, 'failed', 0, 0, this.timeLeft);
    this._end('FAILED');
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};
    if (this.state === 'IDLE') {
      // remember where the car is so the round clock can be fixed from the real route length
      if (ctx.inCar && finiteXZ(ctx.carPos)) this.lastCarPos = { x: ctx.carPos.x, z: ctx.carPos.z };
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (this._setupRound()) {
          this.state = 'DRIFTING';
          this._resetRound();
          this._syncVisuals();
          if (this.gates.length > 0) {
            const g = this.gates[0];
            this.ringMarker.setPos(g.x, 0, g.z);
            this.ringMarker.show(true);
          }
        } else {
          this.cooldown = COOLDOWN;
        }
      }
      return;
    }

    if (this.state !== 'DRIFTING') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) { this.state = 'IDLE'; this.cooldown = 0; }
      return;
    }

    this.ringTime += dt;
    this.ringMarker.bob(this.ringTime);

    const inCar = !!ctx.inCar;
    if (finiteXZ(ctx.carPos) && inCar) this.lastCarPos = { x: ctx.carPos.x, z: ctx.carPos.z };

    // Clock and out‑of‑car timer.
    this.timeLeft -= dt;
    if (inCar) this.outTime = 0; else this.outTime += dt;
    if (this.timeLeft <= 0 || this.outTime > OUT_OF_CAR_LIMIT) { this._fail(ctx); return; }

    // Scoring.
    const cur = this.targetPos();
    if (cur && inCar && finiteXZ(ctx.carPos)) {
      const d = dist(ctx.carPos, cur);
      if (d <= ZONE_RADIUS) {
        const slip = Number.isFinite(ctx.carSlip) ? ctx.carSlip : 0;
        const speed = Math.abs(ctx.carSpeed || 0);
        if (slip >= 2.5 && speed >= 8) {
          const delta = slip * speed * dt * 2;
          this.cornerScore += delta;
          this.totalScore += delta;
        }
      }
    }

    // Corner clear.
    if (this.cornerScore >= DRIFT.CORNER_TARGET) {
      this.cornersDone += 1;
      const rounded = Math.max(0, this.timeLeft);
      this._emit(ctx, 'corner', DRIFT.PER_CORNER, 0, rounded);
      this.cornerScore = 0;
      if (this.cornersDone >= DRIFT.CORNERS_TOTAL) {
        const bonus = Math.min(DRIFT.SCORE_BONUS_CAP, Math.floor(this.totalScore * DRIFT.SCORE_BONUS_PER_POINT));
        this._emit(ctx, 'paid', DRIFT.BASE_PAY, bonus, rounded);
        this._end('PAID');
      } else {
        this.currentCornerIndex += 1;
        const g = this.gates[this.currentCornerIndex];
        this.ringMarker.setPos(g.x, 0, g.z);
      }
    }
  }

  _setupRound() {
    const sites = this._chooseSites();
    if (!sites) return false;
    this.gates = sites;
    this._fixClock();
    return true;
  }

  hudState() {
    const target = this.targetPos();
    let distLeft = 0;
    if (target && finiteXZ(this.lastCarPos)) distLeft = dist(this.lastCarPos, target);
    if (!Number.isFinite(distLeft)) distLeft = 0;
    const left = Number.isFinite(this.timeLeft) ? Math.max(0, this.timeLeft) : 0;
    return {
      visible: this.state === 'DRIFTING',
      label: 'DRIFT KING',
      pay: DRIFT.PER_CORNER * this.cornersDone,
      distanceLeft: distLeft,
      timeLeft: left,
      timeTotal: Number.isFinite(this.timeTotal) ? this.timeTotal : 0,
      cornersDone: this.cornersDone,
      cornersTotal: DRIFT.CORNERS_TOTAL,
      score: Math.floor(this.totalScore),
    };
  }

  targetPos() {
    return this.state === 'DRIFTING' && this.currentCornerIndex < this.gates.length ? this.gates[this.currentCornerIndex] : null;
  }

  forceDrift(carPos, heading = 0) {
    if (!finiteXZ(carPos)) return false;
    const h = Number.isFinite(heading) ? heading : 0;
    const sites = this._chooseSites() || [];
    // pad from anchors if sampling was impossible (keeps the shot working on any layout)
    for (let i = 0; sites.length < DRIFT.CORNERS_TOTAL && i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (!sites.some((s) => s.x === a.x && s.z === a.z)) sites.push({ x: a.x, z: a.z });
    }
    if (sites.length < DRIFT.CORNERS_TOTAL) return false;
    sites[0] = { x: carPos.x + Math.sin(h) * 35, z: carPos.z + Math.cos(h) * 35 };
    this.ringTime = 0;
    this.gates = sites;
    this.timeTotal = DRIFT_BASE_CLOCK;
    this.timeLeft = DRIFT_BASE_CLOCK;
    this.lastCarPos = { x: carPos.x, z: carPos.z };
    this.cornersDone = 1;
    this.totalScore = 300;
    this.cornerScore = 150;
    this.currentCornerIndex = 0;
    this.outTime = 0;
    this.state = 'DRIFTING';
    this.cooldown = 0;
    this.ringMarker.setPos(this.gates[0].x, 0, this.gates[0].z);
    this.ringMarker.show(true);
    return true;
  }
}
