// boatModels: low-poly vertex-coloured geometry for the Sunrunner 28, the Harbor Patrol Interceptor, the contraband buoy, the mission marker and the wake foam. Pure builders: each returns one BufferGeometry (origin at the waterline, +Z = bow, +X = port).
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';

export const BOAT_TYPES = {
  sunrunner: { key: 'sunrunner', name: 'Sunrunner 28', len: 8.5, wid: 2.6, maxSpeed: 34, weight: 1.4 },
  patrol: { key: 'patrol', name: 'Harbor Patrol Interceptor', len: 9.6, wid: 3.0, maxSpeed: 36, weight: 1.9 },
};

const IVORY = 0xf4f1ea, CORAL = 0xff5e3a, GLASS = 0x1e3246, DARK = 0x2a2d33;

// Deep-V hull from a sharp bow to a flat transom: keel, chine and deck lines.
function hull(b, L, W, top, hullCol, deckCol) {
  const bowZ = L / 2, sternZ = -L / 2;
  const chine = (z) => (z > bowZ * 0.35 ? W / 2 * (1 - (z - bowZ * 0.35) / (bowZ * 0.65) * 0.95) : W / 2);
  const stations = [sternZ, -L * 0.2, L * 0.1, bowZ * 0.35, bowZ * 0.75, bowZ];
  const keelY = -0.55;
  for (let i = 0; i < stations.length - 1; i++) {
    const z0 = stations[i], z1 = stations[i + 1];
    const w0 = chine(z0), w1 = Math.max(0.05, chine(z1));
    const k0 = keelY + (i === 0 ? 0 : 0), k1 = keelY + (z1 > bowZ * 0.5 ? 0.2 : 0);
    const y0 = 0.12, y1 = i >= 4 ? 0.5 : 0.1; // chine height rises toward the bow
    const topY0 = top, topY1 = top + (i >= 3 ? 0.18 : 0);
    // hull sides (chine to gunwale) and bottom (keel to chine)
    b.quad([w0, y0, z0], [w1, y1, z1], [w1, topY1, z1], [w0, topY0, z0], hullCol, [1, 0, 0]);
    b.quad([-w0, y0, z0], [-w1, y1, z1], [-w1, topY1, z1], [-w0, topY0, z0], hullCol, [-1, 0, 0]);
    b.quad([w0, y0, z0], [w1, y1, z1], [0, k1, z1], [0, k0, z0], 0x25364a, [1, -1, 0]);
    b.quad([-w0, y0, z0], [-w1, y1, z1], [0, k1, z1], [0, k0, z0], 0x25364a, [-1, -1, 0]);
    // deck
    b.quad([w0, topY0, z0], [w1, topY1, z1], [-w1, topY1, z1], [-w0, topY0, z0], deckCol, [0, 1, 0]);
  }
  // transom
  const w = chine(sternZ);
  b.quad([w, 0.12, sternZ], [-w, 0.12, sternZ], [-w, top, sternZ], [w, top, sternZ], hullCol, [0, 0, -1]);
  b.tri([w, 0.12, sternZ], [0, keelY, sternZ], [-w, 0.12, sternZ], 0x25364a);
}

function outboard(b, x, sternZ) {
  b.box(x - 0.28, 0.2, sternZ - 0.75, x + 0.28, 1.05, sternZ - 0.05, DARK); // cowling
  b.box(x - 0.2, 0.9, sternZ - 0.7, x + 0.2, 1.1, sternZ - 0.15, 0xc8ccd2);
  b.box(x - 0.07, -0.55, sternZ - 0.55, x + 0.07, 0.25, sternZ - 0.4, DARK); // leg
  b.box(x - 0.2, -0.6, sternZ - 0.75, x + 0.2, -0.4, sternZ - 0.3, DARK); // prop housing
}

export function buildSunrunnerGeometry() {
  const b = new MeshBuilder();
  const { len: L, wid: W } = BOAT_TYPES.sunrunner;
  hull(b, L, W, 0.78, IVORY, 0xe8d9bd);
  // sunset-coral racing stripe along the gunwale and a coral deck patch
  b.box(-W / 2 - 0.02, 0.5, -L / 2 + 0.2, W / 2 + 0.02, 0.62, L * 0.18, CORAL);
  b.box(-0.55, 0.8, -L * 0.42, 0.55, 0.83, -L * 0.1, CORAL);
  // low cuddy + raked wraparound windshield
  b.slab([-0.95, -0.2, 0.95, 1.2], [-0.8, 0.5, 0.8, 1.1], 0.78, 1.25, IVORY);
  b.quad([-0.95, 0.78, -0.2], [0.95, 0.78, -0.2], [0.8, 1.55, -0.05], [-0.8, 1.55, -0.05], GLASS, [0, 0, -1]);
  b.box(-0.82, 1.5, -0.12, 0.82, 1.6, 0.0, DARK);
  // helm console and seats
  b.box(-0.6, 0.78, -1.1, 0.6, 1.25, -0.5, 0xf4f1ea);
  b.box(-0.55, 0.78, -2.1, 0.55, 1.15, -1.4, 0x2d3a4d);
  b.box(-0.18, 1.0, -1.02, 0.18, 1.45, -0.98, GLASS);
  outboard(b, -0.6, -L / 2);
  outboard(b, 0.6, -L / 2);
  b.box(-0.05, 0.78, L / 2 - 1.1, 0.05, 1.5, L / 2 - 1.0, 0xdddddd); // bow light staff
  return b.build();
}

export function buildPatrolGeometry() {
  const b = new MeshBuilder();
  const { len: L, wid: W } = BOAT_TYPES.patrol;
  const NAVY = 0x102542;
  hull(b, L, W, 0.85, NAVY, 0xdfe6ee);
  b.box(-W / 2 - 0.02, 0.5, -L / 2 + 0.2, W / 2 + 0.02, 0.66, L * 0.3, 0xffffff); // white waterline band
  // cabin with tinted glass band and a push-bumper at the bow
  b.slab([-1.15, -1.8, 1.15, 0.9], [-0.95, -1.4, 0.95, 0.5], 0.85, 1.9, 0xffffff);
  b.box(-1.0, 1.25, -1.45, 1.0, 1.65, 0.5, GLASS);
  b.box(-0.2, 0.85, L / 2 - 0.9, 0.2, 1.05, L / 2 - 0.15, 0x0b1626);
  b.box(-0.7, 0.4, L / 2 - 0.55, 0.7, 0.62, L / 2 - 0.3, DARK); // push bumper
  // T-top radar arch with a spinning-dish stand-in and the (dark) light bar
  for (const x of [-0.9, 0.9]) b.box(x - 0.06, 1.9, -1.0, x + 0.06, 3.0, -0.88, DARK);
  b.box(-1.0, 3.0, -1.05, 1.0, 3.12, -0.3, DARK);
  b.box(-0.45, 3.12, -0.9, 0.45, 3.35, -0.5, 0xe8edf2);
  b.box(-0.9, 1.9, -0.25, 0.9, 2.05, 0.15, 0x1a1d24); // roof light bar body
  // twin outboards
  outboard(b, -0.7, -L / 2);
  outboard(b, 0.7, -L / 2);
  return b.build();
}

// Contraband buoy: safety-orange lattice buoy over an olive cargo case, a cyan beacon mast that reads from 400 m. Origin at the waterline.
export function buildBuoyGeometry() {
  const b = new MeshBuilder();
  b.slab([-0.9, -0.9, 0.9, 0.9], [-0.35, -0.35, 0.35, 0.35], 0, 1.1, 0xff7b00); // cone float
  b.slab([-0.35, -0.35, 0.35, 0.35], [-0.12, -0.12, 0.12, 0.12], 1.1, 1.7, 0xffb04d);
  for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) b.box(dx - 0.05, -1.0, dz - 0.05, dx + 0.05, 0.2, dz + 0.05, 0x3b3f47); // lattice legs
  b.box(-0.7, -1.3, -0.5, 0.7, -0.45, 0.5, 0x6b7a3a); // olive case hanging under it
  b.box(-0.72, -0.95, -0.52, 0.72, -0.85, 0.52, 0x2a2d33); // strap
  b.box(-0.09, 1.7, -0.09, 0.09, 9.5, 0.09, 0xf4f1ea); // mast
  for (const y of [2.6, 4.6, 6.6, 8.6]) b.box(-0.12, y, -0.12, 0.12, y + 0.7, 0.12, 0xff7b00); // safety-orange bands
  b.box(-0.4, 9.5, -0.4, 0.4, 10.4, 0.4, 0x9ff6ff); // beacon head
  return b.build();
}

// Mission marker: a faint open beam plus a bright ring, unit radius 1 (the instance matrix scales it to 1.8 m or 6 m).
export function buildMarkerGeometry() {
  const beam = new THREE.CylinderGeometry(1, 1, 30, 14, 1, true).translate(0, 15, 0);
  const ring = new THREE.TorusGeometry(1, 0.07, 6, 28).rotateX(Math.PI / 2).translate(0, 0.25, 0);
  const merged = new MeshBuilder();
  // beam is dim, ring is bright: the vertex colour carries the difference (instance colour tints both)
  merged.addGeometry(beam, 0x66aabb);
  merged.addGeometry(ring, 0xffffff);
  return merged.build();
}

// One foam piece: a flat, squashed diamond. Scaled per instance to read as a chevron arm or a droplet.
export function buildFoamGeometry() {
  const b = new MeshBuilder();
  const top = [0, 0.12, 0];
  b.tri([0, 0.12, 1], [0.5, 0, 0], [-0.5, 0, 0], 0xeef8ff);
  b.tri([0, 0.12, -1], [-0.5, 0, 0], [0.5, 0, 0], 0xeef8ff);
  b.tri([0.5, 0, 0], [0, 0.12, 1], top, 0xd6eefa);
  b.tri([-0.5, 0, 0], top, [0, 0.12, 1], 0xd6eefa);
  b.tri([0.5, 0, 0], top, [0, 0.12, -1], 0xd6eefa);
  b.tri([-0.5, 0, 0], [0, 0.12, -1], top, 0xd6eefa);
  return b.build();
}

// A small cube used for the patrol strobes.
export function buildStrobeGeometry() {
  const b = new MeshBuilder();
  b.box(-0.45, 0, -0.28, 0.45, 0.45, 0.28, 0xffffff);
  return b.build();
}
