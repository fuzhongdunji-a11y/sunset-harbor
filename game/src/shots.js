// shots: deterministic ?shot=start|drive|walk scenes for screenshots. Builds the situation, settles the simulation, then main.js renders once.
const KEYS = (...codes) => ({
  down: (...c) => c.some((k) => codes.includes(k)),
  pressed: () => false,
});
const NO_MOUSE = { dx: 0, dy: 0 };

function run(world, frames, input, hud) {
  for (let i = 0; i < frames; i++) {
    world.update(1 / 60, input, NO_MOUSE);
    if (hud) hud.update(1 / 60, world);
  }
}

// Returns once the scene is ready to be rendered.
export function prepareShot(name, { world, hud, ui }) {
  if (name === 'start') {
    hud.show(false);
    ui.showTitle(true);
    for (let i = 0; i < 30; i++) world.updateTitle(1 / 60, 24 + i / 60);
    return;
  }
  ui.showTitle(false);
  hud.show(true);
  const L = world.layout;

  if (name === 'drive') {
    const car = world.vehicles.spawn('vesper', 0x17a398, L.xs[4] - 4.3, -150, 0);
    car.vz = 24;
    world.placeInCar(car);
    world.wanted = 2;
    world.cash = 3850;
    world.rig.yaw = 0;
    run(world, 140, KEYS('KeyW'), hud);
    return;
  }

  if (name === 'walk') {
    const p = world.player;
    p.x = 9.8;
    p.z = 1.0;
    p.heading = Math.PI;
    world.rig.yaw = Math.PI + 0.12;
    world.rig.pitch = 0.22;
    world.wanted = 0;
    run(world, 44, KEYS('KeyW'), hud);
    world.rig.snap(p, world.collision);
    run(world, 2, KEYS('KeyW'), hud);
  }
}
