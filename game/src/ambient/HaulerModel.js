// HaulerModel: the Sky-Ad Stunt Hauler's truck. A safety-yellow cab at the front, a 22 degree ramp bed lowered to the asphalt behind it, and the scrolling
// green chevron deck. Exports the ramp dimensions (truck-local metres, +Z forward) that the event's launch physics reads, and the model builder that
// vehicleModels.js calls for body type 'hauler'.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from '../meshBuilder.js';

const DEG = Math.PI / 180;
export const RAMP_ANGLE = 22 * DEG;
export const RAMP_LEN = 7.2;
export const RAMP_WID = 3.2;
export const RAMP_REAR_Z = -4.75; // foot of the ramp, on the asphalt (the truck is 9.5 m long)
export const RAMP_FOOT_Y = 0.05;
export const RAMP_LIP_Z = RAMP_REAR_Z + RAMP_LEN * Math.cos(RAMP_ANGLE); // top edge of the deck
export const RAMP_LIP_Y = RAMP_FOOT_Y + RAMP_LEN * Math.sin(RAMP_ANGLE); // 2.75 m above the road
export const TRUCK_WHEEL_SCALE = 1.35;

const YELLOW = 0xffcc00;
const DARK = 0x222228;
const GLASS = 0x18202c;
const STROBE = new THREE.Color(3.0, 1.9, 0.2); // above 1.0: reads as a lit lamp
const HEAD = new THREE.Color(3.2, 3.0, 2.2);

// Height of the deck surface above the road at a truck-local z (clamped to the ramp's extent).
export function rampHeightAt(z) {
  const u = Math.min(RAMP_LIP_Z, Math.max(RAMP_REAR_Z, z));
  return RAMP_FOOT_Y + (u - RAMP_REAR_Z) * Math.tan(RAMP_ANGLE);
}

// A box tilted to lie along the ramp: centre at truck-local (0, y, z) before tilting along the deck line.
function onDeck(geo, lateral, lift) {
  const mid = (RAMP_REAR_Z + RAMP_LIP_Z) / 2;
  const n = new THREE.Vector3(0, Math.cos(RAMP_ANGLE), -Math.sin(RAMP_ANGLE)); // deck normal
  geo.rotateX(-RAMP_ANGLE);
  geo.translate(lateral, rampHeightAt(mid) + n.y * lift, mid + n.z * lift);
  return geo;
}

// The chevron plane lies 2 cm above the deck; its texture is scrolled by the event. Returns the mesh (a child of the chassis).
export function buildChevronPlane(texture) {
  const geo = new THREE.PlaneGeometry(2.4, 6.6).rotateX(-Math.PI / 2).rotateY(Math.PI); // texture 'up' runs toward the lip
  onDeck(geo, 0, 0.02);
  const mat = new THREE.MeshBasicMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'haulerChevrons';
  return mesh;
}

// deps: {wheelGeo, wheelMat, bodyMat, wheelR} from vehicleModels.js (kept as arguments so the two files do not import each other).
export function buildHaulerModel(t, deps) {
  const w = t.wid / 2;
  const hl = t.len / 2;
  const b = new MeshBuilder();

  // frame rails and the yellow cab with its dark windscreen, side glass, bumper and roof strobes
  b.box(-1.0, 0.3, -1.0, 1.0, 0.55, hl - 0.3, DARK);
  b.box(-1.4, 0.55, 2.35, 1.4, 1.55, hl, YELLOW);
  b.box(-1.35, 1.55, 2.35, 1.35, 2.8, 4.1, YELLOW);
  b.box(-1.15, 1.68, 4.06, 1.15, 2.6, 4.12, GLASS);
  for (const sx of [-1, 1]) {
    b.box(sx * 1.34 - 0.03, 1.72, 2.7, sx * 1.34 + 0.03, 2.6, 3.9, GLASS);
    b.box(sx * 0.8 - 0.18, 2.8, 3.1, sx * 0.8 + 0.18, 3.02, 3.4, STROBE);
    b.box(sx * 1.0 - 0.3, 0.68, hl - 0.04, sx * 1.0 + 0.3, 0.9, hl + 0.06, HEAD);
    b.box(sx * 1.46 - 0.05, 0.6, 2.9, sx * 1.46 + 0.05, 1.5, 3.1, DARK); // door seam
  }
  b.box(-1.5, 0.35, hl, 1.5, 0.7, hl + 0.2, DARK); // bumper
  b.box(-0.2, 2.8, 2.55, 0.2, 3.05, 2.85, DARK); // winch the tether hangs from

  // hazard-banded block behind the cab: the step the car leaves from, level with the lip
  b.box(-RAMP_WID / 2, 0.3, RAMP_LIP_Z, RAMP_WID / 2, RAMP_LIP_Y, 2.33, DARK);
  b.box(-RAMP_WID / 2, RAMP_LIP_Y - 0.12, RAMP_LIP_Z, RAMP_WID / 2, RAMP_LIP_Y, 2.33, YELLOW);

  // ramp deck (charcoal), side rails, and struts down to the frame
  b.addGeometry(onDeck(new THREE.BoxGeometry(RAMP_WID, 0.25, RAMP_LEN), 0, -0.125), 0x2b2d33);
  for (const sx of [-1, 1]) {
    b.addGeometry(onDeck(new THREE.BoxGeometry(0.25, 0.25, RAMP_LEN), sx * (RAMP_WID / 2 - 0.125), 0.125), DARK);
    for (const z of [-3.6, -2.2, -0.8, 0.5]) {
      const top = rampHeightAt(z) - 0.2;
      b.box(sx * (RAMP_WID / 2 - 0.2) - 0.07, 0.08, z - 0.07, sx * (RAMP_WID / 2 - 0.2) + 0.07, top, z + 0.07, DARK);
    }
  }

  const group = new THREE.Group();
  const chassis = new THREE.Group();
  const mesh = new THREE.Mesh(b.build(), deps.bodyMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  chassis.add(mesh);
  group.add(chassis);

  const wheels = [];
  const r = deps.wheelR * TRUCK_WHEEL_SCALE;
  for (const sz of [1, -1]) {
    for (const sx of [1, -1]) {
      const steer = new THREE.Group();
      steer.position.set(sx * w, r, sz * (t.wheelbase / 2));
      const spin = new THREE.Mesh(deps.wheelGeo, deps.wheelMat);
      spin.scale.setScalar(TRUCK_WHEEL_SCALE);
      spin.castShadow = true;
      steer.add(spin);
      group.add(steer);
      wheels.push({ steer, spin, front: sz > 0 });
    }
  }
  return { group, chassis, wheels, wheelRadius: r, lights: null };
}
