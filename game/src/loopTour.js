// loopTour: a sightseeing loop tour job. Drive to a stand, tourists board, then drive to 5 checkpoints in order.
// States: IDLE -> TO_STAND -> BOARDING (1.5s) -> TOURING (legs 1..5) -> (PAID | FAILED) -> 20s cooldown -> IDLE.
// The stand appears after a short delay after load (FIRST_DELAY).
// Import only three from '../vendor/three.module.min.js' and makeRng from './rng.js'.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const LOOP_TOUR = {
  BASE_PAY: 150,
  PER_STOP: 120,
  SMOOTH_BONUS: 80,
  SCHEDULE_BONUS: 250,
};

const FIRST_DELAY = 12; // seconds after load before stand appears
const BOARDING_TIME = 1.5; // seconds tourists walk to car
const CHECKPOINT_R = 7; // distance to checkpoint to consider stop
const STAND_R = 6; // distance to stand to start boarding
const OUT_TIME_LIMIT = 20; // seconds out of car during BOARDING or TOURING
const LEG_GRACE = 25; // base seconds added to leg par after distance /11
const LEG_SPEED = 11; // distance / 11 sec
const DISTANCE_MIN = 120; // minimum distance between checkpoints

// ring marker used for stand and checkpoints (pink/magenta)
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5da2, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });

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

// simple tourist figure: a cube
const touristGeom = new THREE.BoxGeometry(0.5, 1.2, 0.4);
const touristMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a });

class Tourist {
  constructor(scene) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(touristGeom, touristMat);
    body.position.y = 0.6;
    g.add(body);
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
    this.group.position.copy(this.from);
    this.group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    this.group.visible = true;
  }
  update(dt) {
    if (!this.active) return false;
    this.t = Math.min(1, this.t + dt / BOARDING_TIME);
    this.group.position.lerpVectors(this.from, this.to, this.t);
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

export class LoopTourService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < 330) this.anchors.push({ x, z }); // similar to towService
    this.rng = makeRng((L.seed || 1) * 4993 + 13);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;

    this.standMarker = new Marker(scene);
    this.checkpointMarker = new Marker(scene);
    this.tourists = [new Tourist(scene), new Tourist(scene)];

    this.checkpoints = [];
    this.currentLeg = 0; // 0-based index of next leg
    this.prevPoint = null; // previous point for distance calculation
    this.legPar = 0;
    this.legElapsed = 0;
    this.legDamage = 0;
    this.dwellTimer = 0;
    this.outTime = 0;

    this.totalElapsed = 0;
    this.totalPar = 0;
    this.perStopPay = 0;
    this.stopsDone = 0;
    this.stand = null;
    this.lastPlayer = null;
  }

  // farthest-point sampling ensuring min distance
  // Random first pick, then each next pick is the anchor farthest from all picked ones (never a duplicate). Candidates closer than minDist to a picked one are skipped while any farther one exists.
  _spreadSites(list, n, minDist) {
    if (list.length === 0) return [];
    const picked = [this.rng.pick(list)];
    while (picked.length < Math.min(n, list.length)) {
      let best = null, bestD = -1;
      for (const a of list) {
        if (picked.includes(a)) continue;
        let d = Infinity;
        for (const p of picked) d = Math.min(d, Math.hypot(a.x - p.x, a.z - p.z));
        if (d > bestD) { bestD = d; best = a; }
      }
      if (!best) break;
      picked.push(best);
    }
    return picked;
  }

  _createTourPoints() {
    // choose stand as first random anchor
    const stand = this.rng.pick(this.anchors);
    const remaining = this.anchors.filter(a => a !== stand);
    // always yields up to 5 distinct checkpoints (farthest-point sampling already maximises spacing; no unbounded retry loop)
    this.stand = stand;
    this.checkpoints = this._spreadSites(remaining, 5, DISTANCE_MIN);
  }

  _groundY(x, z) {
    return (this.world.layout.groundHeightAt ? this.world.layout.groundHeightAt(x, z) : 0) + 0.08;
  }

  // called when stand appears
  _showStand() {
    const y = this._groundY(this.stand.x, this.stand.z);
    this.standMarker.setPos(this.stand.x, y, this.stand.z);
    this.tourists.forEach(t => t.hide());
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, carDamageDelta, onEvent } = ctx;
    const px = carPos.x, pz = carPos.z;
    this.lastPlayer = { x: px, z: pz };
    this.time += dt;
    this.standMarker.bob(this.time);
    this.checkpointMarker.bob(this.time);

    switch (this.state) {
      case 'IDLE':
        if (this.cooldown > 0) {
          this.cooldown = Math.max(0, this.cooldown - dt);
          return;
        }
        this._createTourPoints();
        this._showStand();
        this.state = 'TO_STAND';
        break;

      case 'TO_STAND':
        if (inCar && Math.abs(carSpeed) < 1 && Math.hypot(px - this.stand.x, pz - this.stand.z) <= STAND_R) {
          // start boarding
          this.state = 'BOARDING';
          this.boardingTimer = 0;
          this.outTime = 0;
          const carPosVec = new THREE.Vector3(px, this._groundY(px, pz), pz);
          this.tourists.forEach(t => t.start(new THREE.Vector3(this.stand.x, this._groundY(this.stand.x, this.stand.z), this.stand.z), carPosVec));
          if (onEvent) onEvent({ type: 'loopTour', phase: 'boarded', pay: 0, bonus: 0, stopsDone: 0 });
        }
        break;

      case 'BOARDING':
        this.boardingTimer += dt;
        this.tourists.forEach(t => t.update(dt));
        // fail if out of car for too long during boarding
        if (!inCar) {
          this.outTime += dt;
          if (this.outTime > OUT_TIME_LIMIT) {
            if (onEvent) onEvent({ type: 'loopTour', phase: 'failed', pay: 0, bonus: 0, stopsDone: this.stopsDone });
            this._finish(false);
            return;
          }
        } else {
          this.outTime = 0;
        }
        if (this.boardingTimer >= BOARDING_TIME) {
          this.standMarker.hide();
          this.state = 'TOURING';
          this.currentLeg = 0;
          this.prevPoint = this.stand;
          this.legPar = Math.hypot(this.checkpoints[0].x - this.prevPoint.x, this.checkpoints[0].z - this.prevPoint.z) / LEG_SPEED + LEG_GRACE;
          this.legElapsed = 0;
          this.legDamage = 0;
          this.dwellTimer = 0;
          this.outTime = 0;
          this.totalElapsed = 0;
          this.totalPar = this.legPar;
          this.checkpointMarker.setPos(this.checkpoints[0].x, this._groundY(this.checkpoints[0].x, this.checkpoints[0].z), this.checkpoints[0].z);
        }
        break;

      case 'TOURING': {
        this.totalElapsed += dt;
        this.legElapsed += dt;
        if (inCar) {
          this.legDamage += carDamageDelta || 0;
          this.outTime = 0;
        } else {
          this.outTime += dt;
          if (this.outTime > OUT_TIME_LIMIT) {
            if (onEvent) onEvent({ type: 'loopTour', phase: 'failed', pay: 0, bonus: 0, stopsDone: this.stopsDone });
            this._finish(false);
            return;
          }
        }
        const target = this.checkpoints[this.currentLeg];
        const distToTarget = Math.hypot(px - target.x, pz - target.z);
        // the stop only counts with the tourists on board (player in the car)
        if (inCar && distToTarget <= CHECKPOINT_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= 1.0) {
            // stop serviced: PER_STOP in `pay`, smooth-ride bonus in `bonus` (receiver credits pay + bonus once)
            const smoothBonus = this.legDamage < 10 ? LOOP_TOUR.SMOOTH_BONUS : 0;
            this.perStopPay += LOOP_TOUR.PER_STOP + smoothBonus;
            this.stopsDone = this.currentLeg + 1;
            if (onEvent) onEvent({ type: 'loopTour', phase: 'stop', pay: LOOP_TOUR.PER_STOP, bonus: smoothBonus, stopsDone: this.stopsDone });
            // advance to next leg
            this.currentLeg++;
            this.dwellTimer = 0;
            this.legDamage = 0;
            this.legElapsed = 0;
            if (this.currentLeg >= 5) {
              // PAID: BASE_PAY in `pay`, SCHEDULE_BONUS in `bonus`; fired exactly once, _finish leaves TOURING
              const scheduleBonus = this.totalElapsed <= this.totalPar ? LOOP_TOUR.SCHEDULE_BONUS : 0;
              if (onEvent) onEvent({ type: 'loopTour', phase: 'paid', pay: LOOP_TOUR.BASE_PAY, bonus: scheduleBonus, stopsDone: this.stopsDone });
              this._finish(true);
              return;
            }
            // set next checkpoint; its par is fixed here, at leg start
            this.prevPoint = target;
            const next = this.checkpoints[this.currentLeg];
            this.legPar = Math.hypot(next.x - this.prevPoint.x, next.z - this.prevPoint.z) / LEG_SPEED + LEG_GRACE;
            this.totalPar += this.legPar;
            this.checkpointMarker.setPos(next.x, this._groundY(next.x, next.z), next.z);
          }
        } else {
          this.dwellTimer = 0;
        }
        break;
      }

      case 'PAID':
      case 'FAILED':
        if (this.cooldown > 0) {
          this.cooldown = Math.max(0, this.cooldown - dt);
          if (this.cooldown <= 0) {
            this._reset();
            this.state = 'IDLE';
          }
        } else {
          this._reset();
          this.state = 'IDLE';
        }
        break;
    }
  }

  _reset() {
    this.standMarker.hide();
    this.checkpointMarker.hide();
    this.tourists.forEach(t => t.hide());
    this.checkpoints = [];
    this.currentLeg = 0;
    this.prevPoint = null;
    this.legPar = 0;
    this.legElapsed = 0;
    this.legDamage = 0;
    this.dwellTimer = 0;
    this.outTime = 0;
    this.totalElapsed = 0;
    this.totalPar = 0;
    this.perStopPay = 0;
    this.stopsDone = 0;
  }

  _finish(success) {
    this.state = success ? 'PAID' : 'FAILED';
    this.cooldown = 20;
    this.standMarker.hide();
    this.checkpointMarker.hide();
    this.tourists.forEach(t => t.hide());
  }

  hudState() {
    const tp = this.targetPos();
    const lp = this.lastPlayer;
    const distanceLeft = tp && lp ? Math.hypot(tp.x - lp.x, tp.z - lp.z) : 0;
    if (this.state === 'TO_STAND' || this.state === 'BOARDING') {
      return { visible: true, label: 'LOOP TOUR', pay: this.perStopPay, distanceLeft, stopsDone: this.stopsDone, stopsTotal: 5, timeLeft: 0, timeTotal: 0 };
    }
    if (this.state === 'TOURING') {
      return {
        visible: true,
        label: 'LOOP TOUR',
        pay: this.perStopPay,
        distanceLeft,
        stopsDone: this.stopsDone,
        stopsTotal: 5,
        timeLeft: Math.max(0, this.legPar - this.legElapsed),
        timeTotal: this.legPar,
      };
    }
    return { visible: false, label: '', pay: 0, distanceLeft: 0, stopsDone: 0, stopsTotal: 5, timeLeft: 0, timeTotal: 0 };
  }

  targetPos() {
    if ((this.state === 'TO_STAND' || this.state === 'BOARDING') && this.stand) return { x: this.stand.x, z: this.stand.z };
    if (this.state === 'TOURING' && this.currentLeg < this.checkpoints.length) return { x: this.checkpoints[this.currentLeg].x, z: this.checkpoints[this.currentLeg].z };
    return null;
  }

  // Shot/test hook: jump straight into leg 2 (one stop already paid). `ring` ({x,z}, optional) overrides checkpoint 2's position.
  forceTour(ring) {
    this._createTourPoints();
    if (ring) this.checkpoints[1] = { x: ring.x, z: ring.z };
    this.currentLeg = 1;
    this.prevPoint = this.checkpoints[0];
    const target = this.checkpoints[1];
    this.legPar = Math.hypot(target.x - this.prevPoint.x, target.z - this.prevPoint.z) / LEG_SPEED + LEG_GRACE;
    this.totalPar = this.legPar;
    this.legElapsed = 0;
    this.legDamage = 0;
    this.dwellTimer = 0;
    this.outTime = 0;
    this.totalElapsed = 0;
    this.stopsDone = 1;
    this.perStopPay = LOOP_TOUR.PER_STOP + LOOP_TOUR.SMOOTH_BONUS;
    this.state = 'TOURING';
    this.checkpointMarker.setPos(target.x, this._groundY(target.x, target.z), target.z);
    this.standMarker.hide();
    this.tourists.forEach(t => t.hide());
  }
}

