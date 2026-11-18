// shots: deterministic ?shot=start|drive|chase|walk|harbor|marina|people|intercept|armored|crest scenes for screenshots. Builds the situation, settles the simulation, then main.js renders once.
import { makeSpot } from './ambient/AmbientDirector.js';
import { TUNER_CURB, tunerFits, tunerGeometry } from './ambient/TunerBreakdownEvent.js';

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

  // Signal Intercept mid-job: a Vesper tails the black sedan down the x = 0 avenue about 30 m behind it, the cyan range cylinder and red inner ring around the quarry
  if (name === 'intercept') {
    const car = world.vehicles.spawn('vesper', 0x17a398, L.xs[4] - 4.5, -186, 0);
    car.vz = 12;
    car.speedF = 12;
    world.placeInCar(car);
    world.cash = 3850;
    world.rig.yaw = 0;
    for (const v of [...world.vehicles.list]) if (v.kind === 'parked' && v !== car && Math.abs(v.x) < 14 && v.z > -230 && v.z < -60) world.vehicles.remove(v);
    setMission(world, 8, 1);
    const ic = world.intercept;
    ic.start({ i: 4, j: 1, d: 2, along: 40 }); // 40 m south of the junction at z = -200, in the southbound lane
    world.district = L.districtAt(car.x, car.z); // no "entering" toast over the picture
    const T = world.traffic;
    const t1 = T.net.lanePoint(4, 2, 3, 40); // oncoming traffic in the other lane, 40 m north of the z = -120 junction
    T.spawnAt(4, 2, 3, t1.x, t1.z, 'pico');
    const P = world.peds.list;
    world.peds.placeBetween(P[0], { i: 4, j: 1, sx: -1, sz: 1 }, { i: 4, j: 2, sx: -1, sz: -1 }, 0.5);
    world.peds.placeBetween(P[1], { i: 4, j: 1, sx: 1, sz: 1 }, { i: 4, j: 2, sx: 1, sz: -1 }, 0.4);
    run(world, 24, KEYS('KeyW'), hud);
    ic.upload = 46; // mid-job readouts: upload past the 33 s mark, a little suspicion from sitting too close earlier
    ic.susp = 14;
    ic.peakSusp = 14;
    ic.timeLeft = 91;
    world.messages.length = 0;
    hud.toastQueue.length = 0;
    hud.toastTimer = 0;
    world.rig.snap(world.player, world.collision);
    run(world, 3, KEYS('KeyW'), hud);
    return;
  }

  // Armored Shakedown climax on the coast road: the truck sits smoking with its amber beacons flashing, one gold briefcase glows on the asphalt,
  // the player's coupe is parked at an angle behind them, three stars of police close in and townsfolk bolt off the sidewalk.
  if (name === 'armored') {
    const p = world.player;
    const T = world.traffic, P = world.police, H = world.armored;
    for (const v of [...world.vehicles.list]) if (v.kind === 'parked' && Math.abs(v.z - 280) < 25 && v.x > -60 && v.x < 150) world.vehicles.remove(v);
    world.cash = 6400;
    setMission(world, 9, 1);
    H.start({ i: 4, j: 7, d: 0, along: 66 });
    const tr = H.truck;
    tr.vx = tr.vz = tr.speedF = 0;
    H.drv.cruise = 0;
    H.armor = 0;
    H.fleeing = true;
    H.crossed = 3;
    H.released = 3;
    H.collected = 2;
    H.foot = 1;
    H.timeLeft = 71;
    H.cases.place(50.5, 276.4); // the last case, on the asphalt just ahead
    const car = world.vehicles.spawn('vesper', 0x17a398, 47, 272.6, Math.PI / 2 + 0.5);
    car.stolen = true;
    p.x = 40;
    p.z = 279.2;
    p.heading = Math.PI / 2 - 0.1;
    world.rig.yaw = Math.PI / 2 - 0.22;
    world.rig.pitch = 0.2;
    world.wanted.setHeat(5.8);
    world.wanted.peak = 3;
    // townsfolk caught on the sidewalk run for it along the shopfronts
    const peds = world.peds, ped = peds.list;
    const N1 = { i: 4, j: 7, sx: 1, sz: -1 }, N2 = { i: 5, j: 7, sx: -1, sz: -1 };
    [0, 1, 2, 5].forEach((k, n) => peds.placeBetween(ped[k], N1, N2, 0.42 + n * 0.1));
    peds.panic(70, 284, 40);
    for (const q of ped) if (q.state === 'flee') { q.fleeDx = 1; q.fleeDz = -0.05; q.timer = 6; }
    world.district = L.districtAt(p.x, p.z);
    run(world, 60, KEYS(), hud);
    // the cruisers arrive last (a few frames before the picture) so they are still strung out on the road beyond the truck
    for (const along of [62, 78, 96]) P.spawnAt(6, 7, 1, along);
    const t1 = T.net.lanePoint(6, 7, 1, 48);
    T.spawnAt(6, 7, 1, t1.x, t1.z, 'harborVan');
    world.wanted.evade = 0; // the cruisers are right there: the heat is not cooling down
    world.messages.length = 0;
    hud.toastQueue.length = 0;
    hud.toastTimer = 0;
    world.armoredPops.push('ON-FOOT GRAB!  +$250');
    world.rig.snap(p, world.collision);
    run(world, 6, KEYS(), hud);
    const pop = hud.el.amsPop; // freeze the floating text at its peak so the still frame shows it
    pop.style.animationPlayState = 'paused';
    pop.style.animationDelay = '-0.3s';
    return;
  }

  // Costa Sun-Crests: standing on the sand with a crest ahead; the 10th pickup (milestone) has just landed on the HUD, the rest of the gold shows on the minimap
  if (name === 'crest') {
    const list = world.crests.list;
    const beach = list.filter((c) => c.group === 'beach');
    const target = beach.reduce((a, b) => (Math.hypot(b.x + 40, b.z - 315) < Math.hypot(a.x + 40, a.z - 315) ? b : a));
    const near = list.filter((c) => c !== target && Math.hypot(c.x - target.x, c.z - target.z) < 90);
    const p = world.player;
    p.x = target.x + 7.5;
    p.z = target.z - 5.5;
    p.heading = Math.atan2(-7.5, 5.5);
    world.rig.yaw = p.heading - 0.5; // camera turned a little so the crest sits beside the player, not behind them
    world.rig.pitch = 0.16;
    world.cash = 6100;
    // nine crests already in the bag (not the ones in view), then the tenth
    const owned = list.filter((c) => c !== target && !near.includes(c)).slice(0, 9);
    for (const c of owned) world.crests.got.add(c.id);
    world.crests._collect(near[0] ?? list.find((c) => c !== target && !owned.includes(c)), world);
    world.crests.radius = 60; // wide enough for the shot's minimap to show the neighbours too
    run(world, 30, KEYS(), hud);
    world.rig.snap(p, world.collision);
    run(world, 2, KEYS(), hud);
    return;
  }

  // Roadside Tuner Breakdown on the coast road at golden hour: the open hood and steam plume, the cyan ring, the waving driver, the player on the sidewalk walking up to help.
  if (name === 'tuner') {
    const net = world.net, p = world.player, D = world.ambient;
    const j = net.zs.length - 1; // the coast road, one block inland from the beach
    let spot = null;
    for (const i of [3, 4, 2, 5]) {
      const s = makeSpot(net, i, j, 0, 44, TUNER_CURB); // eastbound, kerb on the south (beach) side, nose toward the camera
      if (tunerFits(world, s)) { spot = s; break; }
    }
    if (!spot) throw new Error('tuner shot: no free curb spot on the coast road');
    const g = tunerGeometry(spot);
    p.x = g.ring.x + g.fx * 2.6 + g.rx * 0.4; // 2.6 m from the ring, on the sidewalk ahead of the tuner's nose
    p.z = g.ring.z + g.fz * 2.6 + g.rz * 0.4;
    p.heading = Math.atan2(g.ring.x - p.x, g.ring.z - p.z);
    world.rig.yaw = p.heading;
    world.cash = 3850;
    world.district = L.districtAt(p.x, p.z);
    const ev = D.forceSpawn('TUNER', spot);
    ev.announced = true; // the caption is raised by hand at the end so it is still on screen in the picture
    run(world, 252, KEYS(), hud); // 4.2 s into the animation: the steam column is fully formed
    const T = world.traffic, ped = world.peds.list;
    for (const [k, i, along] of [[0, spot.i, 16], [1, spot.i - 1, 66]]) {
      const lp = net.lanePoint(i, j, 0, along, 4.5); // eastbound lane, 28 m and 58 m west of the tuner, driving toward us
      T.spawnAt(i, j, 0, lp.x, lp.z, k ? 'pico' : 'marlin');
    }
    world.peds.placeBetween(ped[0], { i: spot.i - 1, j, sx: 1, sz: -1 }, { i: spot.i, j, sx: -1, sz: -1 }, 0.55);
    world.peds.placeBetween(ped[1], { i: spot.i, j, sx: -1, sz: -1 }, { i: spot.i - 1, j, sx: 1, sz: -1 }, 0.62);
    run(world, 20, KEYS(), hud);
    world.messages.length = 0;
    hud.toastQueue.length = 0;
    hud.toastTimer = 0;
    world.ambientCaption = { text: '[AMBIENT] Stranded Street Tuner', t: 60 };
    run(world, 2, KEYS(), hud);
    // the exact framing from the design: low three-quarter view from the road, looking back at the open bay and the ring
    const cam = world.camera, car = ev.car, up = 1;
    cam.position.set(car.x + g.fx * 7.8 - g.rx * 4.6, car.y + 2.35 * up, car.z + g.fz * 7.8 - g.rz * 4.6);
    cam.fov = 48;
    cam.updateProjectionMatrix();
    cam.lookAt(car.x - g.fx * 0.4 + g.rx * 1.5, car.y + 1.3, car.z - g.fz * 0.4 + g.rz * 1.5); // aimed a little toward the sidewalk so the scene clears the minimap
    return;
  }

  if (name === 'chase') {
    // four stars: the player runs south down the x = 0 avenue with cruisers on the tail, looking back over the hood
    const car = world.vehicles.spawn('vesper', 0x17a398, L.xs[4] - 4.5, -168, 0);
    car.vz = 17;
    car.speedF = 17;
    world.placeInCar(car);
    world.cash = 3850;
    world.rig.yaw = 0;
    setMission(world, 3, 1);
    world.wanted.setHeat(8.6); // four stars: red/blue screen edge, pulsing stars, "police on you" meter
    for (const v of [...world.vehicles.list]) if (v.kind === 'parked' && Math.abs(v.x) < 10 && v.z > -230 && v.z < -120 && v !== car) world.vehicles.remove(v);
    const T = world.traffic, P = world.police;
    P.spawnAt(4, 1, 2, 20);
    P.spawnAt(4, 1, 2, 8);
    P.spawnAt(4, 1, 2, 36);
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
