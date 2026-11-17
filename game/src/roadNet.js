// roadNet: the road grid as a graph of intersections (i, j) with four travel directions, plus lane geometry helpers.
export const DIRS = [
  { x: 1, z: 0, h: Math.PI / 2 }, // 0: east
  { x: -1, z: 0, h: -Math.PI / 2 }, // 1: west
  { x: 0, z: 1, h: 0 }, // 2: south (+z)
  { x: 0, z: -1, h: Math.PI }, // 3: north
];
export const OPPOSITE = [1, 0, 3, 2];
export const LANE = 4.5; // lane centre offset from the road centre line (right-hand traffic)
export const ENTRY = 10.5; // distance from an intersection centre where the turn path starts

// Right-hand side of a direction: for travel (fx, fz) it is (-fz, fx).
export const rightOf = (d) => ({ x: -DIRS[d].z, z: DIRS[d].x });

export class RoadNet {
  constructor(layout) {
    this.xs = layout.xs;
    this.zs = layout.zs;
    this.ni = layout.xs.length;
    this.nj = layout.zs.length;
  }

  // Node reached by leaving (i, j) in direction d, or null at the edge of the map.
  step(i, j, d) {
    const ni = i + DIRS[d].x, nj = j + DIRS[d].z;
    return ni < 0 || nj < 0 || ni >= this.ni || nj >= this.nj ? null : [ni, nj];
  }

  nearestNode(x, z) {
    let bi = 0, bj = 0, bx = Infinity, bz = Infinity;
    this.xs.forEach((v, i) => {
      if (Math.abs(v - x) < bx) { bx = Math.abs(v - x); bi = i; }
    });
    this.zs.forEach((v, j) => {
      if (Math.abs(v - z) < bz) { bz = Math.abs(v - z); bj = j; }
    });
    return [bi, bj];
  }

  // World point on the lane of the segment leaving (i, j) in direction d, `along` metres from the node.
  lanePoint(i, j, d, along, lane = LANE) {
    const f = DIRS[d], r = rightOf(d);
    return { x: this.xs[i] + f.x * along + r.x * lane, z: this.zs[j] + f.z * along + r.z * lane };
  }

  // A random point on some lane, with the heading of that lane.
  randomLane(rng, lane = LANE) {
    for (let tries = 0; tries < 20; tries++) {
      const i = rng.int(0, this.ni - 1), j = rng.int(0, this.nj - 1), d = rng.int(0, 3);
      if (!this.step(i, j, d)) continue;
      const p = this.lanePoint(i, j, d, rng.range(16, 64), lane);
      return { ...p, d, i, j };
    }
    return { ...this.lanePoint(0, 0, 2, 30, lane), d: 2, i: 0, j: 0 };
  }
}
