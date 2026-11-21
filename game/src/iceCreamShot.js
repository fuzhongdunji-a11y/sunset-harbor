// iceCreamShot: the ?shot=icecream staging. Follows the buggyShot pattern but uses the IceCreamTruckService.
// The stage function hides the title, shows the HUD, spawns a suitable car at a junction near the town centre in the right-hand lane, places the player in it, sets world.cash to a fixed value, clears wanted if available, calls iceCream.forceIceCream() so the round is in SELLING with the pink stop ring ~35 m ahead, runs ~90 fixed updates, and frames the camera so the player car, the stop ring and the HUD ice‑cream line are visible.

const NO_MOUSE = { dx: 0, dy: 0 };
const NO_KEYS = { down: () => false, pressed: () => false };

export function stageIceCreamShot(world, iceCream, makeCtx, hud, ui) {
  ui.showTitle(false);
  hud.show(true);

  // Find a suitable junction near the town centre.
  const a = iceCream.anchors.reduce((p, q) => (
    Math.hypot(q.x, q.z) < Math.hypot(p.x, p.z) ? q : p
  ));
  const px = a.x + 4.3; // right-hand lane
  const pz = a.z + 30;  // ahead along -z
  const car = world.vehicles.spawn('marlin', 0xf2b705, px, pz, Math.PI);
  world.placeInCar(car);

  world.cash = 3850; // fixed starting cash
  if (world.wanted && typeof world.wanted.clear === 'function') {
    world.wanted.clear();
  }

  // Force the service into SELLING state with a stop ring ~35 m ahead.
  iceCream.forceIceCream({ x: px, z: pz }, Math.PI);

  for (let i = 0; i < 90; i++) {
    world.update(1 / 60, NO_KEYS, NO_MOUSE);
    iceCream.update(1 / 60, makeCtx());
    hud.update(1 / 60, world);
  }

  // Camera framing: chase view behind the car, slightly rotated to include ring and HUD line
  world.rig.yawOffset = 0.5;
  world.rig.pitch = 0.3;
  world.rig.idle = -1e6; // stop easing back to chase view
  world.rig.snap(world.player, world.collision);
  world.update(1 / 60, NO_KEYS, NO_MOUSE);
  iceCream.update(1 / 60, makeCtx());
}
