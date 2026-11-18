// signalIntercept: the "Signal Intercept" job. Tail a black syndicate sedan at 15-45 m to fill a DATA UPLOAD bar without filling SUSPICION,
// survive its evasive moves at 50% / 80%, then break away past 80 m. Owns the quarry car and the 3D range rings; the MissionTracker drives it.
import * as THREE from '../vendor/three.module.min.js';
import { RoadDriver } from './roadDriver.js';
import { DIRS } from './roadNet.js';
import { spotFree } from './traffic.js';
import { SYNDICATE_BLACK } from './vehicleModels.js';

export const R_NEAR = 15; // closer than this the driver gets suspicious
export const R_FAR = 45; // farther than this the signal drops
const BREAK_DIST = 80; // distance that finishes the job once the upload is complete
const UPLOAD_RATE = 2; // % per second inside the sweet spot (50 s for the whole bar)
const SUSP_RATE = 25; // % per second while too close
const SUSP_DECAY = 10; // % per second once back in the sweet spot
const LOST_MAX = 12; // seconds beyond R_FAR before the link is gone
const TOTAL_TIME = 150;
const BREAK_TIME = 20; // seconds allowed for the clean break once the upload hits 100%
const CRUISE = 12.5; // 45 km/h
const SPRINT_SPEED = 20.8; // 75 km/h
const EVADE_AT = [50, 80];
const BEHAVIOURS = ['sprint', 'turn', 'brake'];
const BEHAVIOUR_TEXT = { sprint: 'TARGET FLOORS IT!', turn: 'TARGET DIVES DOWN A SIDE STREET!', brake: 'TARGET BRAKES HARD!' };

export const REWARD = { base: 1400, perSecond: 15, ghost: 400, ghostBelow: 25 };

export class SignalIntercept {
  constructor(world, scene, rng) {
    this.world = world;
    this.rng = rng;
    this.car = null;
    this.drv = null;
    this.active = false;
    this.reset();

    const cyan = (opacity) => new THREE.MeshBasicMaterial({ color: 0x4fe6ff, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.outerMat = cyan(0.9);
    this.wallMat = cyan(0.1);
    this.innerMat = new THREE.MeshBasicMaterial({ color: 0xff4a3c, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0xff4a3c, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const g = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.RingGeometry(R_FAR - 0.7, R_FAR, 72).rotateX(-Math.PI / 2), this.outerMat);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R_FAR, R_FAR, 7, 56, 1, true), this.wallMat);
    wall.position.y = 3.5;
    const inner = new THREE.Mesh(new THREE.RingGeometry(R_NEAR - 0.4, R_NEAR, 48).rotateX(-Math.PI / 2), this.innerMat);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(R_NEAR, 40).rotateX(-Math.PI / 2), this.fillMat);
    for (const m of [outer, wall, inner, fill]) {
      m.frustumCulled = false;
      g.add(m);
    }
    outer.position.y = inner.position.y = fill.position.y = 0.3;
    g.visible = false;
    this.rings = g;
    scene.add(g);
  }

  reset() {
    this.upload = 0;
    this.susp = 0;
    this.peakSusp = 0;
    this.lostT = 0;
    this.timeLeft = TOTAL_TIME;
    this.breakT = 0;
    this.dist = 0;
    this.evadeIdx = 0;
    this.pendingTurn = 0;
    this.effectT = 0;
    this.blinkT = 0;
    this.order = [...BEHAVIOURS];
    for (let i = this.order.length - 1; i > 0; i--) {
      const k = Math.floor(this.rng() * (i + 1));
      [this.order[i], this.order[k]] = [this.order[k], this.order[i]];
    }
  }

  get position() {
    return this.car ? { x: this.car.x, z: this.car.z, h: this.car.h } : null;
  }

  // Everything the HUD and minimap show.
  get view() {
    const d = this.dist;
    return {
      active: this.active,
      upload: this.upload,
      susp: this.susp,
      dist: d,
      zone: d < R_NEAR ? 'TOO CLOSE' : d <= R_FAR ? 'OPTIMAL' : 'SIGNAL LOSS',
      lostLeft: Math.max(0, LOST_MAX - this.lostT),
      breaking: this.upload >= 100,
    };
  }

  // Spawn the quarry on a lane 50-75 m from the player and start the clock. Returns false when no lane spot is free.
  // `at` ({i, j, d, along}) pins the spot instead (screenshots).
  start(at = null) {
    this.cancel();
    this.reset();
    const w = this.world, net = w.net, p = w.player;
    let best = null, bs = -Infinity;
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    for (let t = 0; t < 200; t++) {
      const s = at ? { ...net.lanePoint(at.i, at.j, at.d, at.along), ...at } : net.randomLane(this.rng);
      if (at && t > 0) break;
      const dx = s.x - p.px, dz = s.z - p.pz;
      const d = Math.hypot(dx, dz);
      if (!at && (d < 48 || d > 78 || !spotFree(w.vehicles.list, s.x, s.z, 12))) continue;
      const away = (DIRS[s.d].x * dx + DIRS[s.d].z * dz) / d; // driving off, not at us
      const ahead = (dx * fx + dz * fz) / d; // in front of the player
      const score = away * 1.5 + ahead - Math.abs(d - 60) / 40;
      if (score > bs) { bs = score; best = s; }
    }
    if (!best) return false;
    const v = w.vehicles.spawnTarget(best.x, best.z, DIRS[best.d].h, SYNDICATE_BLACK);
    const drv = new RoadDriver(v, net, this.rng, { cruise: CRUISE });
    drv.place(best.i, best.j, best.d, (best.x - net.xs[best.i]) * DIRS[best.d].x + (best.z - net.zs[best.j]) * DIRS[best.d].z);
    this.car = v;
    this.drv = drv;
    this.active = true;
    this.rings.visible = true;
    w.police.suppress = true;
    w.wanted.heatScale = 0.6; // bumping into traffic should not end the job at once
    w.emit('icptStart');
    return true;
  }

  // Remove the car and the rings (job over, failed, abandoned).
  cancel() {
    if (this.car) this.world.vehicles.remove(this.car);
    this.car = null;
    this.drv = null;
    this.active = false;
    this.rings.visible = false;
    if (this.world.police) this.world.police.suppress = false;
    if (this.world.wanted) this.world.wanted.heatScale = 1;
  }

  // AI step for the quarry (runs with the other drivers, before the physics sub-steps).
  drive(dt, ctx) {
    if (!this.drv) return;
    this.drv.update(dt, ctx);
  }

  _evade(kind) {
    const w = this.world, drv = this.drv;
    w.notify(BEHAVIOUR_TEXT[kind], 'warn');
    w.emit('icptEvade');
    if (kind === 'sprint') {
      drv.cruise = SPRINT_SPEED;
      this.effectT = 6;
    } else if (kind === 'brake') {
      drv.cruise = 0;
      this.effectT = 3;
    } else {
      drv.cruise = 14;
      this.effectT = 7;
      this.pendingTurn = 5; // keep trying for a few seconds until a junction ahead allows the turn
    }
  }

  // Returns null while running, {win, reward, ghost, secs} on success or {fail: reason} on failure.
  update(dt) {
    if (!this.active || !this.car) return null;
    const w = this.world, p = w.player, t = this.car;
    if (!w.vehicles.list.includes(t) || t.wrecked) return { fail: 'the target got away' };
    const dx = t.x - p.px, dz = t.z - p.pz;
    const d = (this.dist = Math.hypot(dx, dz));
    this.timeLeft -= dt;
    this.blinkT += dt;

    // evasive moves
    if (this.effectT > 0) {
      this.effectT -= dt;
      if (this.pendingTurn > 0) {
        this.pendingTurn -= dt;
        if (this.drv.forceTurn(this.rng() < 0.5 ? 'left' : 'right')) this.pendingTurn = 0;
      }
      if (this.effectT <= 0) this.drv.cruise = CRUISE;
    }
    if (this.evadeIdx < EVADE_AT.length && this.upload >= EVADE_AT[this.evadeIdx]) this._evade(this.order[this.evadeIdx++]);

    // the two bars
    if (this.upload < 100) {
      if (d < R_NEAR) {
        this.susp = Math.min(100, this.susp + SUSP_RATE * dt);
        this.lostT = 0;
      } else {
        this.susp = Math.max(0, this.susp - SUSP_DECAY * dt);
        if (d <= R_FAR) {
          this.upload = Math.min(100, this.upload + UPLOAD_RATE * dt);
          this.lostT = 0;
          if (this.upload >= 100) {
            if (this.timeLeft < 20) this.timeLeft += 20;
            w.notify('UPLOAD COMPLETE - break away!', 'mission');
            w.emit('icptDone');
          }
        } else {
          this.lostT += dt;
        }
      }
      this.peakSusp = Math.max(this.peakSusp, this.susp);
    } else {
      this.breakT += dt;
    }

    // rings follow the quarry; the outer one flashes yellow when we are out of range
    this.rings.position.set(t.x, t.y, t.z);
    const out = d > R_FAR && this.upload < 100;
    this.outerMat.color.setHex(out && Math.floor(this.blinkT * 4) % 2 === 0 ? 0xffd23f : 0x4fe6ff);
    this.wallMat.opacity = 0.08 + Math.sin(this.blinkT * 2.2) * 0.025;

    if (this.susp >= 100) return { fail: 'the driver spotted you' };
    if (this.lostT >= LOST_MAX) return { fail: 'signal lost' };
    if (t.bumped && t.bumped === p.vehicle) return { fail: 'you hit the target' };
    t.bumped = null;
    if (w.wanted.stars >= 2) return { fail: 'too much police heat' };
    if (this.timeLeft <= 0) return { fail: 'out of time' };
    if (this.upload >= 100 && this.breakT > BREAK_TIME) return { fail: 'you were too slow to break away' };

    if (this.upload >= 100 && d > BREAK_DIST) {
      const secs = Math.max(0, Math.round(this.timeLeft));
      const ghost = this.peakSusp < REWARD.ghostBelow;
      return { win: true, secs, ghost, reward: REWARD.base + REWARD.perSecond * secs + (ghost ? REWARD.ghost : 0) };
    }
    return null;
  }
}
