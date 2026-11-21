// baggageShot: the ?shot=baggage staging. Follows the buggyShot pattern but uses the BaggageTrainService.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };

export function stageBaggageShot(world, baggage, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);

  const L = world.layout;
  // choose an anchor near the center of town
  const a = baggage.anchors.reduce((p, q) => (
    Math.hypot(q.x, q.z) < Math.hypot(p.x, p.z) ? q : p
  ));
  const px = a.x + 4.3; // right-hand lane
  const pz = a.z + 30;  // ahead along -z
  const car = world.vehicles.spawn('marlin', 0xf2b705, px, pz, Math.PI);
  world.placeInCar(car);

  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);
  if (world.wanted && typeof world.wanted.clear === 'function') {
    world.wanted.clear();
  }

  // Force the service into HAULING state with a sky‑blue ring ~35 m ahead.
  baggage.forceBaggage({ x: px, z: pz }, Math.PI);

  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    baggage.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }

  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  baggage.update(1 / 60, makeCtx());

  // Camera framing: the car-mode chase rig is fixed ~5.6 m behind a pivot 3 m ahead of the car, i.e. right on top of the cart
  // coupled ~5 m behind it. Pose the camera by hand instead: look FORWARD along the heading (as quarryShot), but sit far back
  // (16 m behind the car, 11 m behind the cart) and high (5.5 m) with only a slight right offset, so the cart is in the
  // foreground, the car just ahead of it, and the ring 35 m ahead stays near the frame centre. Freeze the rig so later frames
  // cannot pull it back. The car heads -z (h = PI): its right is +x, behind it is +z.
  const cam = world.rig.camera;
  cam.position.set(px + 2.5, 5.5, pz + 16);
  cam.fov = 66;
  cam.updateProjectionMatrix();
  cam.lookAt(px - 0.3, 1.6, pz - 25); // slight downward pitch: cart + car in the lower half, the ring near the centre
  world.rig.update = () => {};
}
