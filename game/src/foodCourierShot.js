// foodCourierShot: the ?shot=courier staging. A Marlin idles in the right-hand lane just short of a customer's teal-green ring with the bag aboard (2nd drop, a hot chain running); the customer is already stepping out to the car, the delivery HUD line and the minimap marker are up.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };
const APPROACH = 9; // m short of the customer centre (outside the 8 m drop radius so the ring stays up and nothing is paid yet)

export function stageCourierShot(world, courier, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  // the customer closest to the middle of town, so the frame has buildings and traffic around it; the restaurant is the site farthest from it
  const cust = courier.sites.reduce((a, b) => (Math.hypot(b.x, b.z) < Math.hypot(a.x, a.z) ? b : a));
  const rest = courier.sites.reduce((a, b) => (Math.hypot(b.x - cust.x, b.z - cust.z) > Math.hypot(a.x - cust.x, a.z - cust.z) ? b : a));
  const car = world.vehicles.spawn('marlin', 0xf2b705, cust.x + 4.3, cust.z + APPROACH, Math.PI); // facing -z, toward the customer
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);
  courier.forceLeg(rest, cust);
  courier.forcePickedUp(1, 1, 52); // one hot drop done, chain x1, plenty of freshness left
  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    courier.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  courier.update(1 / 60, makeCtx());
  courier.poseCustomer(world.player.px, world.player.pz, 0.7); // frozen mid-step, beside the car
}
