// roadDriver: AI controller that drives a Vehicle along road lanes (pure pursuit), turns at intersections, brakes for obstacles.
// Civilians pick random turns; police (chase mode) pick the turn that gets closest to the target and ram it when the way is clear.
import { DIRS, OPPOSITE, LANE, ENTRY, rightOf } from './roadNet.js';

const RIGHT_TURN = [2, 3, 1, 0];
const LEFT_TURN = [3, 2, 0, 1];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class RoadDriver {
  // opts: {lane, cruise (m/s), chase (bool)}
  constructor(vehicle, net, rng, opts = {}) {
    this.v = vehicle;
    this.net = net;
    this.rng = rng;
    this.lane = opts.lane ?? LANE;
    this.cruise = opts.cruise ?? 12;
    this.chase = !!opts.chase;
    this.ti = 0;
    this.tj = 0;
    this.d = 0;
    this.next = 0;
    this.chosen = false;
    this.stage = 'approach';
    this.stuckT = 0;
    this.blockT = 0;
    this.ghost = 0;
    this.direct = false;
    this.clear = false;
    this.clearT = 0;
    this.blocker = false;
    vehicle.driver = { ai: true, controller: this };
  }

  // Put the car on the lane of the segment leaving node (i, j) in direction d, `along` metres from the node.
  place(i, j, d, along) {
    const to = this.net.step(i, j, d);
    const p = this.net.lanePoint(i, j, d, along, this.lane);
    const v = this.v;
    v.x = p.x;
    v.z = p.z;
    v.h = DIRS[d].h;
    const sp = this.cruise * 0.8;
    v.vx = DIRS[d].x * sp;
    v.vz = DIRS[d].z * sp;
    v.speedF = sp;
    this.setSegment(to[0], to[1], d);
  }

  setSegment(ti, tj, d) {
    this.ti = ti;
    this.tj = tj;
    this.d = d;
    this.next = d;
    this.chosen = false;
    this.stage = 'approach';
  }

  // Re-attach to the nearest road segment in the direction the car is facing (after leaving the grid, e.g. a direct chase).
  snapToRoad() {
    const v = this.v, net = this.net;
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    let d = 0, best = -2;
    DIRS.forEach((q, k) => {
      const dot = q.x * fx + q.z * fz;
      if (dot > best) { best = dot; d = k; }
    });
    const [ci, cj] = net.nearestNode(v.x, v.z);
    const find = (dir) => {
      if (DIRS[dir].x !== 0) {
        const ti = dir === 0 ? net.xs.findIndex((a) => a > v.x) : net.xs.findLastIndex((a) => a < v.x);
        return ti < 0 ? null : [ti, cj];
      }
      const tj = dir === 2 ? net.zs.findIndex((a) => a > v.z) : net.zs.findLastIndex((a) => a < v.z);
      return tj < 0 ? null : [ci, tj];
    };
    let to = find(d);
    if (!to) {
      d = OPPOSITE[d];
      to = find(d) ?? [ci, cj];
    }
    this.setSegment(to[0], to[1], d);
  }

  _choose(target) {
    const { net, d } = this;
    const opts = [d, RIGHT_TURN[d], LEFT_TURN[d]].filter((o) => net.step(this.ti, this.tj, o));
    if (!opts.length) {
      this.next = OPPOSITE[d];
      this.chosen = true;
      return;
    }
    if (this.chase && target) {
      let best = opts[0], bd = Infinity;
      for (const o of opts) {
        const n = net.step(this.ti, this.tj, o);
        const dd = Math.abs(net.xs[n[0]] - target.x) + Math.abs(net.zs[n[1]] - target.z) + (o === d ? -6 : 0) + this.rng() * 2;
        if (dd < bd) { bd = dd; best = o; }
      }
      this.next = best;
    } else {
      const r = this.rng();
      let pick = d;
      if (r > 0.62) pick = r > 0.81 ? RIGHT_TURN[d] : LEFT_TURN[d];
      this.next = opts.includes(pick) ? pick : opts[Math.floor(this.rng() * opts.length)];
    }
    this.chosen = true;
  }

  // Speed ceiling imposed by vehicles and pedestrians in the corridor ahead.
  _obstacleLimit(ctx, ignore) {
    const v = this.v;
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const rx = -fz, rz = fx;
    const decel = this.chase ? 22 : 6.5;
    let limit = Infinity;
    const half = this.stage === 'cross' ? 2.9 : 2.1;
    for (const o of ctx.vehicles) {
      if (o === v || o === ignore) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0.5 || ahead > 28) continue;
      const lat = Math.abs(dx * rx + dz * rz);
      if (lat > half + o.type.wid * 0.3) continue;
      const gap = ahead - (v.type.len + o.type.len) / 2 - 1.2;
      limit = Math.min(limit, Math.sqrt(Math.max(0, 2 * decel * gap)));
    }
    for (const p of ctx.points) {
      const dx = p.x - v.x, dz = p.z - v.z;
      if (Math.abs(dx) > 20 || Math.abs(dz) > 20) continue;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0.5 || ahead > 16) continue;
      if (Math.abs(dx * rx + dz * rz) > 1.7) continue;
      limit = Math.min(limit, Math.sqrt(Math.max(0, 2 * 8 * (ahead - v.type.len / 2 - 1.4))));
    }
    return limit;
  }

  // ctx: {vehicles, points: [{x,z}], target: {x,z,vx,vz,speed}|null, lineClear(x0,z0,x1,z1), ignore}
  update(dt, ctx) {
    const v = this.v, inp = v.input;
    const { net } = this;
    let tx, tz, vt = this.cruise;
    const target = this.chase ? ctx.target : null;

    let direct = false;
    if (target) {
      const dist = Math.hypot(target.x - v.x, target.z - v.z);
      this.clearT -= dt;
      if (this.clearT <= 0) {
        this.clearT = 0.15;
        this.clear = dist < 36 && ctx.lineClear(v.x, v.z, target.x, target.z);
      }
      direct = this.clear && dist < 40;
      if (direct !== this.direct) {
        this.direct = direct;
        if (!direct) this.snapToRoad();
      }
      if (direct) {
        const lead = Math.min(0.9, dist / 25);
        tx = target.x + target.vx * lead;
        tz = target.z + target.vz * lead;
        vt = clamp(target.speed + (dist - 6) * 1.4, 0, v.type.maxSpeed * 0.95);
        if (dist < 9) vt = Math.max(vt, target.speed * 1.08 + 1.5);
      }
    }

    if (!direct) {
      if (target) vt = 26;
      const f = DIRS[this.d], r = rightOf(this.d), L = this.lane;
      const tox = net.xs[this.ti], toz = net.zs[this.tj];
      const s = (v.x - tox) * f.x + (v.z - toz) * f.z;
      if (this.stage === 'approach') {
        if (!this.chosen && -ENTRY - s < 40) this._choose(target);
        if (s >= -ENTRY + 0.5) {
          if (!this.chosen) this._choose(target);
          this.stage = 'cross';
        }
      }
      if (this.stage === 'approach') {
        const look = 7 + Math.abs(v.speedF) * 0.45;
        const st = Math.min(s + look, -ENTRY);
        tx = tox + f.x * st + r.x * L;
        tz = toz + f.z * st + r.z * L;
        if (this.chosen && this.next !== this.d) vt = Math.min(vt, 6.5 + Math.max(0, -ENTRY - s) * 0.6);
      } else {
        const f2 = DIRS[this.next], r2 = rightOf(this.next);
        const reach = ENTRY + (this.next === this.d ? 6 : 0);
        tx = tox + f2.x * reach + r2.x * L;
        tz = toz + f2.z * reach + r2.z * L;
        if (this.next !== this.d) vt = Math.min(vt, 7);
        const s2 = (v.x - tox) * f2.x + (v.z - toz) * f2.z;
        if (s2 > ENTRY - 4) {
          const n = net.step(this.ti, this.tj, this.next);
          if (n) this.setSegment(n[0], n[1], this.next);
          else this.snapToRoad();
        }
      }
    }

    // obstacles
    this.ghost = Math.max(0, this.ghost - dt);
    let limited = false;
    if (this.ghost <= 0 && !(direct && this.chase)) {
      const lim = this._obstacleLimit(ctx, this.chase ? ctx.ignore : null);
      if (lim < vt) {
        vt = lim;
        limited = true;
      }
    }
    this.blocker = limited && vt < 0.6;
    if (this.blocker && Math.abs(v.speedF) < 0.4) {
      this.blockT += dt;
      if (this.blockT > 5) {
        this.ghost = 2.5;
        this.blockT = 0;
      }
    } else {
      this.blockT = Math.max(0, this.blockT - dt);
    }

    // stuck against a wall: put the car back on its lane
    if (!limited && vt > 2 && Math.abs(v.speedF) < 0.4) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 3.5) {
      this.stuckT = 0;
      this.direct = false;
      this.snapToRoad();
      const f = DIRS[this.d], r = rightOf(this.d);
      const tox = net.xs[this.ti], toz = net.zs[this.tj];
      const s = Math.min(-ENTRY - 4, (v.x - tox) * f.x + (v.z - toz) * f.z);
      v.x = tox + f.x * s + r.x * this.lane;
      v.z = toz + f.z * s + r.z * this.lane;
      v.h = DIRS[this.d].h;
      v.vx = v.vz = 0;
      return;
    }

    const err = wrapAngle(Math.atan2(tx - v.x, tz - v.z) - v.h);
    inp.steer = clamp(err * 2.4, -1, 1);
    const vF = v.speedF;
    let thr = clamp((vt - vF) * 0.7, -1, 1);
    inp.hand = false;
    if (thr < 0 && vF < 1) {
      thr = 0;
      inp.hand = vt < 0.3;
    }
    inp.throttle = thr;
  }
}
