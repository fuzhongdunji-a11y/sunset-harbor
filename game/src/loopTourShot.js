// loopTourShot: the ?shot=loop staging. A Marlin waits on a straight road with the Loop Tour forced into leg 2; the pink checkpoint ring sits 40 m ahead, with the HUD line and the minimap marker up.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };
const RING_AHEAD = 22; // m from the player car to the checkpoint ring (north, along the road); close enough to sit in the chase frame

export function stageLoopTourShot(world, loopTour, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  // choose an anchor near the center of town (similar to towShot)
  const a = loopTour.anchors.reduce((p, q) => (Math.hypot(q.x, q.z) < Math.hypot(p.x, p.z) ? q : p));
  const px = a.x + 4.3, pz = a.z + 30; // player car in right‑hand lane, facing -z
  const car = world.vehicles.spawn('marlin', 0xf2b705, px, pz, Math.PI);
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);

  // force the tour to a mid‑leg state with the checkpoint ring ~40m ahead
  loopTour.forceTour({ x: px, z: pz - RING_AHEAD });

  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    loopTour.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }

  // Camera framing: chase view behind the car, slightly rotated to include ring and HUD line
  // (the ring is AHEAD, so unlike towShot keep the camera behind the car and swing it only to the rear-left; a front-left swing would look back and lose the ring)
  world.rig.yawOffset = 0.5;
  world.rig.pitch = 0.3;
  world.rig.idle = -1e6; // stop easing back to chase view
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  loopTour.update(1 / 60, makeCtx());
}
