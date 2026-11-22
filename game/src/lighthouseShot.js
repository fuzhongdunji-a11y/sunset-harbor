// lighthouseShot: the ?shot=lighthouse staging. Follows the pattern of fireWatchShot.
// The stage function hides the title, shows the HUD, spawns a suitable car at a junction near the town centre in the right-hand lane, places the player in it, sets world.cash to a fixed value, clears wanted if available, calls supply.forceSupply() so the round is HAULING with the pale-gold ring ~35 m ahead, runs ~90 fixed updates, and frames the camera in a three-quarter/chase view so the player car, the target ring/prop and the HUD lighthouse line are visible.

const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };

export function stageLighthouseShot(world, supply, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);

  const L = world.layout;
  // choose an anchor near the center of town
  const a = supply.anchors.reduce((p, q) => (
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

  // Force the service into HAULING state with a supply site ~35 m ahead.
  supply.forceSupply({ x: px, z: pz }, Math.PI);

  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    supply.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }

  // Camera framing: the car-mode chase rig sits only ~5.6 m behind a pivot 3 m ahead of the car, so the car fills and
  // crops the frame. Pose the camera by hand (as baggageShot): three-quarter from behind-right, raised and pulled back,
  // looking down the road so the whole car sits low-centre and the ring ~35 m ahead stays in view. The car heads -z
  // (h = PI): its right is +x, behind it is +z. Freeze the rig so later frames cannot pull the camera back.
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  supply.update(1 / 60, makeCtx());
  const cam = world.rig.camera;
  cam.position.set(px + 4.5, 4.6, pz + 11);
  cam.fov = 66;
  cam.updateProjectionMatrix();
  cam.lookAt(px - 0.5, 1.4, pz - 20);
  world.rig.update = () => {};
}
