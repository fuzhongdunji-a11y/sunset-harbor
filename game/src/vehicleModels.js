// vehicleModels: the original Costa Serena car lineup (stats + low-poly mesh builders). Local +Z is the car's front.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';

export const CAR_TYPES = {
  marlin: { name: 'Marlin', body: 'sedan', len: 4.5, wid: 1.85, wheelbase: 2.7, maxSpeed: 41, accel: 17, brake: 32, maxReverse: 11, weight: 1 },
  pico: { name: 'Pico', body: 'hatch', len: 3.7, wid: 1.7, wheelbase: 2.3, maxSpeed: 35, accel: 15, brake: 28, maxReverse: 10, weight: 0.8 },
  vesper: { name: 'Vesper GT', body: 'coupe', len: 4.4, wid: 1.9, wheelbase: 2.6, maxSpeed: 52, accel: 24, brake: 38, maxReverse: 12, weight: 0.9 },
  dune: { name: 'Dune Pickup', body: 'pickup', len: 5.1, wid: 2.0, wheelbase: 3.1, maxSpeed: 37, accel: 14, brake: 28, maxReverse: 9, weight: 1.3 },
  harborVan: { name: 'Harbor Van', body: 'van', len: 5.2, wid: 2.0, wheelbase: 3.2, maxSpeed: 33, accel: 12, brake: 26, maxReverse: 9, weight: 1.5 },
};

export const PAINTS = [0xe4572e, 0xf2a541, 0x17a398, 0x2e86ab, 0xf4f1ea, 0x1d2a44, 0xc1366b, 0x7bc47f, 0xcfd3d8, 0x6a4c93, 0xf6d55c];

const GLASS = 0x24384f;
const DARK = 0x1c1d20;
const WHEEL_R = 0.34;
let wheelGeo = null;

function getWheelGeometry() {
  if (wheelGeo) return wheelGeo;
  const b = new MeshBuilder();
  b.addGeometry(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 10).rotateZ(Math.PI / 2), DARK);
  b.addGeometry(new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.3, 8).rotateZ(Math.PI / 2), 0xc8ccd2);
  wheelGeo = b.build();
  return wheelGeo;
}

const bodyMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const wheelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

// Returns {group, chassis, wheels:[{steer, spin, front}]}.
export function buildCarModel(typeKey, paint) {
  const t = CAR_TYPES[typeKey];
  const w = t.wid / 2;
  const L = t.len;
  const hl = L / 2;
  const b = new MeshBuilder();
  const body = { side: paint, top: paint };
  b.box(-w * 0.9, 0.22, -hl + 0.15, w * 0.9, 0.4, hl - 0.15, DARK); // underbody
  switch (t.body) {
    case 'van': {
      b.slab([-w, -hl, w, 0.2 * L], [-w * 0.96, -hl + 0.05, w * 0.96, 0.2 * L], 0.32, 2.05, body);
      b.slab([-w * 0.98, 0.18 * L, w * 0.98, hl], [-w * 0.95, 0.2 * L, w * 0.95, hl - 0.06], 0.32, 1.0, body);
      b.slab([-w * 0.9, 0.12 * L, w * 0.9, 0.22 * L], [-w * 0.86, 0.05 * L, w * 0.86, 0.14 * L], 1.0, 1.95, { side: GLASS, top: paint });
      b.box(-w * 0.99, 1.15, -0.3 * L, -w * 0.97, 1.7, 0.02 * L, GLASS); // side windows
      b.box(w * 0.97, 1.15, -0.3 * L, w * 0.99, 1.7, 0.02 * L, GLASS);
      break;
    }
    case 'pickup': {
      b.slab([-w, -hl, w, hl], [-w * 0.96, -hl + 0.05, w * 0.96, hl - 0.06], 0.32, 0.92, body);
      b.slab([-w * 0.88, -0.1 * L, w * 0.88, 0.2 * L], [-w * 0.76, -0.04 * L, w * 0.76, 0.1 * L], 0.92, 1.58, { side: GLASS, top: paint });
      b.box(-w * 0.94, 0.92, -hl + 0.05, w * 0.94, 1.18, -0.14 * L, { side: paint, top: 0x2b2d31 });
      break;
    }
    case 'coupe': {
      b.slab([-w, -hl, w, hl], [-w * 0.95, -hl + 0.06, w * 0.95, hl - 0.1], 0.3, 0.84, body);
      b.slab([-w * 0.86, -0.3 * L, w * 0.86, 0.1 * L], [-w * 0.72, -0.22 * L, w * 0.72, -0.04 * L], 0.84, 1.36, { side: GLASS, top: paint });
      b.box(-0.18, 1.365, -0.2 * L, 0.18, 1.375, -0.06 * L, 0xf4f1ea); // roof stripe
      b.box(-w * 0.6, 0.84, -hl + 0.05, w * 0.6, 1.0, -hl + 0.45, DARK); // spoiler
      break;
    }
    case 'hatch': {
      b.slab([-w, -hl, w, hl], [-w * 0.95, -hl + 0.05, w * 0.95, hl - 0.08], 0.32, 0.86, body);
      b.slab([-w * 0.86, -0.42 * L, w * 0.86, 0.14 * L], [-w * 0.74, -0.38 * L, w * 0.74, 0.0], 0.86, 1.5, { side: GLASS, top: paint });
      break;
    }
    default: {
      b.slab([-w, -hl, w, hl], [-w * 0.95, -hl + 0.06, w * 0.95, hl - 0.08], 0.32, 0.88, body);
      b.slab([-w * 0.86, -0.3 * L, w * 0.86, 0.12 * L], [-w * 0.74, -0.22 * L, w * 0.74, 0.0], 0.88, 1.46, { side: GLASS, top: paint });
    }
  }
  b.box(-w * 0.98, 0.34, hl - 0.05, w * 0.98, 0.58, hl + 0.14, DARK); // front bumper
  b.box(-w * 0.98, 0.34, -hl - 0.14, w * 0.98, 0.58, -hl + 0.05, DARK); // rear bumper
  for (const s of [-1, 1]) {
    b.box(s * w * 0.78 - 0.2, 0.62, hl - 0.06, s * w * 0.78 + 0.2, 0.76, hl + 0.04, 0xfff3c0); // headlights
    b.box(s * w * 0.78 - 0.2, 0.66, -hl - 0.04, s * w * 0.78 + 0.2, 0.8, -hl + 0.06, 0xd43a2f); // tail lights
  }

  const group = new THREE.Group();
  const chassis = new THREE.Group();
  const mesh = new THREE.Mesh(b.build(), bodyMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  chassis.add(mesh);
  group.add(chassis);

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
  return { group, chassis, wheels, wheelRadius: WHEEL_R };
}
