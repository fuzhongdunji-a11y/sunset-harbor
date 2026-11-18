// customsModel: procedural geometry for the Solaris Customs lot, all in the lot's local frame (+Z = out of the bay toward the street, +X = left of that heading,
// origin = the bay's front line at ground level). Three pieces: the merged static garage (1 mesh), the roll-up shutter (1 mesh) and one additive "glow" mesh
// that carries the neon arch, pad beacons, LED pips, spray-mist cones and nitrous flames.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';

export const BAY = { w: 9.0, d: 10.5, wallH: 4.8, openW: 5.0, doorH: 4.1, center: -5.0 };
export const PAD = { x: -9.5, z: -3.0, w: 4.8, d: 7.5 }; // Export Crate Pad (centre, size)
export const RECALL = { x: -13.6, z: -5.0, w: 2.6, d: 5.2 }; // Recall Signature Ride stall
export const SLATE = { x: -5.9, z: -1.7, top: 3.15 }; // Export Slate; the mini car stands on its plinth

const CREAM = 0xf2e9dc, CORAL = 0xff5e5b, SEAFOAM = 0x00d2b8, YELLOW = 0xffc21a, NAVY = 0x141b2d, CONCRETE = 0xcfc6b8, FLOOR = 0x9a8f86;
const GLOW_TEAL = new THREE.Color(0.0, 2.3, 1.95); // above 1.0: reads as lit neon under the lighting rig
const GLOW_CORAL = new THREE.Color(2.4, 0.55, 0.45);

// Colliders in the lot frame: [x0, z0, x1, z1, height]
export const COLLIDERS = [
  [-4.5, -10.5, 4.5, -10.2, 4.8], // back wall
  [4.2, -10.5, 4.5, 0.0, 4.8], [-4.5, -10.5, -4.2, 0.0, 4.8], // side walls
  [2.5, -0.35, 4.5, 0.35, 4.8], [-4.5, -0.35, -2.5, 0.35, 4.8], // front pillars
  [-12.25, -9.6, -5.75, -6.8, 2.6], // export container
  [-7.0, -1.85, -4.8, -1.5, 3.2], // export slate board
];
export const SHUTTER_COLLIDER = [-2.5, -0.25, 2.5, 0.1, 4.1]; // active while the shutter is down

// SOLARIS in block letters: rectangles [x, y, w, h] in cells (3 wide, 5 tall).
const LETTERS = {
  S: [[0, 4, 3, 1], [0, 3, 1, 1], [0, 2, 3, 1], [2, 1, 1, 1], [0, 0, 3, 1]],
  O: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 4, 1, 1], [1, 0, 1, 1]],
  L: [[0, 0, 1, 5], [1, 0, 2, 1]],
  A: [[0, 0, 1, 4], [2, 0, 1, 4], [1, 4, 1, 1], [1, 2, 1, 1]],
  R: [[0, 0, 1, 5], [1, 4, 1, 1], [2, 3, 1, 1], [1, 2, 1, 1], [2, 0, 1, 2]],
  I: [[0, 0, 3, 1], [1, 1, 1, 3], [0, 4, 3, 1]],
};

function flatQuad(b, a, c, y, color) {
  b.flat(a[0], a[1], c[0], c[1], y, color);
}

export function buildStaticGeometry() {
  const b = new MeshBuilder();
  const W = BAY.w / 2, H = BAY.wallH;
  // ground: forecourt concrete, darker bay floor with a warm bounce tint toward the mouth
  b.flat(-15.5, -14, 4.5, 0.0, 0.04, CONCRETE);
  b.flat(-W, -BAY.d, W, 0.0, 0.06, FLOOR);
  b.flat(-W, -2.2, W, 0.0, 0.065, 0xb78d7f);
  b.flat(-0.12, -BAY.d, 0.12, 0.0, 0.07, YELLOW); // centre guide line
  // shell: back + side walls, roof slab, lintel, pillars, coral parapet, seafoam trim
  b.box(-W, 0, -BAY.d, W, H, -BAY.d + 0.3, CREAM);
  b.box(W - 0.3, 0, -BAY.d, W, H, 0, CREAM);
  b.box(-W, 0, -BAY.d, -W + 0.3, H, 0, CREAM);
  b.box(-W, 4.5, -BAY.d, W, H, 0, CREAM);
  b.box(-W, BAY.doorH, -0.35, W, H, 0.35, CREAM);
  for (const sx of [-1, 1]) {
    b.box(sx > 0 ? 2.5 : -W, 0, -0.35, sx > 0 ? W : -2.5, BAY.doorH, 0.35, CREAM);
    b.box(sx * 2.5 - (sx > 0 ? 0 : 0.12), 0, 0.35, sx * 2.5 + (sx > 0 ? 0.12 : 0), BAY.doorH, 0.43, SEAFOAM); // door-frame trim
  }
  b.box(-W - 0.2, H, 0.2, W + 0.2, H + 0.5, 0.6, CORAL); // front parapet
  b.box(-W - 0.2, H, -BAY.d, -W, H + 0.4, 0.2, CORAL);
  b.box(W, H, -BAY.d, W + 0.2, H + 0.4, 0.2, CORAL);
  b.box(-W, BAY.doorH, 0.35, W, BAY.doorH + 0.22, 0.45, SEAFOAM); // lintel trim
  b.box(-1.3, H + 0.5, 0.2, 1.3, H + 0.9, 0.55, SEAFOAM); // Art-Deco stepped crest
  b.box(-0.8, H + 0.9, 0.25, 0.8, H + 1.25, 0.5, CORAL);
  // SOLARIS: backing board + extruded letters (above the crest line, facing the street)
  const cell = 0.34, pitch = 3 * cell + 0.34, x0 = -(7 * 3 * cell + 6 * 0.34) / 2;
  const by = H + 0.9;
  b.box(x0 - 0.3, by, -0.5, -x0 + 0.3, by + 1.95, -0.2, NAVY);
  'SOLARIS'.split('').forEach((ch, k) => {
    for (const [rx, ry, rw, rh] of LETTERS[ch]) b.box(x0 + k * pitch + rx * cell, by + 0.14 + ry * cell, -0.2, x0 + k * pitch + (rx + rw) * cell, by + 0.14 + (ry + rh) * cell, 0.08, k % 2 ? GLOW_CORAL : GLOW_TEAL);
  });
  // interior: lifts, cabinets, tyre racks, hose reels
  for (const sx of [-1, 1]) {
    for (const z of [-6.2, -8.4]) {
      b.box(sx * 3.7 - 0.14, 0, z - 0.14, sx * 3.7 + 0.14, 3.2, z + 0.14, YELLOW);
      b.box(sx * 2.3, 0.45, z - 0.07, sx * 3.7, 0.55, z + 0.07, 0x3b3f47);
    }
  }
  b.box(-4.2, 0, -10.2, -2.4, 1.5, -9.5, CORAL);
  b.box(-4.2, 1.5, -10.2, -2.4, 1.58, -9.5, SEAFOAM);
  b.box(2.8, 0, -10.2, 4.2, 1.5, -9.5, SEAFOAM);
  for (let lv = 0; lv < 3; lv++) b.box(-1.6, lv * 0.62, -10.2, 0.2, lv * 0.62 + 0.55, -9.45, 0x1c1d20);
  b.box(1.0, 1.6, -10.2, 2.2, 2.4, -10.0, 0x3b3f47);
  b.box(1.35, 1.75, -10.0, 1.85, 2.25, -9.8, SEAFOAM);
  // export slate: posts, board, header band, plinth for the rotating mini car
  for (const x of [-6.75, -5.05]) b.box(x - 0.07, 0, SLATE.z - 0.07, x + 0.07, 1.0, SLATE.z + 0.07, 0x3b3f47);
  b.box(-7.0, 1.0, -1.85, -4.8, 3.0, -1.5, NAVY);
  b.box(-7.0, 2.62, -1.5, -4.8, 3.0, -1.46, CORAL);
  b.box(-6.5, 3.0, -2.05, -5.3, 3.15, -1.3, 0x3b3f47);
  // export pad: dark teal deck, yellow border and chevrons pointing into the container
  const px0 = PAD.x - PAD.w / 2, px1 = PAD.x + PAD.w / 2, pz0 = PAD.z - PAD.d / 2, pz1 = PAD.z + PAD.d / 2;
  b.flat(px0, pz0, px1, pz1, 0.08, 0x0f4c52);
  for (const [a, c] of [[[px0, pz0], [px1, pz0 + 0.2]], [[px0, pz1 - 0.2], [px1, pz1]], [[px0, pz0], [px0 + 0.2, pz1]], [[px1 - 0.2, pz0], [px1, pz1]]]) flatQuad(b, a, c, 0.09, YELLOW);
  for (let k = 0; k < 4; k++) {
    const z = pz1 - 1.2 - k * 1.55;
    for (const s of [-1, 1]) b.quad([PAD.x + s * 2.0, 0.095, z + 0.55], [PAD.x + s * 2.0, 0.095, z + 0.89], [PAD.x, 0.095, z - 0.16], [PAD.x, 0.095, z - 0.5], YELLOW, [0, 1, 0]);
  }
  for (const [cx, cz] of [[px0, pz0], [px1, pz0], [px0, pz1], [px1, pz1]]) b.box(cx - 0.08, 0, cz - 0.08, cx + 0.08, 1.2, cz + 0.08, 0x3b3f47);
  // container behind the pad: coral shell, rib quads on the face, seafoam doors
  b.box(-12.25, 0, -9.6, -5.75, 2.6, -6.8, CORAL);
  b.box(-12.25, 2.6, -9.6, -5.75, 2.68, -6.8, 0x8a2f2d);
  for (let k = 0; k < 12; k++) {
    const x = -12.1 + k * 0.52;
    b.quad([x, 0.15, -6.79], [x + 0.1, 0.15, -6.79], [x + 0.1, 2.45, -6.79], [x, 2.45, -6.79], 0xcf4a48, [0, 0, 1]);
  }
  b.box(-11.0, 0.1, -6.82, -7.0, 2.4, -6.78, SEAFOAM);
  b.quad([-9.05, 0.1, -6.77], [-8.95, 0.1, -6.77], [-8.95, 2.4, -6.77], [-9.05, 2.4, -6.77], 0x006e60, [0, 0, 1]);
  // recall stall: outline + chevron + bollard
  const rx0 = RECALL.x - RECALL.w / 2, rx1 = RECALL.x + RECALL.w / 2, rz0 = RECALL.z - RECALL.d / 2, rz1 = RECALL.z + RECALL.d / 2;
  b.flat(rx0, rz0, rx1, rz1, 0.075, 0x2a3b45);
  for (const [a, c] of [[[rx0, rz0], [rx1, rz0 + 0.12]], [[rx0, rz1 - 0.12], [rx1, rz1]], [[rx0, rz0], [rx0 + 0.12, rz1]], [[rx1 - 0.12, rz0], [rx1, rz1]]]) flatQuad(b, a, c, 0.085, SEAFOAM);
  b.quad([RECALL.x - 0.8, 0.09, rz0 + 1.4], [RECALL.x, 0.09, rz0 + 2.3], [RECALL.x + 0.8, 0.09, rz0 + 1.4], [RECALL.x, 0.09, rz0 + 1.9], CORAL, [0, 1, 0]);
  b.box(rx1 + 0.05 - 0.12, 0, rz1 - 0.2 - 0.12, rx1 + 0.05 + 0.12, 1.0, rz1 - 0.2 + 0.12, 0x1e293b);
  return b.build();
}

// Hanging shutter, origin at its top edge (y = 0 down to -doorH); scale.y shrinks it toward the top when it rolls up.
export function buildShutterGeometry() {
  const b = new MeshBuilder();
  const w = BAY.openW / 2, h = BAY.doorH;
  b.box(-w, -h, -0.12, w, 0, 0.04, 0xc9cdd2);
  for (let k = 0; k < 16; k++) b.quad([-w, -h + k * (h / 16) + 0.03, 0.045], [w, -h + k * (h / 16) + 0.03, 0.045], [w, -h + k * (h / 16) + 0.14, 0.045], [-w, -h + k * (h / 16) + 0.14, 0.045], 0xaeb4bb, [0, 0, 1]);
  for (let k = 0; k < 5; k++) {
    const x = -w + 0.3 + k * 1.0;
    b.quad([x, -h, 0.05], [x + 0.35, -h, 0.05], [x + 0.35 + 1.1, 0, 0.05], [x + 1.1, 0, 0.05], k % 2 ? 0xf4f1ea : CORAL, [0, 0, 1]);
  }
  return b.build();
}

// ---- glow mesh (additive): static neon first, then recolourable parts, then the dynamic cones. `fx.part(name)` gives {start, count} in vertices.
const SEG = 8, FSEG = 6;
export function buildGlow() {
  const b = new MeshBuilder();
  const parts = {};
  const mark = (name, fn) => {
    const start = b.pos.length / 3;
    fn();
    parts[name] = { start, count: b.pos.length / 3 - start };
  };
  mark('arch', () => {
    const w = BAY.openW / 2 + 0.05;
    b.box(w, 0.05, 0.43, w + 0.12, BAY.doorH, 0.55, GLOW_CORAL);
    b.box(-w - 0.12, 0.05, 0.43, -w, BAY.doorH, 0.55, GLOW_TEAL);
    b.box(-w - 0.12, BAY.doorH - 0.12, 0.43, w + 0.12, BAY.doorH, 0.55, GLOW_TEAL);
    b.box(-w - 0.12, BAY.doorH + 0.32, 0.5, w + 0.12, BAY.doorH + 0.4, 0.58, GLOW_CORAL);
    b.box(-BAY.w / 2 - 0.2, BAY.wallH + 0.5, 0.58, BAY.w / 2 + 0.2, BAY.wallH + 0.56, 0.64, GLOW_TEAL); // parapet edge
  });
  mark('beacons', () => {
    const px0 = PAD.x - PAD.w / 2, px1 = PAD.x + PAD.w / 2, pz0 = PAD.z - PAD.d / 2, pz1 = PAD.z + PAD.d / 2;
    for (const [cx, cz] of [[px0, pz0], [px1, pz0], [px0, pz1], [px1, pz1]]) b.box(cx - 0.13, 1.2, cz - 0.13, cx + 0.13, 1.45, cz + 0.13, GLOW_TEAL);
  });
  for (let i = 0; i < 6; i++) mark(`pip${i}`, () => b.box(-6.85 + i * 0.34, 1.35, -1.49, -6.85 + i * 0.34 + 0.22, 1.7, -1.46, 0x203040));
  mark('slateBar', () => b.box(-6.9, 2.0, -1.49, -4.9, 2.3, -1.46, 0x203040));
  mark('flash', () => b.quad([-11.0, 0.1, -6.7], [-7.0, 0.1, -6.7], [-7.0, 2.4, -6.7], [-11.0, 2.4, -6.7], 0x000000, [0, 0, 1]));
  mark('strobe', () => {
    b.box(-1.5, BAY.wallH + 0.1, 0.62, -0.9, BAY.wallH + 0.5, 0.9, 0x000000);
    b.box(0.9, BAY.wallH + 0.1, 0.62, 1.5, BAY.wallH + 0.5, 0.9, 0x000000);
  });
  mark('recallCap', () => b.box(RECALL.x + RECALL.w / 2 - 0.2, 1.0, RECALL.z + RECALL.d / 2 - 0.32, RECALL.x + RECALL.w / 2 + 0.1, 1.12, RECALL.z + RECALL.d / 2 - 0.08, GLOW_TEAL));
  const fixed = b.pos.length / 3;
  const dyn = 2 * SEG * 3 + 2 * FSEG * 3; // two mist cones + two flame cones
  const pos = new Float32Array((fixed + dyn) * 3);
  pos.set(b.pos);
  const col = new Float32Array((fixed + dyn) * 3);
  col.set(b.col);
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3), ca = new THREE.BufferAttribute(col, 3);
  pa.setUsage(THREE.DynamicDrawUsage);
  ca.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa);
  geo.setAttribute('color', ca);
  const dynStart = fixed;
  parts.mist0 = { start: dynStart, count: SEG * 3 };
  parts.mist1 = { start: dynStart + SEG * 3, count: SEG * 3 };
  parts.flame0 = { start: dynStart + 2 * SEG * 3, count: FSEG * 3 };
  parts.flame1 = { start: dynStart + 2 * SEG * 3 + FSEG * 3, count: FSEG * 3 };
  const setColor = (name, r, g, bl) => {
    const p = parts[name];
    for (let i = 0; i < p.count; i++) ca.setXYZ(p.start + i, r, g, bl);
    ca.needsUpdate = true;
  };
  // cone from `apex` along unit `d` for `len` with base radius `rad`; apex vertices take colour `ac`, ring vertices `rc`
  const cone = (name, seg, ax, ay, az, dx, dy, dz, len, rad, ac, rc) => {
    const p = parts[name];
    let ux = dy * 0 - dz * 1, uy = dz * 0 - dx * 0, uz = dx * 1 - dy * 0; // d x up(0,1,0)
    if (Math.hypot(ux, uy, uz) < 1e-4) { ux = 1; uy = 0; uz = 0; }
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const cx = ax + dx * len, cy = ay + dy * len, cz = az + dz * len;
    const ring = (i) => {
      const t = (i / seg) * Math.PI * 2, c = Math.cos(t) * rad, s = Math.sin(t) * rad;
      return [cx + ux * c + vx * s, cy + uy * c + vy * s, cz + uz * c + vz * s];
    };
    for (let i = 0; i < seg; i++) {
      const r0 = ring(i), r1 = ring(i + 1);
      const o = p.start + i * 3;
      pa.setXYZ(o, ax, ay, az);
      pa.setXYZ(o + 1, r0[0], r0[1], r0[2]);
      pa.setXYZ(o + 2, r1[0], r1[1], r1[2]);
      ca.setXYZ(o, ac[0], ac[1], ac[2]);
      ca.setXYZ(o + 1, rc[0], rc[1], rc[2]);
      ca.setXYZ(o + 2, rc[0], rc[1], rc[2]);
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
  };
  return { geo, parts, setColor, cone, SEG, FSEG };
}
