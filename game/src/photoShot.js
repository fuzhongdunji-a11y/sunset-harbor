// photoShot: the ?shot=photo staging. A Marlin idles beside the first photo ring of a Sunset Photo Tour, the tourist stands next to it holding the camera, the flash overlay is up and the tour HUD line and the minimap marker show the run in progress.
const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };
const APPROACH = 5; // m short of the spot centre (inside the 8 m shooting radius)
const FRAMES = 66; // 1.1 s of the 1.2 s shoot: the tourist is out, the photo is not yet taken

export function stagePhotoShot(world, photoTour, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;
  const spot = photoTour.spots[0];
  const car = world.vehicles.spawn('marlin', 0xf2b705, spot.x + 1.2, spot.z + APPROACH, Math.PI); // facing -z, toward the ring
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI;
  world.district = L.districtAt(car.x, car.z);
  photoTour.forceTour(0, 0); // tourist aboard, spot 1 active
  for (let i = 0; i < FRAMES; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    photoTour.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }
  // Frame it like the crest shot: turn the camera a little toward the tourist's side and hold it there (idle = -100 stops the rig easing back to the chase view), so car, tourist and ring all sit in frame.
  world.rig.yawOffset = -0.6;
  world.rig.pitch = 0.26;
  world.rig.idle = -100;
  world.rig.snap(world.player, world.collision);
  hud.flash(true); // frozen half-bright flash so the frame is deterministic
}
