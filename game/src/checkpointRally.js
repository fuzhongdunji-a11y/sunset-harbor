// checkpointRally: the Checkpoint Rally job. Drive through 6 gates in order against a fixed clock to earn money.
// States: IDLE -> RACING -> (PAID | FAILED) -> 20s cooldown -> IDLE. First round 12 s after load.
// Gate sites come only from the layout anchors (layout.xs x layout.zs, z < 330); props are pooled and built once.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const RALLY = {
  BASE_PAY: 200,
  PER_GATE: 100,
  GATE_TIME_BONUS: 8,
  TIME_BONUS_PER_SEC: 10,
  TIME_BONUS_CAP: 300,
  CLEAN_BONUS: 250,
  CLEAN_DAMAGE_MAX: 10,
};

const GATES = 6;
const PASS_RADIUS = 8;
const MIN_GATE_GAP = 100;
const OUT_OF_CAR_LIMIT = 20;
const COOLDOWN = 20;
const FIRST_DELAY = 12;
const AVG_SPEED = 12;
const SLACK = 40;
const NO_CAR_TOTAL = 240;
const ZONE_Z_MAX = 330;

// Bobbing blue ring that marks the current gate.
class Marker {
  constructor(scene, color) {
    const geom = new THREE.RingGeometry(2.0, 2.5, 32, 1, 0, Math.PI * 2);
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
  }
  show(v) { this.mesh.visible = v; }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
}

// One gate arch (two posts + top bar), centred on the group origin, spanning local X, facing local +Z.
function buildGateArch(scene) {
  const g = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0x666666, flatShading: true });
  const topMat = new THREE.MeshLambertMaterial({ color: 0x4da6ff, flatShading: true });
  const postGeo = new THREE.BoxGeometry(0.5, 5, 0.5);
  const left = new THREE.Mesh(postGeo, postMat);
  left.position.set(-3.5, 2.5, 0);
  const right = new THREE.Mesh(postGeo, postMat);
  right.position.set(3.5, 2.5, 0);
  const top = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.5, 0.5), topMat);
  top.position.set(0, 5.1, 0);
  g.add(left, right, top);
  g.visible = false;
  scene.add(g);
  return g;
}

const finiteXZ = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);

export class CheckpointRallyService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < ZONE_Z_MAX) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 6151 + 29) >>> 0);
    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.timeTotal = 0;
    this.timeLeft = 0;
    this.lastCarPos = null;
    this.gatesDone = 0;
    this.gatesTotal = GATES;
    this.runDamage = 0;
    this.currentGateIndex = 0;
    this.outTime = 0;
    this.ringTime = 0;
    this.gates = [];

    // pooled props, built once
    this.arches = [];
    for (let i = 0; i < GATES; i++) this.arches.push(buildGateArch(scene));
    this.ringMarker = new Marker(scene, 0x4da6ff);
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  // Farthest-point sampling: each new gate maximises its distance to the already chosen ones (>= minDist).
  _extend(picked, n, minDist) {
    const added = [];
    while (added.length < n) {
      let best = null;
      let bestD = -1;
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
    const rest = this._extend([first], GATES - 1, MIN_GATE_GAP);
    if (rest.length === GATES - 1) return [first, ...rest].map((a) => ({ x: a.x, z: a.z }));
    return null;
  }

  // Fix the round clock ONCE from the route length. Never recomputed afterwards.
  _fixClock() {
    if (!finiteXZ(this.lastCarPos)) { this.timeTotal = NO_CAR_TOTAL; this.timeLeft = NO_CAR_TOTAL; return; }
    let route = this._dist(this.lastCarPos, this.gates[0]);
    for (let i = 0; i < GATES - 1; i++) route += this._dist(this.gates[i], this.gates[i + 1]);
    this.timeTotal = route / AVG_SPEED + SLACK;
    this.timeLeft = this.timeTotal;
  }

  // Place the pooled arches (each facing the next gate; the last keeps the previous heading) and the ring.
  _placeProps() {
    for (let i = 0; i < GATES; i++) {
      const gate = this.gates[i];
      const arch = this.arches[i];
      const from = i < GATES - 1 ? gate : this.gates[i - 1];
      const to = i < GATES - 1 ? this.gates[i + 1] : gate;
      arch.position.set(gate.x, 0, gate.z);
      arch.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      arch.visible = true;
    }
    this.ringMarker.setPos(this.gates[0].x, 0, this.gates[0].z);
    this.ringMarker.mesh.scale.set(1, 1, 1);
    this.ringMarker.show(true);
  }

  _resetRound() {
    this.gatesDone = 0;
    this.runDamage = 0;
    this.currentGateIndex = 0;
    this.outTime = 0;
    this.ringTime = 0;
    this._placeProps();
  }

  _end(phase) {
    this.state = phase;
    this.cooldown = COOLDOWN;
    this._syncVisuals();
  }

  _syncVisuals() {
    const vis = this.state === 'RACING';
    for (const arch of this.arches) arch.visible = vis;
    this.ringMarker.show(vis);
  }

  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') ctx.onEvent({ type: 'rally', phase, pay, bonus, timeLeft });
  }

  _fail(ctx) {
    this._emit(ctx, 'failed', 0, 0, Math.max(0, this.timeLeft));
    this._end('FAILED');
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};
    if (this.state === 'IDLE') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (this._setupRound()) {
          this.state = 'RACING';
          this._resetRound();
        } else {
          this.cooldown = COOLDOWN; // sampling failed: stay IDLE, retry after the cooldown
        }
      }
      return;
    }

    if (this.state !== 'RACING') {
      // PAID or FAILED: cooldown back to IDLE
      this.cooldown -= dt;
      if (this.cooldown <= 0) { this.state = 'IDLE'; this.cooldown = 0; }
      return;
    }

    this.ringTime += dt;
    this.ringMarker.bob(this.ringTime);

    const inCar = !!ctx.inCar;
    if (finiteXZ(ctx.carPos) && inCar) this.lastCarPos = { x: ctx.carPos.x, z: ctx.carPos.z };
    if (Number.isFinite(ctx.carDamageDelta)) this.runDamage += Math.max(0, ctx.carDamageDelta);

    // clock (fixed at round start; only counts down) and out-of-car timer
    this.timeLeft -= dt;
    if (inCar) this.outTime = 0; else this.outTime += dt;
    if (this.timeLeft <= 0 || this.outTime > OUT_OF_CAR_LIMIT) { this._fail(ctx); return; }

    // gate pass: in the car, within 8 m of the CURRENT gate only (no dwell, any speed)
    if (inCar && finiteXZ(ctx.carPos) && this._dist(ctx.carPos, this.gates[this.currentGateIndex]) <= PASS_RADIUS) {
      this.gatesDone += 1;
      this.timeLeft += RALLY.GATE_TIME_BONUS;
      this._emit(ctx, 'gate', RALLY.PER_GATE, 0, this.timeLeft);
      if (this.gatesDone >= GATES) {
        const timeBonus = Math.min(RALLY.TIME_BONUS_CAP, Math.floor(this.timeLeft) * RALLY.TIME_BONUS_PER_SEC);
        const cleanBonus = this.runDamage < RALLY.CLEAN_DAMAGE_MAX ? RALLY.CLEAN_BONUS : 0;
        this._emit(ctx, 'paid', RALLY.BASE_PAY + timeBonus, cleanBonus, this.timeLeft);
        this._end('PAID');
      } else {
        this.currentGateIndex += 1;
        const g = this.gates[this.currentGateIndex];
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
    let dist = 0;
    if (target && finiteXZ(this.lastCarPos)) dist = this._dist(this.lastCarPos, target);
    if (!Number.isFinite(dist)) dist = 0;
    const left = Number.isFinite(this.timeLeft) ? Math.max(0, this.timeLeft) : 0;
    return {
      visible: this.state === 'RACING',
      label: 'CHECKPOINT RALLY',
      pay: RALLY.PER_GATE * this.gatesDone,
      distanceLeft: dist,
      timeLeft: left,
      timeTotal: Number.isFinite(this.timeTotal) ? this.timeTotal : 0,
      gatesDone: this.gatesDone,
      gatesTotal: this.gatesTotal,
    };
  }

  targetPos() {
    if (this.state === 'RACING' && this.currentGateIndex < this.gates.length) return this.gates[this.currentGateIndex];
    return null;
  }

  // Staging helper: enter RACING with gate 1 about 35 m ahead of carPos along heading; clock fixed 90/90.
  forceRally(carPos, heading = 0) {
    if (!finiteXZ(carPos)) return false;
    const h = Number.isFinite(heading) ? heading : 0;
    const sites = this._chooseSites() || [];
    // pad from anchors if sampling was impossible (keeps the shot working on any layout)
    for (let i = 0; sites.length < GATES && i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (!sites.some((s) => s.x === a.x && s.z === a.z)) sites.push({ x: a.x, z: a.z });
    }
    if (sites.length < GATES) return false;
    sites[0] = { x: carPos.x + Math.sin(h) * 35, z: carPos.z + Math.cos(h) * 35 };
    this.gates = sites;
    this.timeTotal = 90;
    this.timeLeft = 90;
    this.lastCarPos = { x: carPos.x, z: carPos.z };
    this.state = 'RACING';
    this.cooldown = 0;
    this._resetRound();
    return true;
  }
}
