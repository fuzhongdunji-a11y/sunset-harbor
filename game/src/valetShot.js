// valetShot: the ?shot=valet staging. A Marlin idles in the right-hand lane just short of a violet bay ring with one park already done (a guest's car is being returned to the lot); the guest figure is stepping away from the hotel toward the car, the valet HUD line and the minimap marker are up.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };
const APPROACH = 9; // m short of the bay centre (outside the 3 m park radius so the ring stays up and nothing is paid yet)

export function stageValetShot(world, valet, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  // the bay closest to the middle of town, so the frame has buildings and traffic around it; the hotel is the site farthest from it
  const bay = valet.sites.reduce((a, b) => (Math.hypot(b.x, b.z) < Math.hypot(a.x, a.z) ? b : a));
  const hotel = valet.sites.reduce((a, b) => (Math.hypot(b.x - bay.x, b.z - bay.z) > Math.hypot(a.x - bay.x, a.z - bay.z) ? b : a));
  const car = world.vehicles.spawn('marlin', 0xf2b705, bay.x + 4.3, bay.z + APPROACH, Math.PI); // facing -z, toward the bay
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);
  valet.forceLeg(hotel, bay);
  valet.forceToBay(1, 70); // one park done, plenty of leg time left
  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    valet.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  valet.update(1 / 60, makeCtx());
  valet.poseGuest(world.player.px, world.player.pz, 0.7); // frozen mid-step, beside the car
}
