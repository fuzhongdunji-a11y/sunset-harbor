// customsShot: the deterministic ?shot=customs scene. A tuned coral Vesper GT rolls out of the open Solaris Customs bay with nitrous burning, spray mist behind it,
// the Export Slate mini car on the left, a cruiser, traffic and sidewalk walkers on the avenue, and the CLEARED banner up. Called by main.js.
import { OPPOSITE, DIRS, rightOf } from './roadNet.js';
import * as C from './customsCatalog.js';

const NO_MOUSE = { dx: 0, dy: 0 };
const KEYS = { down: () => false, pressed: () => false };
const FRAME = { f: 15, r: 6.5, up: 3.4, lf: -3.0, lr: 0.5, lup: 2.2, fov: 54 }; // reframed from the brief's (F 7.8, R 5.4, U 2.65, look F -2.2 / R -1.8 / U 1.15): that is too tight to hold the SOLARIS sign and the slate

export function stageCustomsShot(world, hud, ui) {
  const cu = world.customs, L = cu.L, net = world.net;
  ui.showTitle(false);
  hud.show(true);
  const F = { x: L.fx, z: L.fz }, R = { x: -L.fz, z: L.fx };

  // a clean frontage: no parked cars within 45 m
  for (const v of [...world.vehicles.list]) if (v.kind === 'parked' && !v.driver && Math.hypot(v.x - L.ax, v.z - L.az) < 45) world.vehicles.remove(v);

  // the street in front: node, direction of the lane next to the garage, and how far along it the garage mouth is
  const roadPt = { x: L.ax + F.x * 12.5, z: L.az + F.z * 12.5 };
  const [i0, j0] = net.nearestNode(roadPt.x, roadPt.z);
  let d = 0;
  for (let k = 0; k < 4; k++) { const r = rightOf(k); if (r.x * F.x + r.z * F.z < -0.9) d = k; }
  let node = [i0, j0], along = (roadPt.x - net.xs[i0]) * DIRS[d].x + (roadPt.z - net.zs[j0]) * DIRS[d].z;
  if (along < 24) { const prev = net.step(i0, j0, OPPOSITE[d]); if (prev) { node = prev; along += 80; } }
  const lane = (dd, a, n = node) => net.lanePoint(n[0], n[1], dd, a);

  // Export Board: a Solar Gold Kestrel on the slate (slot 2 of 6)
  cu.board.order[1] = 'tuner';
  cu.board.swatches[1] = 2;
  cu.board.idx = 1;
  cu._miniCar();
  cu._pips();
  cu.mini.rotation.y = 0.9;

  // the hero: coral Vesper, Neon Seafoam rims + GT kit, Stage 3 / Kevlar / Pro N2O, rolling out of the bay
  const px = L.ax + F.x * 2.6, pz = L.az + F.z * 2.6;
  const car = world.vehicles.spawn('vesper', 0xff5e5b, px, pz, L.h);
  car.applyCustom({ paint: 0, rim: 3, engine: 3, chassis: 2, n2o: 2 });
  car.custom.n2oCharge = 0.84;
  car.health = 100;
  car.speedF = 9.5;
  car.vx = F.x * 9.5;
  car.vz = F.z * 9.5;
  car.frozen = true; // pinned: the frame is staged, not simulated
  world.placeInCar(car);
  cu.shotFlame = car;
  cu.shotClosed = 1 - 3.8 / 4.1; // shutter edge at 3.8 m
  cu.shotMist = 0.8;
  cu.time = 5.0;
  cu.heatCd = 80;
  cu.banner = { text: 'CLEARED! SOLARIS HOT RESPRAY (-3★)', t: 1e6 };
  cu.firstUsed = true;
  cu.build = { type: 'vesper', paint: 0, rim: 3, engine: 3, chassis: 2, n2o: 2 };
  world.cash = 4850;
  world.wanted.clear();
  world.rig.yaw = L.h;

  // avenue life: a cruiser approaching in the near lane, an oncoming pair, walkers on the sidewalk in front
  world.police.spawnAt(node[0], node[1], d, along - 7, false);
  const o = net.step(node[0], node[1], d);
  if (o) {
    const n2 = o;
    for (const [a, type] of [[80 - along + 4, 'pico'], [80 - along + 30, 'harborVan']]) {
      const p = lane(OPPOSITE[d], a, n2);
      world.traffic.spawnAt(n2[0], n2[1], OPPOSITE[d], p.x, p.z, type);
    }
  }
  const t1 = lane(d, along - 20);
  world.traffic.spawnAt(node[0], node[1], d, t1.x, t1.z, 'marlin'); // near lane, ahead of the garage
  const b = cu.block, ped = world.peds.list;
  const cs = F.x !== 0
    ? [{ i: b.i + (F.x > 0 ? 1 : 0), j: b.j, sx: -F.x, sz: 1 }, { i: b.i + (F.x > 0 ? 1 : 0), j: b.j + 1, sx: -F.x, sz: -1 }]
    : [{ i: b.i, j: b.j + (F.z > 0 ? 1 : 0), sx: 1, sz: -F.z }, { i: b.i + 1, j: b.j + (F.z > 0 ? 1 : 0), sx: -1, sz: -F.z }];
  [[0.12, 0], [0.2, 1], [0.84, 0], [0.92, 1]].forEach(([t, dir], k) => world.peds.placeBetween(ped[k * 7 % 28 + 1], dir ? cs[1] : cs[0], dir ? cs[0] : cs[1], t));

  for (let k = 0; k < 12; k++) {
    world.update(1 / 60, KEYS, NO_MOUSE);
    hud.update(1 / 60, world);
  }
  world.messages.length = 0;
  hud.toastQueue.length = 0;
  hud.toastTimer = 0;
  world.wanted.clear(); // (a walker brushing the pinned car must not leave a star behind)
  cu.warn = null;
  car.speedF = 9.5;
  car.health = 100;
  car.custom.n2oCharge = 0.84;
  car.custom.isBoosting = true;

  // camera: the brief's P + F*7.8 + R*5.4 + U*2.65 looking at P - F*2.2 - R*1.8 + U*1.15, FOV 54
  const cam = world.camera;
  cam.position.set(car.x + F.x * FRAME.f + R.x * FRAME.r, car.y + FRAME.up, car.z + F.z * FRAME.f + R.z * FRAME.r);
  cam.fov = FRAME.fov;
  cam.updateProjectionMatrix();
  cam.lookAt(car.x + F.x * FRAME.lf + R.x * FRAME.lr, car.y + FRAME.lup, car.z + F.z * FRAME.lf + R.z * FRAME.lr);
  world.env.update(1 / 60, cam, world.focusPoint);
  cam.updateMatrixWorld(true); // so the HUD's slate label projects through this camera
  cu._fx(0);
  const still = document.createElement('style'); // freeze CSS pops/pulses so the HUD is identical on every load
  still.textContent = '*{animation:none!important;transition:none!important}';
  document.head.appendChild(still);
  void C;
}
