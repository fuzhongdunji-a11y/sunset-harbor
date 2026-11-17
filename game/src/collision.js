// collision: spatial-grid lookup of static colliders (AABBs and circles) and walkable-area bounds, used by cars and pedestrians.
const CELL = 24;

export class Collision {
  constructor(colliders, bounds) {
    this.grid = new Map();
    this.bounds = bounds;
    for (const c of colliders) this._insert(c);
  }

  _key(ix, iz) {
    return ix * 4096 + iz;
  }

  _insert(c) {
    const x0 = c.type === 'aabb' ? c.x0 : c.x - c.r;
    const x1 = c.type === 'aabb' ? c.x1 : c.x + c.r;
    const z0 = c.type === 'aabb' ? c.z0 : c.z - c.r;
    const z1 = c.type === 'aabb' ? c.z1 : c.z + c.r;
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const k = this._key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
  }

  // Deepest overlap of a circle against static colliders: {nx, nz, depth, h} or null.
  pushOut(x, z, r) {
    let best = null;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          let nx, nz, depth;
          if (c.type === 'aabb') {
            const px = Math.min(Math.max(x, c.x0), c.x1);
            const pz = Math.min(Math.max(z, c.z0), c.z1);
            const dx = x - px, dz = z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 > 1e-9) {
              const d = Math.sqrt(d2);
              nx = dx / d;
              nz = dz / d;
              depth = r - d;
            } else {
              const left = x - c.x0, right = c.x1 - x, up = z - c.z0, down = c.z1 - z;
              const m = Math.min(left, right, up, down);
              nx = nz = 0;
              if (m === left) nx = -1;
              else if (m === right) nx = 1;
              else if (m === up) nz = -1;
              else nz = 1;
              depth = m + r;
            }
          } else {
            const dx = x - c.x, dz = z - c.z;
            const rr = r + c.r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1e-4;
            nx = dx / d;
            nz = dz / d;
            depth = rr - d;
          }
          if (!best || depth > best.depth) best = { nx, nz, depth, h: c.h };
        }
      }
    }
    return best;
  }

  // True when a circle at (x, z) fits inside the walkable bounds.
  inBounds(x, z, r = 0) {
    for (const b of this.bounds) if (x >= b.x0 + r && x <= b.x1 - r && z >= b.z0 + r && z <= b.z1 - r) return true;
    return false;
  }

  // Clamp a point into the walkable area; returns {x, z, hit} with hit = whether it had to move.
  constrain(x, z, r = 0) {
    if (this.inBounds(x, z, r)) return { x, z, hit: false, nx: 0, nz: 0 };
    let bestD = Infinity, bx = x, bz = z;
    for (const b of this.bounds) {
      const cx = Math.min(Math.max(x, b.x0 + r), b.x1 - r);
      const cz = Math.min(Math.max(z, b.z0 + r), b.z1 - r);
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        bx = cx;
        bz = cz;
      }
    }
    const len = Math.sqrt(bestD) || 1;
    return { x: bx, z: bz, hit: true, nx: (bx - x) / len, nz: (bz - z) / len };
  }

  // Is there anything solid within radius r of the point (used for spawn/exit spots)?
  isFree(x, z, r) {
    return this.inBounds(x, z, r) && !this.pushOut(x, z, r);
  }
}
