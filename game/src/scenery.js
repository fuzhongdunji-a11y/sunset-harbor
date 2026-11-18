// scenery: palms, street lamps, beach umbrellas, piers, harbour containers, crane, boats, lighthouse and distant hills.
import * as THREE from '../vendor/three.module.min.js';
import { HEIGHTS } from './config.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeRng } from './rng.js';
import { buildSkyline } from './skyline.js';

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function placement(x, y, z, rot, scale = 1) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, rot), _s.set(scale, scale, scale));
}

export function buildScenery(layout) {
  const group = new THREE.Group();
  group.name = 'scenery';
  const b = new MeshBuilder();
  const rng = makeRng(layout.seed * 17 + 3);

  for (const p of layout.palms) addPalm(b, p, rng);
  b.setTransform(null);
  for (const l of layout.lamps) addLamp(b, l);
  for (const u of layout.umbrellas) addUmbrella(b, u);
  addLifeguardTower(b, 40, 322);
  addLifeguardTower(b, -210, 318);
  for (const d of layout.docks) addDock(b, d);
  addLighthouse(b, -110, 419, layout.docks[0].top);
  for (const c of layout.containers) addContainerStack(b, c, layout.docks[1].top);
  addCrane(b, layout);
  addOuterWharf(b, layout.docks[1].top);
  for (const boat of layout.boats) addBoat(b, boat);
  for (const wh of layout.warehouses) addWarehouse(b, wh, layout.docks[1].top);
  addDockLamps(b, layout);
  b.setTransform(null);

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  group.add(buildHills(rng));
  group.add(buildSkyline());
  return group;
}

function addPalm(b, p, rng) {
  b.setTransform(placement(p.x, HEIGHTS.sidewalk, p.z, p.rot, p.s));
  const segs = 5;
  const segH = 1.3;
  const lean = p.lean * 2.2;
  let prevX = 0;
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs, t1 = (k + 1) / segs;
    const x0 = lean * t0 * t0, x1 = lean * t1 * t1;
    const r0 = 0.3 - 0.13 * t0, r1 = 0.3 - 0.13 * t1;
    b.slab([x0 - r0, -r0, x0 + r0, r0], [x1 - r1, -r1, x1 + r1, r1], k * segH, (k + 1) * segH, k % 2 ? 0x7a5c3e : 0x8d6b48);
    prevX = x1;
  }
  const top = segs * segH;
  const greens = [0x3f9d4a, 0x2f8a55, 0x56b055];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3;
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = [prevX, top, 0];
    const mid = [prevX + dx * 1.7, top + 0.75, dz * 1.7];
    const tip = [prevX + dx * 3.5, top - 0.55, dz * 3.5];
    const sx = -dz * 0.55, sz = dx * 0.55;
    const ml = [mid[0] + sx, mid[1], mid[2] + sz];
    const mr = [mid[0] - sx, mid[1], mid[2] - sz];
    const c = greens[i % 3];
    b.tri(base, ml, mr, c);
    b.tri(ml, tip, mr, c);
  }
  b.box(prevX - 0.2, top - 0.35, -0.2, prevX + 0.2, top, 0.2, 0x6b4a2b); // coconut cluster
}

function addLamp(b, l) {
  const y0 = HEIGHTS.sidewalk;
  b.box(l.x - 0.09, y0, l.z - 0.09, l.x + 0.09, y0 + 6.2, l.z + 0.09, 0x3b3f47);
  const ax = l.x + l.dx * 1.5, az = l.z + l.dz * 1.5;
  b.box(Math.min(l.x, ax) - 0.06, y0 + 6.1, Math.min(l.z, az) - 0.06, Math.max(l.x, ax) + 0.06, y0 + 6.25, Math.max(l.z, az) + 0.06, 0x3b3f47);
  b.box(ax - 0.35, y0 + 5.98, az - 0.2, ax + 0.35, y0 + 6.1, az + 0.2, 0xfff0b0);
}

function addUmbrella(b, u) {
  b.setTransform(placement(u.x, 0, u.z, u.rot));
  b.box(-0.03, 0, -0.03, 0.03, 2.5, 0.03, 0xeeeeee);
  b.slab([-1.35, -1.35, 1.35, 1.35], [-0.12, -0.12, 0.12, 0.12], 2.0, 2.65, { side: u.color, top: u.color });
  b.box(-1.2, 0, 1.0, -0.5, 0.18, 2.9, 0xf4f1e6); // sun lounger
  b.setTransform(null);
}

function addLifeguardTower(b, x, z) {
  for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) b.box(x + dx - 0.08, 0, z + dz - 0.08, x + dx + 0.08, 2, z + dz + 0.08, 0xeeeeee);
  b.box(x - 1.3, 2, z - 1.3, x + 1.3, 2.15, z + 1.3, 0xe4572e);
  b.box(x - 1.1, 2.15, z - 1.1, x + 1.1, 3.4, z + 1.1, 0xfff1d0);
  b.slab([x - 1.5, z - 1.5, x + 1.5, z + 1.5], [x - 0.2, z - 0.2, x + 0.2, z + 0.2], 3.4, 4.1, 0xe4572e);
}

function addDock(b, d) {
  const dark = d.name.includes('Pier') ? 0x7a5c3e : 0x8f8b82;
  const top = d.name.includes('Pier') ? 0xa98a62 : 0xc5c1b6;
  b.box(d.x0, -1.2, d.z0, d.x1, d.top, d.z1, { side: dark, top });
  if (!d.name.includes('Pier')) {
    b.flat(d.x0 + 0.5, d.z1 - 1.0, d.x1 - 0.5, d.z1 - 0.8, d.top + 0.02, 0xf2c230);
  } else {
    for (let z = d.z0 + 4; z < d.z1; z += 6) b.box(d.x0 - 0.15, d.top, z, d.x0 + 0.1, d.top + 0.9, z + 0.25, 0x3b3f47); // railing posts
    for (let z = d.z0 + 4; z < d.z1; z += 6) b.box(d.x1 - 0.1, d.top, z, d.x1 + 0.15, d.top + 0.9, z + 0.25, 0x3b3f47);
    b.box(d.x0 - 0.1, d.top + 0.8, d.z0 + 4, d.x0 + 0.05, d.top + 0.9, d.z1, 0xeeeeee);
    b.box(d.x1 - 0.05, d.top + 0.8, d.z0 + 4, d.x1 + 0.1, d.top + 0.9, d.z1, 0xeeeeee);
  }
  for (let t = 0; t < 6; t++) { // bollards
    const z = d.z0 + 5 + t * ((d.z1 - d.z0 - 8) / 5);
    for (const x of [d.x0 + 0.4, d.x1 - 0.4]) b.box(x - 0.18, d.top, z - 0.18, x + 0.18, d.top + 0.45, z + 0.18, 0x2a2d33);
  }
}

function addLighthouse(b, x, z, y) {
  const bands = [0xf4f1ea, 0xd9392b, 0xf4f1ea, 0xd9392b];
  let r = 2.5;
  for (let k = 0; k < 4; k++) {
    const r1 = r - 0.28;
    b.slab([x - r, z - r, x + r, z + r], [x - r1, z - r1, x + r1, z + r1], y + k * 3.6, y + (k + 1) * 3.6, bands[k]);
    r = r1;
  }
  const top = y + 14.4;
  b.box(x - 1.5, top, z - 1.5, x + 1.5, top + 0.3, z + 1.5, 0x3b3f47);
  b.box(x - 1.05, top + 0.3, z - 1.05, x + 1.05, top + 1.9, z + 1.05, 0xfff3b0);
  b.slab([x - 1.6, z - 1.6, x + 1.6, z + 1.6], [x - 0.1, z - 0.1, x + 0.1, z + 0.1], top + 1.9, top + 3.1, 0xd9392b);
}

function addContainerStack(b, c, dockTop) {
  for (let s = 0; s < c.stack; s++) {
    const y0 = dockTop + s * 2.6;
    b.box(c.x0, y0, c.z0, c.x1, y0 + 2.6, c.z1, { side: c.color, top: 0x8a8d90 });
    b.box(c.x0 + 0.3, y0 + 0.15, c.z0 - 0.04, c.x1 - 0.3, y0 + 2.45, c.z0, 0x2a2d33); // door-end panel
  }
}

function addCrane(b, layout) {
  const top = layout.docks[1].top;
  for (const l of layout.craneLegs) b.box(l.x - 0.6, top, l.z - 0.6, l.x + 0.6, top + 24, l.z + 0.6, 0xe6a100);
  const y = top + 22;
  for (const x of [168, 188]) b.box(x - 0.7, y, 366, x + 0.7, y + 1.6, 392, 0xe6a100);
  for (const z of [366, 392]) b.box(168, y, z - 0.7, 188, y + 1.6, z + 0.7, 0xe6a100);
  b.box(176, y + 1.6, 380, 180, y + 4.5, 386, 0x3b3f47); // cab
  b.box(176.2, y, 392, 179.8, y + 1.2, 430, 0xe6a100); // boom over the water
  b.box(178.8, y - 6, 400, 179.2, y, 400.4, 0x3b3f47); // hanging cable
}

// Scenery-only outer wharf (outside the walkable bounds) carrying two ship-to-shore cranes, a stacked container block and a moored freighter hull.
function addOuterWharf(b, top) {
  b.box(268, -1.2, 345, 332, top, 404, { side: 0x8f8b82, top: 0xc5c1b6 });
  for (const x of [290, 316]) addQuayCrane(b, x, top);
  for (let x = 274; x < 326; x += 6.6) for (let s = 0; s < 3; s++) {
    if ((x * 7 + s * 3) % 5 === 0) continue;
    b.box(x, top + s * 2.6, 358, x + 6.1, top + s * 2.6 + 2.6, 360.5, { side: [0xc0392b, 0x2471a3, 0xd4ac0d, 0x1e8449][Math.floor(x / 6.6) % 4], top: 0x8a8d90 });
  }
  b.box(274, -3, 408, 328, 5, 428, { side: 0x3a4a63, top: 0x7a2f2a }); // freighter hull alongside
  b.box(274, 5, 408, 328, 5.6, 428, 0x9aa0a6);
  b.box(312, 5.6, 412, 326, 13, 424, 0xf1ece0); // bridge block
  b.box(312.5, 10, 411.9, 325.5, 11.6, 412.1, 0x2c4a63);
}

// Ship-to-shore gantry crane: a tall portal with a long boom raised over the water, so the harbour has a readable skyline.
function addQuayCrane(b, x, top) {
  const yel = 0xe6a100, grey = 0x3b3f47;
  const zl = 396.2, zs = 401.2; // land-side and sea-side leg lines
  const hgt = 34;
  for (const z of [zl, zs]) for (const dx of [-5.5, 5.5]) b.box(x + dx - 0.5, top, z - 0.5, x + dx + 0.5, top + hgt, z + 0.5, yel);
  for (const z of [zl, zs]) b.box(x - 6, top + hgt - 1.4, z - 0.6, x + 6, top + hgt, z + 0.6, yel); // portal beams
  for (const dx of [-5.5, 5.5]) b.box(x + dx - 0.35, top + hgt - 1.4, zl, x + dx + 0.35, top + hgt, zs, yel);
  for (const dx of [-5.5, 5.5]) b.box(x + dx - 0.2, top + 9, zl, x + dx + 0.2, top + 10, zs, yel); // cross brace
  b.box(x - 1.2, top + hgt, zl - 1, x + 1.2, top + hgt + 3, zs + 1, grey); // trolley house
  b.box(x - 1.0, top + hgt + 3, zl - 4, x + 1.0, top + hgt + 3.8, zl + 6, yel);
  b.box(x - 0.7, top + hgt + 0.2, zs, x + 0.7, top + hgt + 2.2, zs + 22, yel); // boom stretching out over the water
  b.box(x - 0.15, top + hgt - 5, zs + 16, x + 0.15, top + hgt, zs + 16.3, grey); // hanging line
  b.tri([x, top + hgt + 13, zl + 4], [x - 0.6, top + hgt + 3, zl - 1], [x + 0.6, top + hgt + 3, zl - 1], grey); // A-frame mast
  b.box(x - 0.1, top + hgt + 3, zl + 3.6, x + 0.1, top + hgt + 13, zl + 4.0, grey);
  b.box(x - 0.08, top + hgt + 2.2, zs + 20, x + 0.08, top + hgt + 12.6, zs + 20.16, grey); // forestay lines (thin masts read as lines)
  b.box(x - 0.4, top + hgt + 12.8, zl + 3.3, x + 0.4, top + hgt + 13.2, zl + 4.3, 0xd9392b); // red beacon
}

function addBoat(b, boat) {
  b.setTransform(placement(boat.x, -0.15, boat.z, boat.rot));
  const L = boat.len / 2;
  b.slab([-0.9, -L * 0.7, 0.9, L * 0.7], [-1.6, -L, 1.6, L], -0.8, 0.9, { side: boat.color, top: 0xf4f1ea });
  b.box(-1.62, 0.5, -L * 0.98, 1.62, 0.62, L * 0.98, 0xf4f1ea); // gunwale stripe
  if (boat.sail) {
    // sailboat: tall mast, boom, triangular main and fore sails, stay lines
    const mast = L * 1.15 + 3.5;
    b.box(-0.07, 0.9, L * 0.15 - 0.07, 0.07, 0.9 + mast, L * 0.15 + 0.07, 0xe8e8e8);
    b.box(-0.05, 1.7, -L * 0.7, 0.05, 1.85, L * 0.15, 0xe8e8e8); // boom
    b.tri([0, 1.9, L * 0.15 - 0.1], [0, 0.9 + mast - 0.2, L * 0.15 - 0.1], [0, 1.9, -L * 0.7], boat.sail);
    b.tri([0, 0.9 + mast - 0.2, L * 0.15 - 0.1], [0, 1.9, L * 0.15 - 0.1], [0, 1.9, -L * 0.7], boat.sail);
    b.tri([0, 1.6, L * 0.2], [0, 0.9 + mast - 0.8, L * 0.17], [0, 1.0, L * 0.95], 0xfff1d0);
    b.tri([0, 0.9 + mast - 0.8, L * 0.17], [0, 1.6, L * 0.2], [0, 1.0, L * 0.95], 0xfff1d0);
    b.box(-0.03, 0.9 + mast, L * 0.15 - 0.08, 0.03, 0.9 + mast + 0.3, L * 0.15 + 0.08, 0xd9392b); // masthead pennant
    b.box(-0.03, 0.9, L * 0.15 - 0.03, 0.03, 0.9 + mast, L * 0.15 + 0.03, 0xe8e8e8);
    b.box(-0.9, 0.9, -L * 0.5, 0.9, 1.35, -L * 0.1, 0xf4f1ea); // low cabin
    b.box(-0.92, 1.0, -L * 0.45, 0.92, 1.25, -L * 0.15, 0x2c4a63);
  } else {
    b.box(-1.0, 0.9, -L * 0.3, 1.0, 2.2, L * 0.25, 0xf4f1ea);
    b.box(-1.05, 1.5, -L * 0.3 + 0.1, 1.05, 1.9, L * 0.25 - 0.1, 0x2c4a63);
    b.box(-0.05, 2.2, 0, 0.05, 5.2, 0.1, 0xdddddd); // radio mast
    b.box(-0.3, 2.2, -0.12, 0.3, 2.28, 0.0, 0xdddddd);
  }
  b.setTransform(null);
}

// Corrugated-roof harbour shed: walls, gabled roof, roller doors, and a small office door.
function addWarehouse(b, wh, top) {
  const { x0, z0, x1, z1, h } = wh;
  const mid = (x0 + x1) / 2;
  b.box(x0, top, z0, x1, top + h, z1, { side: wh.color, top: wh.roof });
  // gabled roof: two sloped panels along x with a ridge, plus ribs for a corrugated look
  const ridge = top + h + 2.6;
  b.quad([x0 - 0.5, top + h, z0 - 0.6], [x1 + 0.5, top + h, z0 - 0.6], [x1 + 0.5, ridge, (z0 + z1) / 2], [x0 - 0.5, ridge, (z0 + z1) / 2], wh.roof, [0, 1, -0.5]);
  b.quad([x0 - 0.5, top + h, z1 + 0.6], [x1 + 0.5, top + h, z1 + 0.6], [x1 + 0.5, ridge, (z0 + z1) / 2], [x0 - 0.5, ridge, (z0 + z1) / 2], wh.roof, [0, 1, 0.5]);
  for (let x = x0; x < x1; x += 2) {
    b.box(x, top + h + 0.02, z0 - 0.62, x + 0.14, top + h + 0.1, z0 - 0.5, 0x3b3f47);
  }
  b.tri([x0 - 0.5, top + h, z0 - 0.02], [x0 - 0.5, top + h, z1 + 0.02], [x0 - 0.5, ridge, (z0 + z1) / 2], wh.color); // gable ends
  b.tri([x1 + 0.5, top + h, z1 + 0.02], [x1 + 0.5, top + h, z0 - 0.02], [x1 + 0.5, ridge, (z0 + z1) / 2], wh.color);
  b.box(mid - 0.25, ridge - 0.02, z0 - 0.2, mid + 0.25, ridge + 0.25, z1 + 0.2, 0x3b3f47); // ridge cap
  // roller doors on the land-facing wall, painted stripes along the base
  const n = Math.max(2, Math.floor((x1 - x0) / 13));
  for (let k = 0; k < n; k++) {
    const dx = x0 + ((k + 0.5) * (x1 - x0)) / n;
    b.box(dx - 2.2, top, z0 - 0.08, dx + 2.2, top + 4.2, z0 + 0.02, 0x6b7078);
    for (let y = top + 0.4; y < top + 4.2; y += 0.5) b.box(dx - 2.2, y, z0 - 0.1, dx + 2.2, y + 0.06, z0 - 0.06, 0x555a61);
    b.box(dx - 2.4, top + 4.2, z0 - 0.1, dx + 2.4, top + 4.45, z0 - 0.02, 0xf2c230); // warning lintel
  }
  b.box(x0, top, z0 - 0.04, x1, top + 0.5, z0 + 0.0, 0xf2c230);
  for (let x = x0 + 3; x < x1 - 2; x += 6) b.box(x - 0.8, top + h - 1.2, z0 - 0.05, x + 0.8, top + h - 0.6, z0 + 0.0, 0x2c4a63); // clerestory windows
}

// Tall lamp posts along the container yard and the pier so the harbour reads at a distance.
function addDockLamps(b, layout) {
  const lamps = [];
  const pier = layout.docks[0];
  for (let z = pier.z0 + 12; z < pier.z1 - 6; z += 20) lamps.push([pier.x0 + 0.3, z, pier.top], [pier.x1 - 0.3, z + 10, pier.top]);
  const yard = layout.docks[1];
  for (let x = yard.x0 + 8; x < yard.x1 - 4; x += 28) lamps.push([x, yard.z0 + 3, yard.top]);
  for (const [x, z, y] of lamps) {
    b.box(x - 0.07, y, z - 0.07, x + 0.07, y + 5.2, z + 0.07, 0x3b3f47);
    b.box(x - 0.45, y + 5.2, z - 0.2, x + 0.45, y + 5.35, z + 0.2, 0x3b3f47);
    b.box(x - 0.38, y + 5.08, z - 0.15, x + 0.38, y + 5.2, z + 0.15, 0xfff0b0);
  }
}

function buildHills(rng) {
  const b = new MeshBuilder();
  const tones = [0x8aa7a0, 0x9db4ad, 0x7f9c9c, 0xa9b7ae]; // sage fading to blue-grey; fog adds the peach haze
  for (let k = 0; k < 18; k++) {
    const a = Math.PI * (1.05 + (k / 17) * 0.9); // sweep across the northern horizon
    const r = rng.range(1100, 1500);
    const x = Math.cos(a) * r * 1.3, z = Math.sin(a) * r * 0.8 - 100;
    const w = rng.range(160, 320), h = rng.range(70, 190);
    b.slab([x - w, z - w, x + w, z + w], [x - w * 0.12, z - w * 0.1, x + w * 0.12, z + w * 0.1], -5, h, rng.pick(tones));
  }
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  return mesh;
}
