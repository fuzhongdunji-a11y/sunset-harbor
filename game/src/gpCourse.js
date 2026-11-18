// gpCourse: the three Sunset GP circuits as road-graph node paths, turned into a smoothed centre-line polyline (corner arcs), checkpoint gates and arc-length projection.
// Pure data and geometry (no three.js): sunsetGP.js owns the race, rivalRacer.js follows the polyline.
import { DIRS } from './roadNet.js';

export const GANTRY_S = 26; // the start gantry stands this far along the first road segment (clear of the intersection)
export const CORNER_R = 12; // centre-line radius of a 90-degree corner
export const GATE_HALF = 7.5; // trigger radius of a gate (the pylons stand 5.5 m either side of the centre)
const TAIL = 60; // the polyline runs on past the finish so rivals keep a target to roll out on

// Road-graph node [i, j] paths. xs = -320..320 step 80 (i 0..8), zs = -280..280 step 80 (j 0..7).
// The brief's start coordinates are indicative: each start is snapped to the nearest road intersection.
export const ROUNDS = [
  {
    key: 'palms', name: 'PALMS SPRINT', title: 'Palms Boulevard Sprint', fee: 500, purse: [2000, 1000, 500, 0], gates: 12, laps: 1,
    // brief start (140,-220) -> node (6,1) = (160,-200); 21 segments = 1,680 m of road
    nodes: [[6, 1], [5, 1], [4, 1], [3, 1], [2, 1], [2, 2], [2, 3], [2, 4], [3, 4], [4, 4], [5, 4], [5, 5], [5, 6], [6, 6], [7, 6], [8, 6], [8, 5], [8, 4], [8, 3], [7, 3], [6, 3], [5, 3]],
  },
  {
    key: 'neon', name: 'DOWNTOWN NEON LOOP', title: 'Downtown Neon Loop', fee: 1000, purse: [3500, 1750, 800, 0], gates: 8, laps: 2,
    // brief start (-40,30) -> node (3,4) = (-80,40); one lap is the 4 x 3 block rectangle = 1,120 m, run twice
    loop: [[3, 4], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [7, 4], [7, 5], [7, 6], [6, 6], [5, 6], [4, 6], [3, 6], [3, 5], [3, 4]],
  },
  {
    key: 'harbor', name: 'HARBOR APEX FINALE', title: 'Harbor Apex Finale', fee: 1500, purse: [6000, 3000, 1200, 0], gates: 18, laps: 1,
    // brief start (-260,195) -> node (1,6) = (-240,200); 35 segments = 2,800 m, ending at the Marina end of the grid (80,280)
    nodes: [[1, 6], [1, 7], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7], [7, 7], [7, 6], [7, 5], [7, 4], [6, 4], [5, 4], [5, 5], [6, 5], [6, 6], [6, 7], [5, 7]],
  },
];

const dirOf = (a, b) => (b[0] > a[0] ? 0 : b[0] < a[0] ? 1 : b[1] > a[1] ? 2 : 3);

export class Course {
  constructor(net, round) {
    this.net = net;
    this.round = round;
    let nodes = round.nodes;
    this.lapNodes = round.loop ? round.loop.length - 1 : 0;
    if (round.loop) {
      nodes = [...round.loop];
      for (let l = 1; l < round.laps; l++) nodes.push(...round.loop.slice(1));
    }
    this.nodes = nodes;
    const X = (n) => net.xs[n[0]], Z = (n) => net.zs[n[1]];
    const pts = [];
    const corners = [];
    const dirs = [];
    for (let k = 0; k < nodes.length - 1; k++) dirs.push(dirOf(nodes[k], nodes[k + 1]));
    const d0 = DIRS[dirs[0]];
    this.startDir = dirs[0];
    this.gantry = { x: X(nodes[0]) + d0.x * GANTRY_S, z: Z(nodes[0]) + d0.z * GANTRY_S, h: d0.h, dx: d0.x, dz: d0.z };
    pts.push({ x: this.gantry.x, z: this.gantry.z });
    const nodeMid = []; // polyline index of each node's pass point (arc midpoint at a corner)
    nodeMid[0] = 0;
    for (let k = 1; k < nodes.length; k++) {
      const n = nodes[k], last = k === nodes.length - 1;
      const din = DIRS[dirs[k - 1]];
      if (last || dirs[k] === dirs[k - 1]) {
        pts.push({ x: X(n), z: Z(n) });
        nodeMid[k] = pts.length - 1;
        continue;
      }
      const dout = DIRS[dirs[k]];
      const R = CORNER_R;
      const cx = X(n) - din.x * R + dout.x * R, cz = Z(n) - din.z * R + dout.z * R;
      const first = pts.length;
      for (let a = 0; a <= 6; a++) {
        const th = (a / 6) * (Math.PI / 2);
        pts.push({ x: cx + R * (-dout.x * Math.cos(th) + din.x * Math.sin(th)), z: cz + R * (-dout.z * Math.cos(th) + din.z * Math.sin(th)) });
      }
      nodeMid[k] = first + 3;
      const right = din.x * dout.z - din.z * dout.x > 0; // screen-space handedness of the turn (z grows south): positive = clockwise from above = a right turn
      corners.push({ k, first, last: pts.length - 1, right });
    }
    const dl = DIRS[dirs[dirs.length - 1]];
    const end = pts[pts.length - 1];
    for (let t = 1; t <= 3; t++) pts.push({ x: end.x + dl.x * (TAIL / 3) * t, z: end.z + dl.z * (TAIL / 3) * t });
    this.finishIndex = nodeMid[nodes.length - 1];
    this.nodeMid = nodeMid;
    // arc length, tangents and right-hand normals
    let s = 0;
    pts[0].s = 0;
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      pts[i].s = s;
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      pts[i].tx = (b.x - a.x) / l;
      pts[i].tz = (b.z - a.z) / l;
      pts[i].nx = -pts[i].tz; // right of travel
      pts[i].nz = pts[i].tx;
    }
    this.pts = pts;
    // The finish line. A point-to-point round ends on its last node; a lap race ends (and every lap turns over) on the start gantry,
    // GANTRY_S past the start node, so the truss is the start line, the lap line and the finish arch in one.
    const lastNodeS = pts[nodeMid[nodes.length - 1]].s;
    this.total = round.loop ? lastNodeS + GANTRY_S : lastNodeS;
    this.corners = corners.map((c) => ({ s0: pts[c.first].s, s1: pts[c.last].s, right: c.right, k: c.k }));
    this.cornerOf = (k) => corners.find((c) => c.k === k);
    // gates: every corner node, the finish, then the longest gaps get a filler until the round's gate count is reached
    const perLap = round.loop ? this.lapNodes : nodes.length - 1;
    const turnSet = new Set();
    for (let k = 1; k <= perLap; k++) if (k === perLap || dirs[k] !== dirs[k - 1]) turnSet.add(k);
    if (perLap > 1) turnSet.add(1); // gate 1 stands on the first node after the line, so the pack clears one almost at once
    const want = Math.min(round.gates, perLap); // a node can carry only one gate: never ask for more than the lap has
    while (turnSet.size < want) {
      const arr = [0, ...[...turnSet].sort((a, b) => a - b)];
      let bi = 0, bg = 0;
      for (let i = 1; i < arr.length; i++) if (arr[i] - arr[i - 1] > bg) { bg = arr[i] - arr[i - 1]; bi = i; }
      if (bg < 2) break;
      turnSet.add(arr[bi - 1] + Math.floor(bg / 2));
    }
    const laps = round.loop ? round.laps : 1;
    this.gates = [];
    for (let l = 0; l < laps; l++) {
      for (const k0 of [...turnSet].sort((a, b) => a - b)) {
        const k = k0 + l * perLap;
        // gates stand on the racing line (the arc midpoint at a corner), not on the node centre, so the pylons frame the line the rivals follow;
        // the node that closes a lap is moved on to the gantry
        const lapEnd = !!round.loop && k0 === perLap;
        const s = lapEnd ? pts[nodeMid[k]].s + GANTRY_S : pts[nodeMid[k]].s;
        const c = this.pointAt(s);
        this.gates.push({ x: c.x, z: c.z, tx: c.tx, tz: c.tz, nx: c.nx, nz: c.nz, dx: DIRS[dirs[k - 1]].x, dz: DIRS[dirs[k - 1]].z, s, turn: k < nodes.length - 1 && dirs[k] !== dirs[k - 1], lap: l, lapEnd });
      }
    }
    this.gates.forEach((g, i) => { g.i = i; g.final = i === this.gates.length - 1; });
    this.perLapGates = this.gates.length / laps;
    this.laps = laps;
  }

  // Where the finish arch stands: on the line at the last gate, facing along the course.
  finishPose() {
    const c = this.pointAt(this.total);
    return { x: c.x, z: c.z, h: Math.atan2(c.tx, c.tz) };
  }

  // Metres still to run to the finish line from arc position s (never negative).
  distToFinish(s) {
    return Math.max(0, this.total - s);
  }

  // Display numbers for gate index i: {lap, laps, gate (1-based within the lap), perLap, number (1-based over the race), total}. A one-lap race reports lap 1 of 1.
  gateLabel(i) {
    const n = this.gates.length;
    const k = Math.max(0, Math.min(n - 1, i));
    return { lap: Math.floor(k / this.perLapGates) + 1, laps: this.laps, gate: (k % this.perLapGates) + 1, perLap: this.perLapGates, number: k + 1, total: n };
  }

  // Index of the last gate whose arc position a racer at s has already passed (-1 before the first).
  lastClearedGate(s) {
    let k = -1;
    for (const g of this.gates) if (g.s <= s) k = g.i; else break;
    return k;
  }

  // Interpolated centre-line sample at arc length s: {x, z, nx, nz, tx, tz}.
  pointAt(s) {
    const p = this.pts;
    if (s <= 0) return { ...p[0] };
    const lastI = p.length - 1;
    if (s >= p[lastI].s) return { ...p[lastI] };
    let lo = 0, hi = lastI;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (p[m].s <= s) lo = m; else hi = m;
    }
    const a = p[lo], b = p[hi];
    const t = (s - a.s) / (b.s - a.s);
    const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
    const nl = Math.hypot(nx, nz) || 1;
    const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
    const tl = Math.hypot(tx, tz) || 1;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: nx / nl, nz: nz / nl, tx: tx / tl, tz: tz / tl, s };
  }

  // Closest point on the polyline to (x, z), searched near segment `hint` (so a lap-2 car is not matched to lap 1). Returns {s, i, lat, dist}; lat > 0 = right of the line.
  project(x, z, hint = 0) {
    const p = this.pts;
    let lo = Math.max(0, hint - 3), hi = Math.min(p.length - 2, hint + 14);
    let best = null;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = lo; i <= hi; i++) {
        const a = p[i], b = p[i + 1];
        const ex = b.x - a.x, ez = b.z - a.z;
        const l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        const cx = a.x + ex * t, cz = a.z + ez * t;
        const d = Math.hypot(x - cx, z - cz);
        if (!best || d < best.dist) best = { s: a.s + Math.sqrt(l2) * t, i, dist: d, lat: (x - cx) * -(ez / Math.sqrt(l2)) + (z - cz) * (ex / Math.sqrt(l2)) };
      }
      if (best.dist < 30 || pass) break;
      lo = 0; // lost (teleport / unstuck): search the whole line once
      hi = p.length - 2;
    }
    return best;
  }

  // The first gate whose arc position is still ahead of s (the gate a racer at s is heading for; the final gate once all are passed).
  gateAhead(s) {
    for (const g of this.gates) if (g.s > s + 0.5) return g;
    return this.gates[this.gates.length - 1];
  }
}
