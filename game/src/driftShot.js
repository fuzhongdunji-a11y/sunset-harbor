const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };

export function stageDriftShot(world, drift, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  const a = drift.anchors.reduce((p, q) => (Math.hypot(q.x, q.z) < Math.hypot(p.x, p.z) ? q : p));
  const px = a.x + 4.3, pz = a.z + 30; // player car in right‑hand lane, facing -z
  const car = world.vehicles.spawn('marlin', 0xf2b705, px, pz, Math.PI);
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);
  if (world.wanted && typeof world.wanted.clear === 'function') world.wanted.clear();

  drift.forceDrift({ x: px, z: pz }, Math.PI);

  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    drift.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }

  world.rig.yawOffset = 0.5;
  world.rig.pitch = 0.3;
  world.rig.idle = -1e6;
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  drift.update(1 / 60, makeCtx());
}
