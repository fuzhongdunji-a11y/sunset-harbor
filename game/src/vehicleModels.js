// vehicleModels: the original Costa Serena car lineup (stats + low-poly mesh builders). Local +Z is the car's front.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';

export const CAR_TYPES = {
  marlin: { name: 'Marlin', body: 'sedan', len: 4.5, wid: 1.85, wheelbase: 2.7, maxSpeed: 41, accel: 17, brake: 32, maxReverse: 11, weight: 1 },
  pico: { name: 'Pico', body: 'hatch', len: 3.7, wid: 1.7, wheelbase: 2.3, maxSpeed: 35, accel: 15, brake: 28, maxReverse: 10, weight: 0.8 },
  vesper: { name: 'Vesper GT', body: 'coupe', len: 4.4, wid: 1.9, wheelbase: 2.6, maxSpeed: 52, accel: 24, brake: 38, maxReverse: 12, weight: 0.9 },
  dune: { name: 'Dune Pickup', body: 'pickup', len: 5.1, wid: 2.0, wheelbase: 3.1, maxSpeed: 37, accel: 14, brake: 28, maxReverse: 9, weight: 1.3 },
  patrol: { name: 'Harbor PD Cruiser', body: 'sedan', len: 4.7, wid: 1.9, wheelbase: 2.8, maxSpeed: 45, accel: 23, brake: 36, maxReverse: 11, weight: 1.1 },
  harborVan: { name: 'Harbor Van', body: 'van', len: 5.2, wid: 2.0, wheelbase: 3.2, maxSpeed: 33, accel: 12, brake: 26, maxReverse: 9, weight: 1.5 },
};

export const PAINTS = [0xe4572e, 0xf2a541, 0x17a398, 0x2e86ab, 0xf4f1ea, 0x1d2a44, 0xc1366b, 0x7bc47f, 0xcfd3d8, 0x6a4c93, 0xf6d55c];

const GLASS = 0x2c4c6a;
const GLINT = 0x9ccbe6; // sky reflection on the glass
const DARK = 0x1c1d20;
const CHROME = 0xd4d8de;
const WHEEL_R = 0.34;
// Light colours above 1.0 saturate to white-hot under the lighting rig, so lamps read as glowing without an extra draw call.
const HEAD = new THREE.Color(3.2, 3.0, 2.2);
const TAIL = new THREE.Color(2.6, 0.18, 0.12);
let wheelGeo = null;

function getWheelGeometry() {
  if (wheelGeo) return wheelGeo;
  const b = new MeshBuilder();
  b.addGeometry(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 10).rotateZ(Math.PI / 2), 0x16171a); // tyre
  b.addGeometry(new THREE.CylinderGeometry(WHEEL_R * 0.64, WHEEL_R * 0.64, 0.3, 8).rotateZ(Math.PI / 2), CHROME); // rim
  for (const sx of [-1, 1]) {
    const x = sx * 0.158;
    // hub cap and four crossing spoke bars, each a single flat quad on the rim face
    b.addGeometry(new THREE.CylinderGeometry(0.07, 0.07, 0.016, 6).rotateZ(Math.PI / 2).translate(x, 0, 0), 0x3b3f47);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      const c = Math.cos(a), s = Math.sin(a);
      const L = WHEEL_R * 0.6, hw = 0.02;
      b.quad([x + sx * 0.002, c * L - s * hw, s * L + c * hw], [x + sx * 0.002, c * L + s * hw, s * L - c * hw], [x + sx * 0.002, -c * L + s * hw, -s * L - c * hw], [x + sx * 0.002, -c * L - s * hw, -s * L + c * hw], 0x6b7078, [sx, 0, 0]);
    }
  }
  wheelGeo = b.build();
  return wheelGeo;
}

const bodyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const wheelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const lerp = (a, b, t) => a + (b - a) * t;

// A glazed cabin: frustum with glass sides, a painted roof, painted pillars and sky glints on the glass.
function cabin(b, bot, top, y0, y1, paint, { pillars = [0.5], glints = true } = {}) {
  b.slab(bot, top, y0, y1, { side: GLASS, top: paint });
  const O = 0.012;
  const P = (sx, u, v, off) => [
    sx * (sx > 0 ? lerp(bot[2], top[2], v) : -lerp(bot[0], top[0], v)) + sx * off,
    lerp(y0, y1, v),
    lerp(lerp(bot[1], bot[3], u), lerp(top[1], top[3], u), v),
  ];
  const side = (sx, u0, u1, v0, v1, color, off) => b.quad(P(sx, u0, v0, off), P(sx, u1, v0, off), P(sx, u1, v1, off), P(sx, u0, v1, off), color, [sx, 0, 0]);
  const face = (front, ux0, ux1, v0, v1, color) => {
    const zc = front ? 3 : 1;
    const Q = (ux, v) => [lerp(lerp(bot[0], bot[2], ux), lerp(top[0], top[2], ux), v), lerp(y0, y1, v), lerp(bot[zc], top[zc], v) + (front ? O : -O)];
    b.quad(Q(ux0, v0), Q(ux1, v0), Q(ux1, v1), Q(ux0, v1), color, [0, 0, front ? 1 : -1]);
  };
  for (const sx of [-1, 1]) {
    side(sx, 0, 1, 0, 0.1, paint, O); // sill under the glass
    side(sx, 0, 0.06, 0, 1, paint, O); // rear pillar
    side(sx, 0.93, 1, 0, 1, paint, O); // windscreen pillar
    for (const u of pillars) side(sx, u - 0.025, u + 0.025, 0, 1, paint, O);
    if (glints) {
      side(sx, 0.62, 0.7, 0.14, 0.9, GLINT, O * 0.6);
      side(sx, 0.72, 0.76, 0.14, 0.9, GLINT, O * 0.6);
    }
  }
  if (glints) {
    face(true, 0.12, 0.3, 0.2, 0.9, GLINT);
    face(true, 0.34, 0.4, 0.2, 0.9, GLINT);
  }
  face(true, 0, 0.05, 0, 1, paint);
  face(true, 0.95, 1, 0, 1, paint);
  face(false, 0, 0.05, 0, 1, paint);
  face(false, 0.95, 1, 0, 1, paint);
  face(false, 0.1, 0.9, 0, 0.12, paint);
}

// Returns {group, chassis, wheels:[{steer, spin, front}]}.
export function buildCarModel(typeKey, paint) {
  const t = CAR_TYPES[typeKey];
  const w = t.wid / 2;
  const L = t.len;
  const hl = L / 2;
  const b = new MeshBuilder();
  const body = { side: paint, top: paint };
  b.box(-w * 0.9, 0.22, -hl + 0.15, w * 0.9, 0.4, hl - 0.15, DARK); // underbody
  // decals lie on the sloped body side (half-width w at y = 0.32 narrowing to `taper` * w at the beltline)
  const beltY = t.body === 'van' ? 1.0 : t.body === 'pickup' ? 0.92 : t.body === 'coupe' ? 0.84 : t.body === 'hatch' ? 0.86 : 0.88;
  const sideX = (y) => w * (1 - 0.045 * Math.min(1, Math.max(0, (y - 0.32) / (beltY - 0.32)))) + 0.008;
  const decal = (sx, z0, z1, y0, y1, color) => b.quad([sx * sideX(y0), y0, z0], [sx * sideX(y0), y0, z1], [sx * sideX(y1), y1, z1], [sx * sideX(y1), y1, z0], color, [sx, 0, 0]);
  let doorZ = [0.0]; // door seams (z of each vertical line)
  switch (t.body) {
    case 'van': {
      b.slab([-w, -hl, w, 0.2 * L], [-w * 0.96, -hl + 0.05, w * 0.96, 0.2 * L], 0.32, 2.05, body);
      b.slab([-w * 0.98, 0.18 * L, w * 0.98, hl], [-w * 0.95, 0.2 * L, w * 0.95, hl - 0.06], 0.32, 1.0, body);
      cabin(b, [-w * 0.9, 0.12 * L, w * 0.9, 0.22 * L], [-w * 0.86, 0.05 * L, w * 0.86, 0.14 * L], 1.0, 1.95, paint, { pillars: [], glints: true });
      b.box(-w * 0.99, 1.15, -0.3 * L, -w * 0.97, 1.7, 0.02 * L, GLASS); // cargo-bay side windows
      b.box(w * 0.97, 1.15, -0.3 * L, w * 0.99, 1.7, 0.02 * L, GLASS);
      for (const sx of [-1, 1]) decal(sx, -hl + 0.3, 0.18 * L, 0.82, 0.96, 0xf4f1ea); // livery band
      b.box(-0.5, 2.05, -0.3 * L, 0.5, 2.12, -0.1 * L, 0xb9b4aa); // roof vent
      b.box(-w * 0.9, 1.0, -hl - 0.02, w * 0.9, 1.94, -hl + 0.02, DARK); // rear door seam panel
      doorZ = [0.2 * L, -0.08 * L];
      break;
    }
    case 'pickup': {
      b.slab([-w, -hl, w, hl], [-w * 0.96, -hl + 0.05, w * 0.96, hl - 0.06], 0.32, 0.92, body);
      cabin(b, [-w * 0.88, -0.1 * L, w * 0.88, 0.2 * L], [-w * 0.76, -0.04 * L, w * 0.76, 0.1 * L], 0.92, 1.58, paint);
      // open cargo bed: dark floor, low walls, tailgate and a roll bar behind the cab
      b.flat(-w * 0.92, -hl + 0.1, w * 0.92, -0.12 * L, 0.93, 0x2b2d31);
      for (const sx of [-1, 1]) b.box(sx * w * 0.93 - 0.05, 0.92, -hl + 0.04, sx * w * 0.93 + 0.05, 1.22, -0.12 * L, paint);
      b.box(-w * 0.95, 0.92, -hl, w * 0.95, 1.2, -hl + 0.09, paint); // tailgate
      b.box(-w * 0.92, 0.92, -0.14 * L, w * 0.92, 1.25, -0.12 * L, paint); // bulkhead
      b.box(-w * 0.8, 1.25, -0.145 * L, w * 0.8, 1.55, -0.135 * L, DARK); // headache rack
      doorZ = [0.05 * L];
      break;
    }
    case 'coupe': {
      b.slab([-w, -hl, w, hl], [-w * 0.95, -hl + 0.06, w * 0.95, hl - 0.1], 0.3, 0.84, body);
      cabin(b, [-w * 0.86, -0.3 * L, w * 0.86, 0.1 * L], [-w * 0.72, -0.22 * L, w * 0.72, -0.04 * L], 0.84, 1.36, paint, { pillars: [0.45] });
      b.box(-0.18, 1.365, -0.2 * L, 0.18, 1.375, -0.06 * L, 0xf4f1ea); // roof stripe
      b.box(-w * 0.6, 0.84, -hl + 0.05, w * 0.6, 1.0, -hl + 0.45, DARK); // spoiler
      b.box(-0.35, 0.84, 0.2 * L, 0.35, 0.89, 0.4 * L, DARK); // bonnet scoop
      doorZ = [-0.1 * L];
      break;
    }
    case 'hatch': {
      b.slab([-w, -hl, w, hl], [-w * 0.95, -hl + 0.05, w * 0.95, hl - 0.08], 0.32, 0.86, body);
      cabin(b, [-w * 0.86, -0.46 * L, w * 0.86, 0.14 * L], [-w * 0.76, -0.45 * L, w * 0.76, 0.0], 0.86, 1.5, paint, { pillars: [0.4, 0.7] });
      b.box(-w * 0.7, 1.5, -0.47 * L, w * 0.7, 1.56, -0.4 * L, DARK); // roof spoiler lip
      doorZ = [0.02 * L];
      break;
    }
    default: {
      b.slab([-w, -hl, w, hl], [-w * 0.95, -hl + 0.06, w * 0.95, hl - 0.08], 0.32, 0.88, body);
      cabin(b, [-w * 0.86, -0.3 * L, w * 0.86, 0.12 * L], [-w * 0.74, -0.22 * L, w * 0.74, 0.0], 0.88, 1.46, paint, { pillars: [0.48] });
      b.box(-0.3, 0.885, -hl + 0.3, 0.3, 0.9, -hl + 0.38, DARK); // boot seam
      doorZ = [-0.1 * L, 0.12 * L];
    }
  }
  const seamY = t.body === 'van' ? [0.4, 1.0] : [0.4, beltY - 0.02];
  for (const sx of [-1, 1]) {
    for (const z of doorZ) decal(sx, z - 0.015, z + 0.015, seamY[0], seamY[1], 0x15161a); // door seams
    for (const sz of [1, -1]) decal(sx, sz * (t.wheelbase / 2) - 0.46, sz * (t.wheelbase / 2) + 0.46, 0.3, 0.73, DARK); // wheel arches
  }
  if (typeKey === 'patrol') {
    for (const sx of [-1, 1]) decal(sx, -hl + 0.5, hl - 0.5, 0.42, 0.66, 0x1b3a6b); // navy door stripe
    b.box(-w * 0.55, 1.46, -0.7, w * 0.55, 1.54, -0.2, DARK); // light bar base
    b.box(-w * 0.7, 0.34, hl + 0.02, w * 0.7, 0.62, hl + 0.2, DARK); // push bar
    b.box(-w * 0.8, 0.9, hl - 0.85, w * 0.8, 0.905, hl - 0.15, 0x1b3a6b); // bonnet marking
  }
  b.box(-w * 0.98, 0.34, hl - 0.05, w * 0.98, 0.58, hl + 0.14, DARK); // front bumper
  b.box(-w * 0.98, 0.34, -hl - 0.14, w * 0.98, 0.58, -hl + 0.05, DARK); // rear bumper
  b.box(-w * 0.5, 0.4, hl - 0.02, w * 0.5, 0.56, hl + 0.16, 0x2b2d31); // grille
  b.quad([-w * 0.5, 0.48, hl + 0.161], [w * 0.5, 0.48, hl + 0.161], [w * 0.5, 0.5, hl + 0.161], [-w * 0.5, 0.5, hl + 0.161], CHROME, [0, 0, 1]); // grille bar
  b.quad([-0.26, 0.38, hl + 0.145], [0.26, 0.38, hl + 0.145], [0.26, 0.5, hl + 0.145], [-0.26, 0.5, hl + 0.145], 0xf4f1ea, [0, 0, 1]); // plates
  b.quad([-0.26, 0.38, -hl - 0.145], [0.26, 0.38, -hl - 0.145], [0.26, 0.5, -hl - 0.145], [-0.26, 0.5, -hl - 0.145], 0xf4f1ea, [0, 0, -1]);
  for (const s of [-1, 1]) {
    b.box(s * w * 0.78 - 0.21, 0.62, hl - 0.06, s * w * 0.78 + 0.21, 0.76, hl + 0.05, HEAD); // headlights
    b.box(s * w * 0.76 - 0.24, 0.66, -hl - 0.05, s * w * 0.76 + 0.24, 0.82, -hl + 0.06, TAIL); // tail lights
    const van = t.body === 'van';
    const mx = s * (w * (van ? 0.98 : 0.9) + 0.1);
    const mz = (van ? 0.2 : t.body === 'pickup' ? 0.16 : 0.11) * L;
    b.box(mx - 0.06, van ? 1.05 : 0.9, mz - 0.1, mx + 0.06, van ? 1.25 : 1.04, mz + 0.1, paint); // mirrors
  }

  const group = new THREE.Group();
  const chassis = new THREE.Group();
  const mesh = new THREE.Mesh(b.build(), bodyMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  chassis.add(mesh);
  group.add(chassis);

  let lights = null;
  if (typeKey === 'patrol') {
    lights = {};
    for (const [key, sx, color] of [['red', -1, 0xff2a2a], ['blue', 1, 0x2a6bff]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.12, 0.42), new THREE.MeshBasicMaterial({ color }));
      m.position.set(sx * w * 0.28, 1.6, -0.45);
      chassis.add(m);
      lights[key] = m;
    }
  }

  const wheels = [];
  const geo = getWheelGeometry();
  for (const sz of [1, -1]) {
    for (const sx of [1, -1]) {
      const steer = new THREE.Group();
      steer.position.set(sx * (w - 0.1), WHEEL_R, sz * (t.wheelbase / 2));
      const spin = new THREE.Mesh(geo, wheelMaterial);
      spin.castShadow = true;
      steer.add(spin);
      group.add(steer);
      wheels.push({ steer, spin, front: sz > 0 });
    }
  }
  return { group, chassis, wheels, wheelRadius: WHEEL_R, lights };
}
