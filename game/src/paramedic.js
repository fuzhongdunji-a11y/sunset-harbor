// paramedic: an emergency patient transport job. Follow the pattern of cashPickup.js and loopTour.js.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// public constants
export const PARAMEDIC = {
  BASE_PAY: 400,
  BONUS_PER_SEC: 10,
  BONUS_MAX: 300,
};

const FIRST_DELAY = 12; // seconds after load before first round
const COOLDOWN = 20; // seconds after PAID/FAILED before idle
const ACCIDENT_RING_R = 7; // distance to consider stopped at scene
const HOSPITAL_RING_R = 7; // distance to consider stopped at hospital
const OUT_TIME_LIMIT = 20; // seconds continuously out of car before fail
const TREAT_TIME = 5.0; // seconds stopped in ring to complete treatment
const HOSPITAL_AHEAD = 35; // distance ahead of car for forceMedic hospital ring
const RING_GAP = 0.85;

// ring geometry used for both red and blue rings
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const redMat = new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide, transparent: true, opacity: RING_GAP, depthWrite: false, fog: false });
const blueMat = new THREE.MeshBasicMaterial({ color: 0x3399ff, side: THREE.DoubleSide, transparent: true, opacity: RING_GAP, depthWrite: false, fog: false });

class Marker {
  constructor(scene, mat) {
    this.mesh = new THREE.Mesh(ringGeom, mat);
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
  hide() { this.mesh.visible = false; }
}

// simple patient figure: a small box standing on the ring
const patientGeom = new THREE.BoxGeometry(0.6, 0.3, 1.6);
const patientMat = new THREE.MeshLambertMaterial({ color: 0xffdddd });

class ParamedicService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < 330) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 4993 + 13) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;

    this.sceneMarker = new Marker(scene, redMat);
    this.hospitalMarker = new Marker(scene, blueMat);
    this.patient = new THREE.Mesh(patientGeom, patientMat);
    this.patient.visible = false;
    scene.add(this.patient);

    this.sceneAnchor = null;
    this.hospitalAnchor = null;
    this.treatTimer = 0;
    this.dwellTimer = 0;
    this.outTime = 0;
    this.patientTimeTotal = 0;
    this.patientTimeLeft = 0;

    this.lastPlayer = null;
  }

  // distance helper
  _dist(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  _groundY(x, z) {
    const L = this.world.layout;
    return (L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08;
  }

  // farthest-point sampling for one site
  _pickSite() {
    if (this.anchors.length === 0) return null;
    return this.rng.pick(this.anchors);
  }

  // choose hospital anchor farthest from scene with min 150m if possible
  _chooseHospital(sceneAnchor, anchors) {
    const MIN_DIST = 150;
    let best = null;
    let bestDist = -1;
    for (const a of anchors) {
      if (a === sceneAnchor) continue;
      const dToScene = this._dist(a, sceneAnchor);
      if (dToScene < MIN_DIST) continue;
      if (dToScene > bestDist) {
        bestDist = dToScene;
        best = a;
      }
    }
    if (!best) {
      // fallback to farthest regardless of distance
      let maxD = -1;
      for (const a of anchors) {
        if (a === sceneAnchor) continue;
        const dToScene = this._dist(a, sceneAnchor);
        if (dToScene > maxD) {
          maxD = dToScene;
          best = a;
        }
      }
    }
    return best || anchors[0];
  }

  _setupRound() {
    this.sceneAnchor = this._pickSite();
    this.hospitalAnchor = this._chooseHospital(this.sceneAnchor, this.anchors);
    const sy = this._groundY(this.sceneAnchor.x, this.sceneAnchor.z);
    this.sceneMarker.setPos(this.sceneAnchor.x, sy, this.sceneAnchor.z);
    this.patient.position.set(this.sceneAnchor.x, sy + 0.15, this.sceneAnchor.z);
    this.patient.visible = true;
    this.hospitalMarker.hide();
    this.treatTimer = 0;
    this.dwellTimer = 0;
    this.outTime = 0;
    this.patientTimeTotal = 0;
    this.patientTimeLeft = 0;
  }

  _startRound() {
    this._setupRound();
    this.state = 'TO_SCENE';
  }

  _resetRound() {
    this.sceneMarker.hide();
    this.hospitalMarker.hide();
    this.patient.visible = false;
    this.treatTimer = 0;
    this.dwellTimer = 0;
    this.outTime = 0;
    this.patientTimeTotal = 0;
    this.patientTimeLeft = 0;
    this.state = 'IDLE';
    this.cooldown = COOLDOWN;
  }

  _fail(onEvent) {
    if (onEvent) onEvent({ type: 'paramedic', phase: 'failed', pay: 0, bonus: 0, timeLeft: 0 });
    this._resetRound();
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, onEvent } = ctx;
    if (!carPos || dt <= 0) return;
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this.time += dt;
    this.sceneMarker.bob(this.time);
    this.hospitalMarker.bob(this.time);

    switch (this.state) {
      case 'IDLE':
        if (this.cooldown > 0) {
          this.cooldown = Math.max(0, this.cooldown - dt);
          return;
        }
        this._startRound();
        break;

      case 'TO_SCENE':
        if (inCar && Math.abs(carSpeed) < 1 && this._dist(carPos, this.sceneAnchor) <= ACCIDENT_RING_R) {
          this.state = 'TREATING';
          this.treatTimer = 0;
          this.outTime = 0;
        }
        // fail if out-of-car too long
        if (this.state === 'TO_SCENE') {
          if (!inCar) {
            this.outTime += dt;
            if (this.outTime > OUT_TIME_LIMIT) this._fail(onEvent);
          } else {
            this.outTime = 0;
          }
        }
        break;

      case 'TREATING':
        if (!inCar || Math.abs(carSpeed) >= 1 || this._dist(carPos, this.sceneAnchor) > ACCIDENT_RING_R) {
          this.treatTimer = 0;
          this.state = 'TO_SCENE';
          return;
        }
        this.treatTimer += dt;
        this.outTime = 0;
        if (this.treatTimer >= TREAT_TIME) {
          this.patient.visible = false;
          this.sceneMarker.hide();
          const dist = this._dist(this.sceneAnchor, this.hospitalAnchor);
          this.patientTimeTotal = dist / 11 + 35;
          this.patientTimeLeft = this.patientTimeTotal;
          if (onEvent) onEvent({ type: 'paramedic', phase: 'treated', pay: 0, bonus: 0, timeLeft: this.patientTimeLeft });
          this.state = 'TO_HOSPITAL';
          this.dwellTimer = 0;
          this.outTime = 0;
          const hy = this._groundY(this.hospitalAnchor.x, this.hospitalAnchor.z);
          this.hospitalMarker.setPos(this.hospitalAnchor.x, hy, this.hospitalAnchor.z);
          this.hospitalMarker.mesh.visible = true;
        }
        break;

      case 'TO_HOSPITAL':
        if (inCar && Math.abs(carSpeed) < 1 && this._dist(carPos, this.hospitalAnchor) <= HOSPITAL_RING_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= 1.0) {
            const pay = PARAMEDIC.BASE_PAY;
            const bonus = Math.min(PARAMEDIC.BONUS_MAX, Math.floor(this.patientTimeLeft) * PARAMEDIC.BONUS_PER_SEC);
            if (onEvent) onEvent({ type: 'paramedic', phase: 'paid', pay, bonus, timeLeft: this.patientTimeLeft });
            this._resetRound();
            return;
          }
        } else {
          this.dwellTimer = 0;
        }
        if (!inCar) {
          this.outTime += dt;
          if (this.outTime > OUT_TIME_LIMIT) { this._fail(onEvent); return; }
        } else {
          this.outTime = 0;
        }
        if (this.patientTimeLeft > 0) {
          this.patientTimeLeft = Math.max(0, this.patientTimeLeft - dt);
          if (this.patientTimeLeft <= 0) {
            if (onEvent) onEvent({ type: 'paramedic', phase: 'failed', pay: 0, bonus: 0, timeLeft: 0 });
            this._resetRound();
            return;
          }
        }
        break;

      default:
        // unknown state, reset
        this._resetRound();
    }
  }

  hudState() {
    const visible = this.state !== 'IDLE';
    let distanceLeft = 0;
    const target = this.targetPos();
    if (target && this.lastPlayer) {
      distanceLeft = Math.hypot(this.lastPlayer.x - target.x, this.lastPlayer.z - target.z);
    }
    const timeLeft = this.state === 'TO_HOSPITAL' ? this.patientTimeLeft : 0;
    const timeTotal = this.state === 'TO_HOSPITAL' ? this.patientTimeTotal : 0;
    return { visible, label: 'PARAMEDIC', pay: 0, distanceLeft: Number.isFinite(distanceLeft) ? distanceLeft : 0, timeLeft: Number.isFinite(timeLeft) ? timeLeft : 0, timeTotal: Number.isFinite(timeTotal) ? timeTotal : 0 };
  }

  targetPos() {
    if (this.state === 'TO_SCENE' || this.state === 'TREATING') {
      return this.sceneAnchor ? { x: this.sceneAnchor.x, z: this.sceneAnchor.z } : null;
    }
    if (this.state === 'TO_HOSPITAL') {
      return this.hospitalAnchor ? { x: this.hospitalAnchor.x, z: this.hospitalAnchor.z } : null;
    }
    return null;
  }

  forceMedic(carPos, heading = 0) {
    // choose scene normally
    this.sceneAnchor = this._pickSite();
    this.sceneMarker.hide();
    this.patient.visible = false;
    // hospital ring ahead of car
    const aheadX = carPos.x + Math.sin(heading) * HOSPITAL_AHEAD;
    const aheadZ = carPos.z + Math.cos(heading) * HOSPITAL_AHEAD;
    const ah = this._groundY(aheadX, aheadZ);
    this.hospitalAnchor = { x: aheadX, z: aheadZ };
    this.hospitalMarker.setPos(aheadX, ah, aheadZ);
    this.hospitalMarker.mesh.visible = true;
    // set timers and state
    this.treatTimer = 0;
    this.dwellTimer = 0;
    this.outTime = 0;
    this.patientTimeTotal = 60;
    this.patientTimeLeft = 60;
    this.state = 'TO_HOSPITAL';
    this.lastPlayer = { x: carPos.x, z: carPos.z };
  }
}

export { ParamedicService };
