// towShot: the ?shot=tow staging. A Marlin tows the grey stranded car down a straight road toward the orange drop-off ring; the green cable, the HUD line and the minimap marker are up.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };
const GAP = 7; // m between the cars along the road (a touch over the 6 m tow spacing)

export function stageTowShot(world, tow, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  // the junction closest to the middle of town, so the frame has buildings and traffic around it
  const a = tow.anchors.reduce((p, q) => (Math.hypot(q.x, q.z) < Math.hypot(p.x, p.z) ? q : p));
  const px = a.x + 4.3, pz = a.z + 30; // player car in the right-hand lane, facing -z (north)
  const car = world.vehicles.spawn('marlin', 0xf2b705, px, pz, Math.PI);
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);
  tow.forceTowing({ x: px, z: pz + GAP }, px, pz); // stranded car trailing directly behind the player
  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    tow.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }
  // The chase camera sits behind the player, i.e. on top of the towed car, so swing it round to the front-left (rig already in car mode) and hold it there: player car, cable and stranded car all sit in frame, seen from slightly above.
  world.rig.yawOffset = Math.PI - 0.55;
  world.rig.pitch = 0.3;
  world.rig.idle = -1e6; // stops the rig easing back to the chase view
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  tow.update(1 / 60, makeCtx());
}
