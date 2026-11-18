// shots: deterministic ?shot=start|drive|chase|walk|harbor|marina|people scenes for screenshots. Builds the situation, settles the simulation, then main.js renders once.
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
    // a street race in progress: gate 2 of the Costa Circuit straight ahead, clock running, sidewalks busy
    setMission(world, 6, 1);
    const gate = world.missions.mission.steps[1];
    gate.x = 0;
    gate.z = 20;
    world.missions.timeLeft = 47;
    const P = world.peds, ped = P.list;
    const W1 = { i: 4, j: 1, sx: -1, sz: 1 }, W2 = { i: 4, j: 2, sx: -1, sz: -1 };
    const E1 = { i: 4, j: 1, sx: 1, sz: 1 }, E2 = { i: 4, j: 2, sx: 1, sz: -1 };
    const E3 = { i: 4, j: 2, sx: 1, sz: 1 }, E4 = { i: 4, j: 3, sx: 1, sz: -1 };
    P.placeBetween(ped[3], W1, W2, 0.7); // walking pair (ped[4] follows)
    P.placeBetween(ped[0], E2, E1, 0.45); // jogger
    P.placeBetween(ped[1], E1, E2, 0.8);
    P.placeBetween(ped[5], W2, W1, 0.35);
    P.placeBetween(ped[2], E3, E4, 0.5);
    P.placeBetween(ped[6], E3, E4, 0.75);
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

  // on foot on the aisle under the container crane (harbor) or at the root of Lantern Pier (marina), looking south
  if (name === 'harbor' || name === 'marina') {
    const p = world.player;
    p.x = name === 'harbor' ? 178 : -110;
    p.z = name === 'harbor' ? 343 : 349;
    p.heading = 0;
    world.rig.yaw = name === 'harbor' ? 0.25 : 0.12;
    world.rig.pitch = 0.2;
    world.cash = 3850;
    run(world, 30, KEYS('KeyW'), hud);
    world.rig.snap(p, world.collision);
    run(world, 2, KEYS(), hud);
    return;
  }

  // a close-up of the townsfolk: the camera sits in front of the player, who sprints toward it
  if (name === 'people') {
    const p = world.player;
    p.x = 9.8;
    p.z = 1.0;
    p.heading = 0;
    world.rig.yaw = Math.PI + 0.3;
    world.rig.pitch = 0.12;
    const A = { i: 4, j: 3, sx: 1, sz: 1 }, B = { i: 4, j: 4, sx: 1, sz: -1 };
    for (const k of [0, 1, 2, 3, 5, 6]) world.peds.placeBetween(world.peds.list[k], k % 2 ? A : B, k % 2 ? B : A, 0.3 + k * 0.08);
    run(world, 30, KEYS('KeyW', 'ShiftLeft'), hud);
    world.rig.snap(p, world.collision);
    run(world, 2, KEYS('KeyW', 'ShiftLeft'), hud);
    return;
  }

  if (name === 'walk') {
    const p = world.player;
    p.x = 9.8;
    p.z = 1.0;
    p.heading = Math.PI;
    world.rig.yaw = Math.PI + 0.12;
    world.rig.pitch = 0.22;
    const A = { i: 4, j: 3, sx: 1, sz: 1 }, B = { i: 4, j: 4, sx: 1, sz: -1 }; // the sidewalk ahead of the player (camera looks south)
    const ped = world.peds.list;
    world.peds.placeBetween(ped[0], B, A, 0.5); // jogger coming toward us
    world.peds.placeBetween(ped[1], B, A, 0.88);
    world.peds.placeBetween(ped[2], B, A, 0.3);
    world.peds.placeBetween(ped[3], B, A, 0.7); // walking pair (ped[4] follows)
    world.peds.placeBetween(ped[5], A, B, 0.3);
    run(world, 44, KEYS('KeyW'), hud);
    world.rig.snap(p, world.collision);
    run(world, 2, KEYS('KeyW'), hud);
  }
}
