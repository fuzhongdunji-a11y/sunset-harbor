// rallyShot: the ?shot=rally staging. A Marlin waits on a straight road with the Checkpoint Rally forced into racing; the blue ring sits ~35 m ahead, with the HUD line and the minimap marker up.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };

export function stageRallyShot(world, checkpointRally, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  // choose an anchor near the center of town (similar to loopTourShot)
  const a = checkpointRally.anchors.reduce((p, q) => (Math.hypot(q.x, q.z) < Math.hypot(p.x, p.z) ? q : p));
  const px = a.x + 4.3, pz = a.z + 30; // player car in right‑hand lane, facing -z
  const car = world.vehicles.spawn('marlin', 0xf2b705, px, pz, Math.PI);
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);

  // force rally into racing with gate 1's arch + ring ~35m ahead
  checkpointRally.forceRally({ x: px, z: pz }, Math.PI);

  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    checkpointRally.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }

  // Camera framing: chase view behind the car, slightly rotated to include ring and HUD line
  world.rig.yawOffset = 0.5;
  world.rig.pitch = 0.3;
  world.rig.idle = -1e6; // stop easing back to chase view
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  checkpointRally.update(1 / 60, makeCtx());
}
