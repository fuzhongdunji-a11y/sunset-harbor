// shots: deterministic ?shot=start|drive|chase|walk scenes for screenshots. Builds the situation, settles the simulation, then main.js renders once.
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

// Jump the mission chain to a given job and step (for scenes that show a delivery in progress).
function setMission(world, index, step) {
  world.missions.begin(index);
  world.missions.stepIndex = step;
  world.missions._enterStep();
}

// Returns once the scene is ready to be rendered.
export function prepareShot(name, { world, hud, ui }) {
  if (name === 'start') {
    hud.show(false);
    ui.setSave({ cash: 3850, completed: 3 });
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
    world.cash = 3850;
    world.rig.yaw = 0;
    setMission(world, 3, 1);
    run(world, 140, KEYS('KeyW'), hud);
    return;
  }

  if (name === 'chase') {
    // three stars: the player runs south down the x = 0 avenue with cruisers on the tail, looking back over the hood
    const car = world.vehicles.spawn('vesper', 0x17a398, L.xs[4] - 4.5, -168, 0);
    car.vz = 17;
    car.speedF = 17;
    world.placeInCar(car);
    world.cash = 3850;
    world.rig.yaw = 0;
    setMission(world, 3, 1);
    world.wanted.setHeat(5.6);
    for (const v of [...world.vehicles.list]) if (v.kind === 'parked' && Math.abs(v.x) < 10 && v.z > -230 && v.z < -120 && v !== car) world.vehicles.remove(v);
    const T = world.traffic, P = world.police;
    P.spawnAt(4, 1, 2, 20);
    P.spawnAt(4, 1, 2, 8);
    P.spawnAt(3, 1, 0, 52); // from the cross street
    const t1 = T.net.lanePoint(4, 2, 3, 62);
    T.spawnAt(4, 2, 3, t1.x, t1.z, 'harborVan');
    const t2 = T.net.lanePoint(4, 2, 3, 30);
    T.spawnAt(4, 2, 3, t2.x, t2.z, 'pico');
    run(world, 60, KEYS(), hud);
    world.rig.yawOffset = Math.PI - 0.5; // look back over the tail (set after the rig has entered car mode)
    world.rig.idle = -1e6;
    world.rig.pitch = 0.2;
    world.rig.snap(world.player, world.collision);
    run(world, 2, KEYS(), hud);
    return;
  }

  if (name === 'walk') {
    const p = world.player;
    p.x = 9.8;
    p.z = 1.0;
    p.heading = Math.PI;
    world.rig.yaw = Math.PI + 0.12;
    world.rig.pitch = 0.22;
    const A = { i: 4, j: 3, sx: 1, sz: 1 }, B = { i: 4, j: 4, sx: 1, sz: -1 };
    const ped = world.peds.list;
    world.peds.placeBetween(ped[0], A, B, 0.25);
    world.peds.placeBetween(ped[1], B, A, 0.62);
    world.peds.placeBetween(ped[2], B, A, 0.7);
    run(world, 44, KEYS('KeyW'), hud);
    world.rig.snap(p, world.collision);
    run(world, 2, KEYS('KeyW'), hud);
  }
}
