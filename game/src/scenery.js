// scenery: palms, street lamps, beach umbrellas, piers, harbour containers, crane, boats, lighthouse and distant hills.
import * as THREE from '../vendor/three.module.min.js';
import { HEIGHTS } from './config.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeRng } from './rng.js';

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
  for (const boat of layout.boats) addBoat(b, boat);
  b.setTransform(null);

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(b.build(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  group.add(buildHills(rng));
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

function addBoat(b, boat) {
  b.setTransform(placement(boat.x, -0.15, boat.z, boat.rot));
  const L = boat.len / 2;
  b.slab([-0.9, -L * 0.7, 0.9, L * 0.7], [-1.6, -L, 1.6, L], -0.8, 0.9, { side: boat.color, top: 0xf4f1ea });
  b.box(-1.0, 0.9, -L * 0.3, 1.0, 2.2, L * 0.25, 0xf4f1ea);
  b.box(-1.05, 1.5, -L * 0.3 + 0.1, 1.05, 1.9, L * 0.25 - 0.1, 0x2c4a63);
  b.box(-0.05, 2.2, 0, 0.05, 5.2, 0.1, 0xdddddd);
  b.setTransform(null);
}

function buildHills(rng) {
  const b = new MeshBuilder();
  const tones = [0x86b59a, 0x93bfa3, 0x7aa992, 0xa2c8aa];
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
