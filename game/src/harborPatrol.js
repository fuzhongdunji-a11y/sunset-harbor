// harborPatrol: police boats. While the player is afloat in deep water with 2+ stars (or the Contraband Drop calls for them) up to two Interceptors hunt them: one runs parallel and rams, two pincer from either side. Also owns the water arrest.
import { GROUND_Z } from './shoreline.js';
import { HULL_HP } from './boatSystem.js';

const DEEP_Z = 385; // beyond the pier tips: "deep water"
const ARREST_SPEED = 2.5;
const ARREST_RANGE = 9;
const ARREST_TIME = 4.0;
const RAM_COOLDOWN = 1.6;
const HORN_RANGE = 160;
const TOP_ONE_STAR = 32.5;
const TOP_PINCER = 36.0;

const wrap = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class HarborPatrol {
  constructor(world, boats) {
    this.world = world;
    this.boats = boats;
    this.units = []; // {b, role, ramT, active}
    for (let i = 0; i < 2; i++) {
      const b = boats.create('patrol');
      b.sunk = true;
      b.hp = HULL_HP * 10;
      b.driver = { ai: true };
      this.units.push({ b, role: i, ramT: 0, active: false });
    }
    this.nearest = Infinity;
    this.bust = 0;
    this.force = 0; // patrol boats the mission asks for regardless of stars
    this.rng = world.boats.rng;
  }

  get bustProgress() {
    return Math.min(1, this.bust / ARREST_TIME);
  }

  get activeCount() {
    return this.units.filter((u) => u.active).length;
  }

  get list() {
    return this.units.filter((u) => u.active).map((u) => u.b);
  }

  _wanted() {
    const w = this.world, p = w.player;
    if (!p.inCar || !p.vehicle.isBoat || w.fx) return 0;
    const stars = w.wanted.stars;
    let n = 0;
    if (stars >= 2 && p.vehicle.z > DEEP_Z) n = stars === 2 ? 1 : 2;
    return Math.min(2, Math.max(n, this.force));
  }

  // Spawn one Interceptor on the seaward side, ahead of the player's heading, `dist` metres out.
  spawn(dist = 160, role = null) {
    const u = this.units.find((q) => !q.active);
    if (!u) return null;
    const w = this.world, pb = w.player.vehicle;
    const sh = Math.sin(pb.h), ch = Math.cos(pb.h);
    let best = null;
    for (let k = 0; k < 14; k++) {
      // ahead of the bow and out to sea; later tries fan out to either side
      const fan = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35 + (role === 1 ? -0.5 : 0);
      const fx = sh * Math.cos(fan) + ch * Math.sin(fan), fz = ch * Math.cos(fan) - sh * Math.sin(fan);
      let dx = fx * 0.6, dz = fz * 0.6 + 0.8;
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      const x = pb.x + dx * dist, z = Math.max(DEEP_Z + 30, pb.z + dz * dist);
      if (this.boats.shore.pushOut(x, z, 6)) continue;
      best = { x, z };
      break;
    }
    if (!best) best = { x: pb.x, z: Math.max(DEEP_Z + 60, pb.z + dist) };
    const b = u.b;
    b.sunk = false;
    b.docked = false;
    b.sinking = false;
    b.x = best.x;
    b.z = best.z;
    b.y = this.boats.waterAt(b.x, b.z);
    b.h = Math.atan2(pb.x - b.x, pb.z - b.z);
    b.vx = Math.sin(b.h) * 14;
    b.vz = Math.cos(b.h) * 14;
    b.speedF = 14;
    b.steer = 0;
    b.pitch = b.roll = 0;
    b.hp = HULL_HP * 10;
    b.airborne = false;
    u.active = true;
    u.ramT = 2;
    u.role = role ?? this.units.filter((q) => q.active).length - 1;
    if (Math.hypot(b.x - pb.x, b.z - pb.z) < HORN_RANGE + 5) w.emit('patrolHorn');
    return b;
  }

  _despawn(u) {
    u.active = false;
    u.b.sunk = true;
  }

  clearAll() {
    for (const u of this.units) this._despawn(u);
    this.bust = 0;
    this.nearest = Infinity;
    this.force = 0;
  }

  // AI decides once per frame (before the physics sub-steps).
  drive(dt) {
    const w = this.world, p = w.player;
    const want = this._wanted();
    // despawn extras / everything
    let active = this.units.filter((u) => u.active);
    if (want === 0) for (const u of active) this._despawn(u);
    else while (active.length > want) this._despawn(active.pop());
    active = this.units.filter((u) => u.active);
    if (want > active.length && p.inCar) this.spawn(160, active.length);
    if (!p.inCar || !p.vehicle.isBoat) return;
    const pb = p.vehicle;
    const pf = [Math.sin(pb.h), Math.cos(pb.h)];
    const pl = [Math.cos(pb.h), -Math.sin(pb.h)];
    const stars = Math.max(2, w.wanted.stars);
    for (const u of this.units) {
      if (!u.active) continue;
      const b = u.b;
      b.topSpeed = stars >= 3 || u.role === 1 ? TOP_PINCER : TOP_ONE_STAR;
      u.ramT -= dt;
      const dist = Math.hypot(pb.x - b.x, pb.z - b.z);
      const side = stars >= 3 ? (u.role === 0 ? 1 : -1) : -1; // 2 stars: run alongside on the starboard side, 3+: pincer from both
      const spread = Math.min(1, Math.max(0, (dist - 16) / 22)) * (stars >= 3 ? 15 : 10);
      const lead = Math.min(1.4, dist / 40);
      const tx = pb.x + pb.vx * lead + pl[0] * side * spread;
      const tz = pb.z + pb.vz * lead + pl[1] * side * spread;
      let want_h = Math.atan2(tx - b.x, tz - b.z);
      // keep off the beach: if the bow is about to run aground, turn out to sea
      const ax = b.x + Math.sin(b.h) * 28, az = b.z + Math.cos(b.h) * 28;
      if (az < GROUND_Z + 14 || this.boats.shore.pushOut(ax, az, 4)) want_h = Math.atan2(Math.sin(b.h) * 0.3, 1);
      const err = wrap(want_h - b.h);
      b.input.steer = Math.max(-1, Math.min(1, err * 2.4));
      const pace = Math.abs(pb.speedF);
      const target = dist > 45 ? 99 : pace + (dist > 14 ? 4 : 7);
      b.input.throttle = Math.max(-0.2, Math.min(1, (target - b.speedF) / 4));
      b.input.hand = false;
      void pf;
    }
  }

  // After the physics: boat-on-boat bumps and the water arrest. Returns 'busted' when the player was arrested.
  update(dt) {
    const w = this.world, p = w.player;
    this.nearest = Infinity;
    const pb = p.inCar && p.vehicle.isBoat ? p.vehicle : null;
    if (!pb) {
      this.bust = Math.max(0, this.bust - dt * 1.5);
      return null;
    }
    let close = false;
    for (const u of this.units) {
      if (!u.active) continue;
      const b = u.b;
      const dist = Math.hypot(pb.x - b.x, pb.z - b.z);
      this.nearest = Math.min(this.nearest, dist);
      if (dist < ARREST_RANGE) close = true;
      if (dist < 6) this._bump(u, pb);
    }
    if (close && w.wanted.stars >= 2 && Math.abs(pb.speedF) < ARREST_SPEED) this.bust += dt;
    else this.bust = Math.max(0, this.bust - dt * 1.5);
    if (this.bust >= ARREST_TIME) {
      this.bust = 0;
      return 'busted';
    }
    return null;
  }

  _bump(u, pb) {
    const b = u.b;
    const rr = b.radius + pb.radius;
    let best = null;
    for (const a of b.circles()) {
      for (const c of pb.circles()) {
        const dx = c.x - a.x, dz = c.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < rr && (!best || rr - d > best.depth)) best = { nx: dx / (d || 1e-4), nz: dz / (d || 1e-4), depth: rr - d };
      }
    }
    if (!best) return;
    const wa = b.type.weight, wb = pb.type.weight;
    const t = wa + wb;
    pb.x += best.nx * best.depth * (wa / t);
    pb.z += best.nz * best.depth * (wa / t);
    b.x -= best.nx * best.depth * (wb / t);
    b.z -= best.nz * best.depth * (wb / t);
    const rel = (pb.vx - b.vx) * best.nx + (pb.vz - b.vz) * best.nz;
    if (rel < 0) {
      const j = (-(1 + 0.35) * rel) / (1 / wa + 1 / wb);
      pb.vx += (j * best.nx) / wb;
      pb.vz += (j * best.nz) / wb;
      b.vx -= (j * best.nx) / wa;
      b.vz -= (j * best.nz) / wa;
      pb.impact = Math.max(pb.impact, -rel);
    }
    if (u.ramT <= 0) {
      u.ramT = RAM_COOLDOWN;
      const closing = Math.max(0, -rel);
      this.boats.damage(pb, 18 + 17 * Math.min(1, closing / 14)); // Interceptor ram: 18-35 hull
      this.world.wanted.commit('ramPolice');
      pb.impact = Math.max(pb.impact, Math.max(3, closing));
    }
  }
}
