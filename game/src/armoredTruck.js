// armoredTruck: the "Armored Shakedown" job. Ram a fleeing armored transport until it coughs up three gold briefcases, collect them (by car or on foot),
// then shake the police and deliver the gold to the harbor drop-off. Owns the truck, its armor, the heat escalation, the drop-off beacon and the reward;
// the MissionTracker drives it. Briefcase flight and pickup live in briefcases.js, smoke and sparks in particles.js.
import * as THREE from '../vendor/three.module.min.js';
import { RoadDriver } from './roadDriver.js';
import { DIRS } from './roadNet.js';
import { spotFree } from './traffic.js';
import { ARMOR_NAVY } from './vehicleModels.js';
import { Briefcases, MAX_CASES } from './briefcases.js';
import { ParticlePool } from './particles.js';

const TOTAL_TIME = 165;
const ARMOR_MAX = 300;
const THRESHOLDS = [200, 100, 0]; // each one crossed lets one briefcase out
const STAGGER = 0.35; // seconds between two cases released by one big hit
const RAM_MIN = 8.0; // closing speed (m/s) that counts as a hit
const RAM_COOLDOWN = 1.2;
const dmgFor = (speed) => Math.min(75, Math.max(18, (speed - 6.0) * 5.0));
const HEAVY_HIT = 50; // damage that earns the heavy-ram bonus
const CRUISE = 14; // 50 km/h
const FLEE_SPEED = 21; // 75 km/h
const EXTENSION = 30; // seconds granted by the third briefcase
const FAR_WARN = 200;
const FAR_FAIL = 280;
const FAR_TIME = 15;
const DROP_R = 6;
const DROP_SPEED = 5;
const LOCK_DIST = 30; // a cruiser this close keeps the drop-off locked
const PANIC_R = 28;

export const REWARD = { base: 2800, perSecond: 15, timeCap: 2100, heavy: 150, heavyMax: 4, foot: 250, footMax: 3 };

export class ArmoredHeist {
  constructor(world, scene, rng) {
    this.world = world;
    this.rng = rng;
    this.truck = null;
    this.drv = null;
    this.active = false;
    this.cases = new Briefcases(scene, world.collision, world.layout.groundHeightAt);
    this.smoke = new ParticlePool(scene, { max: 48, size: 3.2, opacity: 0.6, gravity: -1.2, drag: 0.7, from: 0x1b1b1f, to: 0x9a8a80 });
    this.sparks = new ParticlePool(scene, { max: 96, size: 0.55, additive: true, gravity: 9, drag: 0.25, from: 0xffb030, to: 0x401400 });

    this.chevron = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffc21a, fog: false }));
    this.chevron.visible = false;
    scene.add(this.chevron);

    const gold = (o) => new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.dropMat = gold(0.26);
    this.dropRingMat = new THREE.MeshBasicMaterial({ color: 0xffc21a, fog: false });
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(DROP_R, DROP_R, 70, 20, 1, true), this.dropMat);
    beam.position.y = 35;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(DROP_R, 0.28, 6, 28).rotateX(Math.PI / 2), this.dropRingMat);
    ring.position.y = 0.4;
    g.add(beam, ring);
    g.visible = false;
    g.frustumCulled = false;
    this.beacon = g;
    scene.add(g);

    this.reset();
  }

  reset() {
    this.armor = ARMOR_MAX;
    this.timeLeft = TOTAL_TIME;
    this.cool = 0;
    this.fleeing = false;
    this.released = 0;
    this.collected = 0;
    this.crossed = 0; // thresholds already passed
    this.pending = []; // seconds until each queued release
    this.heavy = 0;
    this.foot = 0;
    this.hits = 0; // total valid rams (HUD flashes on every change)
    this.phase = 'ram';
    this.drop = null;
    this.locked = false;
    this.farT = 0;
    this.dist = 0;
    this.bonusT = 0;
    this.blinkT = 0;
    this.tickAt = -1;
    this.swerved = []; // civilians put into a panic: {drv, cruise, lane, t}
  }

  get position() {
    return this.truck ? { x: this.truck.x, z: this.truck.z, h: this.truck.h } : null;
  }

  // Where the camera should look while chasing the truck.
  get aid() {
    return this.active && this.phase === 'ram' && this.armor > 0 ? this.position : null;
  }

  // The thing the mission marker / minimap pin points at right now.
  get target() {
    if (!this.active) return null;
    if (this.phase === 'deliver') return this.drop;
    if (this.cases.list.length) {
      const p = this.world.player;
      let best = null, bd = Infinity;
      for (const c of this.cases.list) {
        const d = Math.hypot(c.x - p.px, c.z - p.pz);
        if (d < bd) { bd = d; best = c; }
      }
      return { x: best.x, z: best.z };
    }
    return this.position;
  }

  get phaseText() {
    if (this.collected >= MAX_CASES) return 'DELIVER GOLD TO HARBOR DROP-OFF';
    if (this.cases.list.length) return `COLLECT GOLD BRIEFCASES [ ${this.collected} / ${MAX_CASES} ]`;
    return 'INTERCEPT & RAM THE ARMORED TRUCK';
  }

  // Everything the HUD shows.
  get view() {
    let warn = '';
    if (this.locked) warn = 'LOSE CLOSE PURSUIT (>30m) TO DELIVER';
    else if (this.armor > 0 && this.farT > 0) warn = `TRUCK ESCAPING - ${Math.ceil(FAR_TIME - this.farT)}s`;
    else if (this.armor > 0 && this.dist >= FAR_WARN) warn = `TRUCK GETTING AWAY  ${Math.round(this.dist)} m`;
    else if (this.phase === 'deliver') warn = `DROP-OFF ${Math.round(this.drop ? Math.hypot(this.drop.x - this.world.player.px, this.drop.z - this.world.player.pz) : 0)} m`;
    return {
      active: this.active,
      phase: this.phase,
      text: this.phaseText,
      armor: this.armor,
      armorMax: ARMOR_MAX,
      collected: this.collected,
      timeLeft: this.timeLeft,
      bonusT: this.bonusT,
      hits: this.hits,
      warn,
      locked: this.locked,
    };
  }

  // Data for the minimap.
  get mapView() {
    if (!this.active) return null;
    return {
      truck: this.truck && this.armor > 0 ? this.position : null,
      wreck: this.truck && this.armor <= 0 ? this.position : null,
      cases: this.cases.list.map((c) => ({ x: c.x, z: c.z })),
      drop: this.phase === 'deliver' ? this.drop : null,
      target: this.target,
    };
  }

  // Spawn the truck on a lane 120-180 m from the player, start the clock. `at` ({i, j, d, along}) pins the spot (screenshots).
  start(at = null) {
    this.cancel();
    this.reset();
    const w = this.world, net = w.net, p = w.player;
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    let best = null, bs = -Infinity;
    for (let t = 0; t < 300; t++) {
      const s = at ? { ...net.lanePoint(at.i, at.j, at.d, at.along), ...at } : net.randomLane(this.rng);
      if (at && t > 0) break;
      const dx = s.x - p.px, dz = s.z - p.pz;
      const d = Math.hypot(dx, dz);
      if (!at && (d < 120 || d > 180 || !spotFree(w.vehicles.list, s.x, s.z, 14))) continue;
      const away = at ? 0 : (DIRS[s.d].x * dx + DIRS[s.d].z * dz) / d; // driving off, not at us
      const ahead = at ? 0 : (dx * fx + dz * fz) / d;
      const score = away * 1.2 + ahead - Math.abs(d - 150) / 60;
      if (score > bs) { bs = score; best = s; }
    }
    if (!best) return false;
    const v = w.vehicles.spawnArmored(best.x, best.z, DIRS[best.d].h, ARMOR_NAVY);
    const drv = new RoadDriver(v, net, this.rng, { cruise: CRUISE });
    drv.place(best.i, best.j, best.d, (best.x - net.xs[best.i]) * DIRS[best.d].x + (best.z - net.zs[best.j]) * DIRS[best.d].z);
    this.truck = v;
    this.drv = drv;
    this.active = true;
    this.chevron.visible = true;
    w.emit('amsStart');
    return true;
  }

  // Remove the truck, cases, effects and beacon (job over, failed or abandoned).
  cancel() {
    this._unpanic(true);
    if (this.truck) this.world.vehicles.remove(this.truck);
    this.truck = null;
    this.drv = null;
    this.active = false;
    this.cases.clear();
    this.smoke.clear();
    this.sparks.clear();
    this.chevron.visible = false;
    this.beacon.visible = false;
  }

  // AI step for the truck (runs with the other drivers, before the physics sub-steps).
  drive(dt, ctx) {
    if (!this.drv) return;
    if (this.fleeing && this.armor > 0) this.drv.ghost = 1; // flat out: no more yielding to civilians
    this.drv.update(dt, ctx);
  }

  _camFwd() {
    const yaw = this.world.rig.yaw;
    return { x: Math.sin(yaw), z: Math.cos(yaw) };
  }

  _pop(text) {
    this.world.armoredPops.push(text);
  }

  // Civilians near the first hit swerve toward the centre line and speed up for a few seconds.
  _panic(x, z) {
    const w = this.world;
    w.peds.panic(x, z, PANIC_R);
    for (const c of w.traffic.cars) {
      if (Math.hypot(c.v.x - x, c.v.z - z) > PANIC_R || this.swerved.some((s) => s.drv === c.drv)) continue;
      this.swerved.push({ drv: c.drv, cruise: c.drv.cruise, lane: c.drv.lane, t: 3.2 });
      c.drv.cruise *= 1.55;
      c.drv.lane = 2.2;
    }
  }

  _unpanic(all = false) {
    for (let i = this.swerved.length - 1; i >= 0; i--) {
      const s = this.swerved[i];
      if (all || s.t <= 0) {
        s.drv.cruise = s.cruise;
        s.drv.lane = s.lane;
        this.swerved.splice(i, 1);
      }
    }
  }

  _ram(speed) {
    const w = this.world, t = this.truck;
    const dmg = dmgFor(speed);
    this.armor = Math.max(0, this.armor - dmg);
    this.cool = RAM_COOLDOWN;
    this.hits++;
    w.emit('ramHit');
    w.rig.shake = Math.max(w.rig.shake, 0.14);
    if (dmg >= HEAVY_HIT) {
      this.heavy++;
      if (this.heavy <= REWARD.heavyMax) this._pop(`HEAVY RAM!  +$${REWARD.heavy}`);
    }
    for (let k = 0; k < 8; k++) this._spark(t.x + Math.sin(t.h) * -1.5, t.y + 1.2, t.z + Math.cos(t.h) * -1.5, 0.5);
    if (!this.fleeing) {
      this.fleeing = true;
      this.drv.cruise = FLEE_SPEED;
      w.wanted.raiseTo(1);
      this._panic(t.x, t.z);
      w.notify('THE TRUCK IS RUNNING!', 'warn');
      w.emit('amsAlarm');
    }
    // every threshold crossed by this hit queues one case, 0.35 s apart
    const n = this.armor <= 0 ? THRESHOLDS.length : THRESHOLDS.filter((th) => th > 0 && this.armor < th).length;
    let delay = 0;
    while (this.crossed < n) {
      this.pending.push(delay);
      delay += STAGGER;
      this.crossed++;
    }
    if (this.armor <= 0) {
      this.drv.cruise = 0;
      this.drv.ghost = 0;
    }
  }

  _spark(x, y, z, power = 1) {
    const sp = (3 + this.rng() * 5) * power;
    const a = this.rng() * Math.PI * 2;
    this.sparks.emit(x, y, z, Math.cos(a) * sp, 2 + this.rng() * 5 * power, Math.sin(a) * sp, 0.45 + this.rng() * 0.45);
  }

  _release() {
    const w = this.world, t = this.truck;
    const fx = Math.sin(t.h), fz = Math.cos(t.h);
    const side = (this.rng() * 2 - 1) * 2.0;
    const x = t.x - fx * 3.3, y = t.y + 1.3, z = t.z - fz * 3.3;
    this.cases.drop(x, y, z, t.vx * 0.7 - fx * 4.5 + fz * side, 5.5, t.vz * 0.7 - fz * 4.5 - fx * side);
    for (let k = 0; k < 16; k++) this._spark(x, y, z);
    w.emit('caseDrop');
    const index = this.released++;
    if (index === 0) w.wanted.raiseTo(2);
    if (index === MAX_CASES - 1) {
      w.wanted.raiseTo(3);
      w.police.scramble(w.player, 2, this._camFwd());
      w.notify('ARMOR GONE - cops are closing in!', 'warn');
    }
  }

  // Pick a drop-off spot 350-550 m from the player on the harbor quay (the farthest clear spot when none is in that band).
  _pickDrop() {
    const w = this.world, p = w.player;
    const cands = [];
    for (const d of w.layout.docks) {
      if (d.name.includes('Pier')) continue;
      for (let x = d.x0 + 9; x <= d.x1 - 9; x += 6) {
        for (let z = d.z0 + 9; z <= d.z1 - 9; z += 6) if (w.collision.isFree(x, z, DROP_R + 1)) cands.push({ x, z, d: Math.hypot(x - p.px, z - p.pz) });
      }
    }
    if (!cands.length) return { x: 178, z: 350 };
    const inBand = cands.filter((c) => c.d >= 350 && c.d <= 550);
    if (inBand.length) return inBand[Math.floor(this.rng() * inBand.length)];
    return cands.reduce((a, b) => (b.d > a.d ? b : a));
  }

  _collected(g) {
    const w = this.world;
    this.collected++;
    w.emit('casePick');
    if (g.onFoot) {
      this.foot++;
      if (this.foot <= REWARD.footMax) this._pop(`ON-FOOT GRAB!  +$${REWARD.foot}`);
    }
    if (this.collected >= MAX_CASES) {
      this.timeLeft += EXTENSION;
      this.bonusT = 2.4;
      this.phase = 'deliver';
      this.drop = this._pickDrop();
      this.beacon.position.set(this.drop.x, w.layout.groundHeightAt(this.drop.x, this.drop.z), this.drop.z);
      this.beacon.visible = true;
      w.emit('amsBonus');
      w.notify('ALL GOLD ABOARD - get to the harbor drop-off', 'mission');
    }
  }

  _lights() {
    const L = this.truck.lights;
    if (!L) return;
    const hazard = this.armor <= 0;
    const phase = Math.floor(this.blinkT * 4) % 2; // 2 Hz
    L.a.material.color.setHex(hazard ? (phase ? 0xffa21a : 0x3a2204) : phase ? 0xffa21a : 0x3a2204);
    L.b.material.color.setHex(hazard ? (phase ? 0xffa21a : 0x3a2204) : phase ? 0x3a2204 : 0xffa21a);
  }

  _effects(dt) {
    const t = this.truck;
    if (!t) return;
    this._lights();
    this.chevron.visible = this.armor > 0;
    this.chevron.position.set(t.x, t.y + 3.5 + Math.sin(this.blinkT * 5) * 0.15, t.z);
    this.chevron.rotation.y += dt * 2.2;
    if (this.armor <= 0) {
      // black smoke and a stream of embers from the hood
      const fx = Math.sin(t.h), fz = Math.cos(t.h);
      this.smokeT = (this.smokeT ?? 0) - dt;
      while (this.smokeT <= 0) {
        this.smokeT += 0.07;
        const r = () => (this.rng() - 0.5) * 1.2;
        this.smoke.emit(t.x + fx * 2.4 + r() * 0.5, t.y + 1.5, t.z + fz * 2.4 + r() * 0.5, r(), 2.4 + this.rng(), r(), 1.7);
        if (this.rng() < 0.7) this.sparks.emit(t.x + fx * 2.4, t.y + 1.4, t.z + fz * 2.4, r() * 2.5, 3 + this.rng() * 3, r() * 2.5, 0.6);
      }
    }
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  // Returns null while running, {win, reward, lines, secs} on success or {fail: reason} on failure.
  update(dt) {
    if (!this.active || !this.truck) return null;
    const w = this.world, p = w.player, t = this.truck;
    if (!w.vehicles.list.includes(t)) return { fail: 'the truck got away' };
    this.timeLeft -= dt;
    this.blinkT += dt;
    this.cool = Math.max(0, this.cool - dt);
    this.bonusT = Math.max(0, this.bonusT - dt);
    this.dist = Math.hypot(t.x - p.px, t.z - p.pz);
    for (const s of this.swerved) s.t -= dt;
    this._unpanic();

    // rams: only the player's car, closing at 8 m/s or more, and not inside the 1.2 s grace after the last hit
    if (t.hitBy && t.hitBy === p.vehicle) {
      const sp = t.hitSpeed;
      if (p.vehicle) p.vehicle.shield = 0.6; // the armored hull takes the sting out of our own crash damage
      if (sp >= RAM_MIN && this.cool <= 0 && this.armor > 0) this._ram(sp);
    }
    t.hitBy = null;
    t.hitSpeed = 0;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i] -= dt;
      if (this.pending[i] <= 0) {
        this.pending.splice(i, 1);
        this._release();
      }
    }
    for (const g of this.cases.update(dt, p)) this._collected(g);
    this._effects(dt);

    // 25-second warning ticks
    const secs = Math.ceil(this.timeLeft);
    if (this.timeLeft <= 25 && secs !== this.tickAt) {
      this.tickAt = secs;
      w.emit('amsTick');
    }

    // delivery
    if (this.phase === 'deliver') {
      const d = Math.hypot(this.drop.x - p.px, this.drop.z - p.pz);
      const inside = d < DROP_R;
      const slow = p.inCar ? Math.abs(p.vehicle.speedF) <= DROP_SPEED : true;
      const copClose = w.wanted.stars > 0 && w.police.nearest <= LOCK_DIST;
      this.locked = inside && copClose;
      const pulse = 0.22 + Math.sin(this.blinkT * 6) * 0.06;
      this.dropMat.opacity = this.locked ? 0.3 : pulse;
      this.dropMat.color.setHex(this.locked ? 0xff4a3c : 0xffc21a);
      this.dropRingMat.color.setHex(this.locked ? 0xff4a3c : 0xffc21a);
      this.beacon.children[1].rotation.y += dt * 1.5;
      if (inside && slow && !copClose) {
        w.wanted.clear();
        w.police.clearAll();
        const secsLeft = Math.max(0, Math.round(this.timeLeft));
        const tb = Math.min(REWARD.timeCap, secsLeft * REWARD.perSecond);
        const hr = Math.min(REWARD.heavyMax, this.heavy) * REWARD.heavy;
        const fg = Math.min(REWARD.footMax, this.foot) * REWARD.foot;
        return {
          win: true,
          secs: secsLeft,
          reward: REWARD.base + tb + hr + fg,
          lines: [
            ['Base reward', REWARD.base],
            [`Time bonus  ${secsLeft}s x $${REWARD.perSecond}`, tb],
            [`Heavy rams  x${Math.min(REWARD.heavyMax, this.heavy)}`, hr],
            [`On-foot grabs  x${Math.min(REWARD.footMax, this.foot)}`, fg],
          ],
        };
      }
    }

    // fail rules
    if (this.armor > 0 && this.dist >= FAR_FAIL) this.farT += dt;
    else this.farT = 0;
    if (this.farT >= FAR_TIME) return { fail: 'the truck escaped' };
    if (this.timeLeft <= 0) return { fail: 'out of time' };
    return null;
  }
}
