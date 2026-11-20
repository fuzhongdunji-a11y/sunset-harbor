// stuntDouble: the Stunt Double job. Film a stunt double doing ramp jumps.
// States: IDLE -> TO_RAMP -> FLIGHT -> TO_RAMP (next ramp) -> ... -> PAID | FAILED -> 20s cooldown -> IDLE.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// public constants
export const STUNT = {
  PER_STUNT: 200,
  AIR_BONUS_PER_SEC: 100,
  AIR_BONUS_CAP: 150,
  CLEAN_BONUS: 100,
  BASE_PAY: 150,
  MIN_SPEED: 14,
};

const RAMP_TOTAL = 3;
const FIRST_DELAY = 12; // seconds after load before the first round
const OUT_TIME_LIMIT = 20; // seconds continuously out of the car during TO_RAMP/FLIGHT
const SITE_R = 6; // distance to ramp ring for launch
const LAND_R = 8; // distance to landing ring for landing
const COOLDOWN = 20; // seconds after PAID/FAILED
const MIN_RAMP_DIST = 120; // min distance between ramps
const LEG_SPEED = 11; // m/s used to size the round timer
const LEG_BASE_TIME = 90; // seconds added to the round timer
const NO_CAR_TIME = 240; // round timer when no car position was ever seen
const MISS_TIME = 6; // seconds of flight after which the stunt counts as missed
const RAMP_LANDING_DIST = 30; // distance from ramp to landing zone
const RAMP_STAGE_DIST = 35; // distance ahead for staged ramp
const RAMP_COLOR_AMBER = 0xffb020;
const RAMP_COLOR_WHITE = 0xffffff;

// shared geometry for ring
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);

// bobbing ring marker
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

// build a simple ramp prop (inclined wedge + two side blocks)
function buildRampProp(scene) {
  const g = new THREE.Group();
  const wedge = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 4), new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true }));
  wedge.rotation.x = -Math.PI / 6; // ~30 degrees incline
  g.add(wedge);
  const sideMat = new THREE.MeshLambertMaterial({ color: 0x555555, flatShading: true });
  const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), sideMat);
  side1.position.set(-1, 0.5, 0);
  g.add(side1);
  const side2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), sideMat);
  side2.position.set(1, 0.5, 0);
  g.add(side2);
  g.visible = false;
  scene.add(g);
  return g;
}

export class StuntDoubleService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < 330) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 6151 + 29) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;
    this.roundTimeTotal = 0;
    this.roundTimeLeft = 0;
    this.lastPlayer = null;

    // markers
    this.amberRing = new Marker(scene, RAMP_COLOR_AMBER);
    this.whiteRing = new Marker(scene, RAMP_COLOR_WHITE);

    // ramp props
    this.ramps = [];
    for (let i = 0; i < RAMP_TOTAL; i++) {
      const prop = buildRampProp(scene);
      this.ramps.push({ prop });
    }

    this.paySoFar = 0; // sum of landed stunts
    this.stuntsDone = 0;
    this.roundTimeTotal = 0;
    this.roundTimeLeft = 0;
    this.rampIndex = 0;
    this.flightTime = 0;
    this.flightDamage = 0;
    this.launchSpeed = 0;
    this.outTime = 0;
  }

  _dist(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  _groundY(x, z) {
    const L = this.world.layout;
    return (L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08;
  }

  // farthest‑point sampling with spacing >= minDist
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

  _chooseSites() {
    if (this.anchors.length === 0) return null;
    // first ramp is a seeded random anchor, the rest are farthest-point picks >= MIN_RAMP_DIST apart
    const first = this.rng.pick(this.anchors);
    const rest = this._extend([first], this.anchors, RAMP_TOTAL - 1, MIN_RAMP_DIST);
    if (rest.length === RAMP_TOTAL - 1) return [first, ...rest];
    return null;
  }

  _setupSites() {
    const sites = this._chooseSites();
    if (!sites) return false;
    this.ramps.forEach((r, i) => { r.x = sites[i].x; r.z = sites[i].z; });
    // compute landing zones
    let prev = this.lastPlayer;
    if (!prev) prev = this.ramps[0];
    for (let i = 0; i < RAMP_TOTAL; i++) {
      const ramp = this.ramps[i];
      const dirX = ramp.x - (prev.x ?? ramp.x);
      const dirZ = ramp.z - (prev.z ?? ramp.z);
      let len = Math.hypot(dirX, dirZ);
      let nx, nz;
      if (len < 1) { nx = 0; nz = 1; }
      else { nx = dirX / len; nz = dirZ / len; }
      ramp.landing = {
        x: ramp.x + nx * RAMP_LANDING_DIST,
        z: ramp.z + nz * RAMP_LANDING_DIST,
      };
      prev = ramp;
    }
    // compute round timer
    if (this.lastPlayer) {
      let d = this._dist(this.lastPlayer, this.ramps[0]);
      d += this._dist(this.ramps[0], this.ramps[1]);
      d += this._dist(this.ramps[1], this.ramps[2]);
      this.roundTimeTotal = d / LEG_SPEED + LEG_BASE_TIME;
    } else {
      this.roundTimeTotal = NO_CAR_TIME;
    }
    this.roundTimeLeft = this.roundTimeTotal;
    return true;
  }

  _resetRun() {
    this.paySoFar = 0;
    this.stuntsDone = 0;
    this.flightTime = 0;
    this.flightDamage = 0;
    this.launchSpeed = 0;
    this.rampIndex = 0;
    this.outTime = 0;
  }

  // finish the round (PAID | FAILED): hide props/rings and start the cooldown
  _end(phase) {
    this.state = phase;
    this.cooldown = COOLDOWN;
    this.outTime = 0;
    this._syncVisuals();
  }

  _startRound() {
    if (!this._setupSites()) {
      this.cooldown = COOLDOWN;
      return;
    }
    this._resetRun();
    this.state = 'TO_RAMP';
  }

  _checkOut(dt, inCar, onEvent) {
    if (inCar) { this.outTime = 0; return false; }
    this.outTime += dt;
    if (this.outTime <= OUT_TIME_LIMIT) return false;
    if (onEvent) onEvent({ type: 'stunt', phase: 'failed', pay: 0, bonus: 0, timeLeft: this.roundTimeLeft });
    this._end('FAILED');
    return true;
  }

  // after a stunt resolves (landed or missed): next ramp, or the final 'paid' event on stunt 3
  _nextStunt(onEvent) {
    this.stuntsDone++;
    if (this.stuntsDone < RAMP_TOTAL) {
      this.rampIndex++;
      this.state = 'TO_RAMP';
      return;
    }
    if (onEvent) onEvent({ type: 'stunt', phase: 'paid', pay: STUNT.BASE_PAY, bonus: 0, timeLeft: this.roundTimeLeft });
    this.paySoFar += STUNT.BASE_PAY;
    this._end('PAID');
  }

  _syncVisuals() {
    const inRamp = this.state === 'TO_RAMP';
    const inFlight = this.state === 'FLIGHT';
    const ramp = this.ramps[this.rampIndex];
    if (!ramp) return;
    const groundY = this._groundY(ramp.x, ramp.z);
    // set ramp prop position and rotation
    ramp.prop.position.set(ramp.x, groundY, ramp.z);
    const dirX = ramp.landing.x - ramp.x;
    const dirZ = ramp.landing.z - ramp.z;
    const angle = Math.atan2(dirX, dirZ);
    ramp.prop.rotation.y = angle;
    // show current ramp prop only
    this.ramps.forEach((r, i) => { r.prop.visible = inRamp && i === this.rampIndex; });
    // set ring positions
    this.amberRing.setPos(ramp.x, groundY, ramp.z);
    const landGroundY = this._groundY(ramp.landing.x, ramp.landing.z);
    this.whiteRing.setPos(ramp.landing.x, landGroundY, ramp.landing.z);
    this.amberRing.show(inRamp);
    this.whiteRing.show(inFlight);
  }

  targetPos() {
    if (this.state === 'TO_RAMP') return { x: this.ramps[this.rampIndex].x, z: this.ramps[this.rampIndex].z };
    if (this.state === 'FLIGHT') return { x: this.ramps[this.rampIndex].landing.x, z: this.ramps[this.rampIndex].landing.z };
    return null;
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, carDamageDelta, onEvent } = ctx;
    if (!carPos || !(dt > 0)) return;
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this.time += dt;

    if (this.state === 'IDLE') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown === 0) this._startRound();
      return;
    }

    // decrement round timer in relevant states
    if (this.state === 'TO_RAMP' || this.state === 'FLIGHT') {
      this.roundTimeLeft = Math.max(0, this.roundTimeLeft - dt);
      if (this.roundTimeLeft <= 0) {
        if (onEvent) onEvent({ type: 'stunt', phase: 'failed', pay: 0, bonus: 0, timeLeft: 0 });
        this._end('FAILED');
        return;
      }
    }

    switch (this.state) {
      case 'TO_RAMP': {
        if (this._checkOut(dt, inCar, onEvent)) return;
        const ramp = this.ramps[this.rampIndex];
        const dist = this._dist(carPos, ramp);
        if (inCar && dist <= SITE_R && Math.abs(carSpeed ?? 0) >= STUNT.MIN_SPEED) {
          this.launchSpeed = Math.abs(carSpeed ?? 0);
          this.flightTime = 0;
          this.flightDamage = 0;
          if (onEvent) onEvent({ type: 'stunt', phase: 'launched', pay: 0, bonus: 0, timeLeft: this.roundTimeLeft });
          this.state = 'FLIGHT';
          this._syncVisuals();
        }
        break;
      }
      case 'FLIGHT': {
        if (this._checkOut(dt, inCar, onEvent)) return;
        this.flightTime += dt;
        if (Number.isFinite(carDamageDelta) && carDamageDelta > 0) this.flightDamage += carDamageDelta;
        const landing = this.ramps[this.rampIndex].landing;
        const dist = this._dist(carPos, landing);
        if (inCar && dist <= LAND_R) {
          // landed
          const airBonus = Math.min(STUNT.AIR_BONUS_CAP, Math.floor(this.flightTime * STUNT.AIR_BONUS_PER_SEC));
          const cleanBonus = this.flightDamage < 5 ? STUNT.CLEAN_BONUS : 0;
          const pay = STUNT.PER_STUNT + airBonus;
          this.paySoFar += pay + cleanBonus;
          if (onEvent) onEvent({ type: 'stunt', phase: 'landed', pay, bonus: cleanBonus, timeLeft: this.roundTimeLeft });
          this._nextStunt(onEvent);
        } else if (this.flightTime > MISS_TIME) {
          // missed
          if (onEvent) onEvent({ type: 'stunt', phase: 'missed', pay: 0, bonus: 0, timeLeft: this.roundTimeLeft });
          this._nextStunt(onEvent);
        }
        break;
      }
      case 'PAID':
      case 'FAILED': {
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this.state = 'IDLE';
        break;
      }
    }

    this._syncVisuals();
    this.amberRing.bob(this.time);
    this.whiteRing.bob(this.time);
  }

  hudState() {
    const visible = this.state === 'TO_RAMP' || this.state === 'FLIGHT';
    const t = this.targetPos();
    let distanceLeft = 0;
    if (t && this.lastPlayer) {
      const d = this._dist(this.lastPlayer, t);
      distanceLeft = Number.isFinite(d) ? d : 0;
    }
    const timeLeft = visible && Number.isFinite(this.roundTimeLeft) ? this.roundTimeLeft : 0;
    const timeTotal = visible && Number.isFinite(this.roundTimeTotal) ? this.roundTimeTotal : 0;
    const pay = Number.isFinite(this.paySoFar) ? this.paySoFar : 0;
    return { visible, label: 'STUNT DOUBLE', pay, distanceLeft, timeLeft, timeTotal, stuntsDone: this.stuntsDone, stuntsTotal: RAMP_TOTAL };
  }

  forceStunt(carPos, heading = 0) {
    // stage round for shot
    // pick sites normally
    if (!this._setupSites()) {
      this.state = 'IDLE';
      return;
    }
    // override ramp 0 target
    const nx = Math.sin(heading);
    const nz = Math.cos(heading);
    const ramp0 = this.ramps[0];
    ramp0.x = carPos.x + nx * RAMP_STAGE_DIST;
    ramp0.z = carPos.z + nz * RAMP_STAGE_DIST;
    // landing 30m ahead
    ramp0.landing = { x: ramp0.x + nx * RAMP_LANDING_DIST, z: ramp0.z + nz * RAMP_LANDING_DIST };
    // compute landing for other ramps relative to new ramp0
    for (let i = 1; i < RAMP_TOTAL; i++) {
      const prev = this.ramps[i - 1];
      const curr = this.ramps[i];
      const dirX = curr.x - prev.x;
      const dirZ = curr.z - prev.z;
      let len = Math.hypot(dirX, dirZ);
      let ux, uz;
      if (len < 1) { ux = 0; uz = 1; }
      else { ux = dirX / len; uz = dirZ / len; }
      curr.landing = { x: curr.x + ux * RAMP_LANDING_DIST, z: curr.z + uz * RAMP_LANDING_DIST };
    }
    this.roundTimeTotal = 120;
    this.roundTimeLeft = 120;
    this._resetRun();
    this.state = 'TO_RAMP';
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this._syncVisuals();
  }
}
