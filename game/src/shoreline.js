// shoreline: where boats may go. Terrain height for the grounding guardrail, solid obstacles (piers, quays, the freighter, the lighthouse), and the dry-land spots a player is put on when leaving a boat.
import { WORLD } from './config.js';

export const GROUND_H = -0.15; // terrain above this grounds a hull (drag + slide back down the coastal normal)
const SHORE_H = -0.4; // "within 6 m of the shoreline": terrain at or above this counts as shore
const SLOPE_RUN = 14; // the wet-sand slope falls 0.7 m over 14 m below WORLD.shoreZ (see environment.js)
export const DISMOUNT_RANGE = 6.0;

// Terrain height on the beach side of the water: > 0 on sand, sloping to -0.7 m 14 m out.
function beachHeight(z) {
  if (z <= WORLD.shoreZ) return 0.02;
  if (z >= WORLD.shoreZ + SLOPE_RUN) return -0.7 - (z - WORLD.shoreZ - SLOPE_RUN) * 0.05;
  return -0.7 * ((z - WORLD.shoreZ) / SLOPE_RUN);
}

// z where the slope drops below a given height.
const zAtHeight = (h) => WORLD.shoreZ + (-h / 0.7) * SLOPE_RUN;
export const GROUND_Z = zAtHeight(GROUND_H); // ~348: a hull is aground north of this
export const SHORE_Z = zAtHeight(SHORE_H); // ~353

export function buildShoreline(layout) {
  // solid boxes: every dock and pier, the scenery-only outer wharf and the freighter moored beside it
  const rects = layout.docks.map((d) => ({ x0: d.x0 - 0.15, z0: d.z0, x1: d.x1 + 0.15, z1: d.z1, top: d.top, walk: true }));
  rects.push({ x0: 268, z0: 345, x1: 332, z1: 404, top: 0.45, walk: false });
  rects.push({ x0: 274, z0: 408, x1: 328, z1: 428, top: 5, walk: false });
  const circles = [{ x: -110, z: 419, r: 3.2 }]; // lighthouse
  for (const b of layout.boats) circles.push({ x: b.x, z: b.z, r: Math.max(1.5, b.len * 0.2) }); // moored yachts and dinghies in the Lantern Pier basin

  // Terrain height under (x, z) for the grounding rule.
  function terrainAt(x, z) {
    for (const r of rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.top;
    return beachHeight(z);
  }

  // Deepest overlap of a hull circle with a solid: {nx, nz, depth, kind: 'solid'}; the beach itself is reported as kind 'shore'.
  function pushOut(x, z, r) {
    let best = null;
    for (const q of rects) {
      const px = Math.min(Math.max(x, q.x0), q.x1), pz = Math.min(Math.max(z, q.z0), q.z1);
      const dx = x - px, dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, depth;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        depth = r - d;
      } else {
        const l = x - q.x0, rt = q.x1 - x, u = z - q.z0, dn = q.z1 - z;
        const m = Math.min(l, rt, u, dn);
        nx = nz = 0;
        if (m === l) nx = -1;
        else if (m === rt) nx = 1;
        else if (m === u) nz = -1;
        else nz = 1;
        depth = m + r;
      }
      if (!best || depth > best.depth) best = { nx, nz, depth, kind: 'solid' };
    }
    for (const c of circles) {
      const dx = x - c.x, dz = z - c.z;
      const rr = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4;
      if (!best || rr - d > best.depth) best = { nx: dx / d, nz: dz / d, depth: rr - d, kind: 'solid' };
    }
    const beach = GROUND_Z + r * 0.6 - z; // the hull circle reaching the sand
    if (beach > 0 && (!best || beach > best.depth)) best = { nx: 0, nz: 1, depth: beach, kind: 'shore' };
    return best;
  }

  // Nearest dry spot for a player leaving a boat at (x, z): a pier deck within `range` of the hull, else the beach if the shore is that close. Null when nothing is in reach.
  function landingSpot(x, z, range, isFree) {
    let best = null, bd = range;
    for (const q of rects) {
      if (!q.walk) continue;
      const px = Math.min(Math.max(x, q.x0 + 0.6), q.x1 - 0.6), pz = Math.min(Math.max(z, q.z0 + 0.6), q.z1 - 0.6);
      const d = Math.hypot(x - px, z - pz);
      if (d < bd && isFree(px, pz)) {
        bd = d;
        best = { x: px, z: pz, y: q.top + 0.5 };
      }
    }
    if (z - SHORE_Z <= range) {
      const d = Math.max(0, z - SHORE_Z);
      if (d < bd || !best) {
        for (const dx of [0, 1.5, -1.5, 3, -3, 5, -5, 8, -8]) {
          if (isFree(x + dx, WORLD.shoreZ - 6)) {
            if (d <= bd) best = { x: x + dx, z: WORLD.shoreZ - 6, y: 0.5 };
            break;
          }
        }
      }
    }
    return best;
  }

  // The closest dry spot at any distance (sinking boat, water rescue).
  function nearestShore(x, z, isFree) {
    return landingSpot(x, z, 1e4, isFree) ?? { x: Math.max(-330, Math.min(330, x)), z: WORLD.shoreZ - 6, y: 0.5 };
  }

  return { terrainAt, pushOut, landingSpot, nearestShore, rects };
}
