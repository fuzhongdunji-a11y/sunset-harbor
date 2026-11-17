// pedestrians: townsfolk walking the sidewalk loops, waiting for gaps in traffic, fleeing oncoming cars and getting knocked down.
// People hop between sidewalk corners (4 per intersection); the population is recycled around the player to keep the count low.
import { buildPedestrian } from './characters.js';

const OFF = 10.8; // sidewalk centre line distance from a road centre line
const WALK = 1.45;
const RUN = 5.2;

export class Pedestrians {
  constructor(scene, net, rng, groundHeightAt, count) {
    this.scene = scene;
    this.net = net;
    this.rng = rng;
    this.groundHeightAt = groundHeightAt;
    this.list = [];
    for (let n = 0; n < count; n++) {
      const model = buildPedestrian(Math.floor(rng() * 24));
      model.group.visible = false;
      scene.add(model.group);
      this.list.push({
        model, x: 0, z: 0, y: 0, heading: 0, state: 'walk', timer: 0, speed: WALK * rng.range(0.85, 1.2),
        from: null, to: null, crossing: false, vx: 0, vz: 0, down: 0, active: false, fleeDx: 0, fleeDz: 0,
      });
    }
  }

  cornerPos(c) {
    return { x: this.net.xs[c.i] + c.sx * OFF, z: this.net.zs[c.j] + c.sz * OFF };
  }

  _valid(i, j, sx, sz) {
    const n = this.net;
    return i >= 0 && j >= 0 && i < n.ni && j < n.nj && (sx > 0 ? i < n.ni - 1 : i > 0) && (sz > 0 ? j < n.nj - 1 : j > 0);
  }

  _neighbors(c) {
    const out = [];
    const add = (i, j, sx, sz, cross) => {
      if (this._valid(i, j, sx, sz)) out.push({ c: { i, j, sx, sz }, cross });
    };
    add(c.i, c.j, -c.sx, c.sz, true);
    add(c.i, c.j, c.sx, -c.sz, true);
    add(c.i + c.sx, c.j, -c.sx, c.sz, false);
    add(c.i, c.j + c.sz, c.sx, -c.sz, false);
    return out;
  }

  _randomCorner() {
    const r = this.rng, n = this.net;
    for (;;) {
      const c = { i: r.int(0, n.ni - 1), j: r.int(0, n.nj - 1), sx: r() < 0.5 ? -1 : 1, sz: r() < 0.5 ? -1 : 1 };
      if (this._valid(c.i, c.j, c.sx, c.sz)) return c;
    }
  }

  // Put a person on a random corner between minD and maxD metres from the focus point.
  place(p, focus, minD, maxD) {
    let c = this._randomCorner();
    for (let t = 0; t < 30; t++) {
      const q = this._randomCorner();
      const pos = this.cornerPos(q);
      const d = Math.hypot(pos.x - focus.x, pos.z - focus.z);
      c = q;
      if (d >= minD && d <= maxD) break;
    }
    const pos = this.cornerPos(c);
    p.x = pos.x;
    p.z = pos.z;
    p.y = this.groundHeightAt(p.x, p.z);
    p.from = c;
    p.to = null;
    p.state = 'walk';
    p.timer = 0;
    p.down = 0;
    p.crossing = false;
    p.model.fall(0);
    p.model.group.visible = true;
    p.active = true;
    this._pickNext(p, null);
  }

  // Deterministic placement for shots: stand on the way from corner `from` to corner `to`, t of the way along.
  placeBetween(p, from, to, t) {
    const a = this.cornerPos(from), b = this.cornerPos(to);
    p.x = a.x + (b.x - a.x) * t;
    p.z = a.z + (b.z - a.z) * t;
    p.y = this.groundHeightAt(p.x, p.z);
    p.from = from;
    p.to = to;
    p.crossing = false;
    p.state = 'walk';
    p.active = true;
    p.model.group.visible = true;
  }

  populate(focus) {
    for (const p of this.list) this.place(p, focus, 20, 150);
  }

  _pickNext(p, prev) {
    const opts = this._neighbors(p.from);
    let pool = opts.filter((o) => !prev || o.c.i !== prev.i || o.c.j !== prev.j || o.c.sx !== prev.sx || o.c.sz !== prev.sz);
    if (!pool.length) pool = opts;
    const along = pool.filter((o) => !o.cross);
    const pick = along.length && this.rng() < 0.6 ? along : pool;
    const o = pick[Math.floor(this.rng() * pick.length)];
    p.to = o.c;
    p.crossing = o.cross;
    p.waited = false;
  }

  // Knock a person down (a car hit them). Returns true the first time.
  hit(p, vehicle) {
    if (p.state === 'down') return false;
    p.state = 'down';
    p.down = 0;
    p.vx = vehicle.vx * 0.55;
    p.vz = vehicle.vz * 0.55;
    p.crossing = false;
    return true;
  }

  // Someone steps out of a hijacked car at (x, z) and runs away.
  ejectDriver(x, z, focus) {
    let best = null, bd = -1;
    for (const p of this.list) {
      if (p.state === 'down') continue;
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d > bd) { bd = d; best = p; }
    }
    if (!best) return;
    best.x = x;
    best.z = z;
    best.active = true;
    best.model.group.visible = true;
    best.model.fall(0);
    best.state = 'flee';
    best.timer = 4.5;
    best.fleeDx = this.rng.range(-1, 1);
    best.fleeDz = this.rng.range(-1, 1);
  }

  // Standing-in-the-road people the drivers should brake for.
  roadPoints() {
    return this.list.filter((p) => p.crossing && p.state === 'walk' && p.active);
  }

  _trafficNear(x, z, vehicles, radius) {
    for (const v of vehicles) {
      if (Math.abs(v.x - x) > radius || Math.abs(v.z - z) > radius) continue;
      if (Math.abs(v.speedF) > 1.5 && Math.hypot(v.x - x, v.z - z) < radius) return true;
    }
    return false;
  }

  // Returns [{ped, vehicle}] for every person knocked down this frame.
  update(dt, ctx) {
    const hits = [];
    const { vehicles, focus } = ctx;
    for (const p of this.list) {
      const dFocus = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (dFocus > 190) {
        this.place(p, focus, 60, 150);
        continue;
      }
      const m = p.model;
      m.group.visible = dFocus < 150;
      if (!m.group.visible && p.state !== 'walk') p.state = 'walk';
      if (!m.group.visible) continue; // out of sight: frozen until the player comes back or they are recycled

      // cars bearing down on us
      if (p.state === 'walk' || p.state === 'wait') {
        for (const v of vehicles) {
          if (Math.abs(v.x - p.x) > 12 || Math.abs(v.z - p.z) > 12) continue;
          const sp = Math.abs(v.speedF);
          if (sp < 3.5) continue;
          const dx = p.x - v.x, dz = p.z - v.z;
          const d = Math.hypot(dx, dz);
          if (d > 11) continue;
          const dot = (v.vx * dx + v.vz * dz) / (Math.hypot(v.vx, v.vz) * d + 1e-6);
          if (dot < 0.35) continue;
          // jump sideways, away from the car's path
          const fx = v.vx / (Math.hypot(v.vx, v.vz) + 1e-6), fz = v.vz / (Math.hypot(v.vx, v.vz) + 1e-6);
          const side = dx * -fz + dz * fx >= 0 ? 1 : -1;
          p.state = 'flee';
          p.timer = 1.3;
          p.fleeDx = -fz * side;
          p.fleeDz = fx * side;
          break;
        }
      }

      if (p.state === 'down') {
        p.down += dt;
        const k = Math.min(1, p.down / 0.3);
        m.fall(k);
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.vx *= Math.exp(-4 * dt);
        p.vz *= Math.exp(-4 * dt);
        m.animate(dt, 0);
        if (p.down > 6) this.place(p, focus, 70, 150);
      } else if (p.state === 'flee') {
        p.timer -= dt;
        const l = Math.hypot(p.fleeDx, p.fleeDz) || 1;
        p.x += (p.fleeDx / l) * RUN * dt;
        p.z += (p.fleeDz / l) * RUN * dt;
        p.heading = Math.atan2(p.fleeDx, p.fleeDz);
        m.animate(dt, RUN);
        if (p.timer <= 0) {
          p.state = 'walk';
          p.crossing = false;
          p.from = this._nearestCorner(p.x, p.z);
          this._pickNext(p, null);
        }
      } else if (p.state === 'wait') {
        p.timer -= dt;
        m.animate(dt, 0);
        if (p.timer <= 0) {
          const a = this.cornerPos(p.from), b = this.cornerPos(p.to);
          if (!this._trafficNear((a.x + b.x) / 2, (a.z + b.z) / 2, vehicles, 30)) p.state = 'walk';
          else p.timer = 0.5;
        }
      } else {
        const t = this.cornerPos(p.to);
        const dx = t.x - p.x, dz = t.z - p.z;
        const d = Math.hypot(dx, dz);
        if (p.crossing && !p.waited && d > 17) {
          // about to cross: wait until the road is quiet
          const a = this.cornerPos(p.from);
          if (this._trafficNear((a.x + t.x) / 2, (a.z + t.z) / 2, vehicles, 30)) {
            p.state = 'wait';
            p.timer = 0.5;
            m.animate(dt, 0);
            continue;
          }
          p.waited = true;
        }
        if (d < 0.35) {
          const prev = p.from;
          p.from = p.to;
          this._pickNext(p, prev);
        } else {
          const stepLen = Math.min(d, p.speed * dt);
          p.x += (dx / d) * stepLen;
          p.z += (dz / d) * stepLen;
          p.heading += wrap(Math.atan2(dx, dz) - p.heading) * Math.min(1, 10 * dt);
          m.animate(dt, p.speed);
        }
      }
      p.y += (this.groundHeightAt(p.x, p.z) - p.y) * Math.min(1, 12 * dt);
      m.group.position.set(p.x, p.y + (p.state === 'down' ? 0.0 : 0), p.z);
      m.group.rotation.y = p.heading;

      if (p.state !== 'down') {
        for (const v of vehicles) {
          if (Math.abs(v.x - p.x) > 4 || Math.abs(v.z - p.z) > 4) continue;
          if (Math.abs(v.speedF) > 3 && v.distanceTo(p.x, p.z) < 0.45 && this.hit(p, v)) hits.push({ ped: p, vehicle: v });
        }
      }
    }
    return hits;
  }

  _nearestCorner(x, z) {
    const [i, j] = this.net.nearestNode(x, z);
    const sx = x >= this.net.xs[i] ? 1 : -1, sz = z >= this.net.zs[j] ? 1 : -1;
    if (this._valid(i, j, sx, sz)) return { i, j, sx, sz };
    return this._randomCorner();
  }
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
