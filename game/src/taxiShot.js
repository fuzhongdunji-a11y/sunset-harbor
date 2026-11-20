// taxiShot: the ?shot=taxi staging. A Marlin idles in the right-hand lane a few metres short of a lit Costa Cab stand, the yellow ring is up, the HUD line and the minimap marker show the open fare.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };
const APPROACH = 12; // m short of the stand centre (outside the 6 m pickup radius so the ring stays up)

export function stageTaxiShot(world, taxi, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  // the stand closest to the middle of town, so the frame has buildings and traffic around it
  const stand = taxi.stands.reduce((a, b) => (Math.hypot(b.x, b.z) < Math.hypot(a.x, a.z) ? b : a));
  const car = world.vehicles.spawn('marlin', 0xf2b705, stand.x + 4.3, stand.z + APPROACH, Math.PI); // facing -z, toward the stand
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);
  taxi.forceStand(stand);
  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    taxi.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  taxi.update(1 / 60, makeCtx());
}
