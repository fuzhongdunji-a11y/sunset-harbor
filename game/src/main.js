// main: thin bootstrap. Creates the renderer, wires input/UI/HUD to the World and runs the frame loop (or a single ?shot= frame).
import * as THREE from '../vendor/three.module.min.js';
import { World } from './world.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Ui } from './ui.js';
import { prepareShot } from './shots.js';
import { loadSave, writeSave, clearSave } from './save.js';
import { GameAudio } from './audio.js';
import { startBench } from './bench.js';
import { R_NEAR, R_FAR } from './signalIntercept.js';
import { AirPursuit, setupAirPursuitShot } from './airpursuit.js';
import { stageCustomsShot } from './customsShot.js';
import { SunsetGPDirector } from './sunsetGP.js';
import { TaxiService } from './taxi.js';
import { stageTaxiShot } from './taxiShot.js';
import { PhotoTourService } from './photoTour.js';
import { stagePhotoShot } from './photoShot.js';
import { FoodCourierService, FOOD_COURIER } from './foodCourier.js';
import { stageCourierShot } from './foodCourierShot.js';
import { ValetRushService, VALET } from './valetRush.js';
import { stageValetShot } from './valetShot.js';
import { TowService } from './towService.js';
import { stageTowShot } from './towShot.js';
import { LoopTourService } from './loopTour.js';
import { stageLoopTourShot } from './loopTourShot.js';
import { CashPickupService } from './cashPickup.js';
import { stageCashPickupShot } from './cashPickupShot.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seed = Number(params.get('seed')) || 1;

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!shot, powerPreference: 'high-performance' });
renderer.setPixelRatio(shot ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 1, 0.4, 3600);

const input = new Input(canvas);
const world = new World(scene, camera, seed);
const air = new AirPursuit(world, scene); // Costa Air-1: hooks itself into world.afterStep, so it ticks wherever the world does
world.air = air;
const gp = new SunsetGPDirector(world, scene); // Sunset GP: hooks itself into world.afterStep like Air-1, and publishes gp.view / gp.mapView for the HUD and minimap
world.gp = gp;
const taxi = new TaxiService(world, scene); // Costa Cab fares: driven from the frame loop below; world.taxi lets the HUD read hudState()
world.taxi = taxi;
let taxiHealth = null; // player car health last frame (damage delta source)
const photoTour = new PhotoTourService(world, scene); // Sunset Photo Tour: same frame-loop pattern as the cab; world.photoTour feeds the HUD
world.photoTour = photoTour;
let photoHealth = null; // its own damage-delta source: never shared with taxiHealth
const foodCourier = new FoodCourierService(world, scene); // Costa Food Delivery chain: same frame-loop pattern; world.foodCourier feeds the HUD
world.foodCourier = foodCourier;
let courierHealth = null; // its own damage-delta source: separate from taxiHealth and photoHealth
const valetRush = new ValetRushService(world, scene); // Marina Hotel Valet: same frame-loop pattern; world.valetRush feeds the HUD
world.valetRush = valetRush;
let valetHealth = null; // its own damage-delta source: separate from the other jobs
const tow = new TowService(world, scene); // Costa Tow Service: same frame-loop pattern; world.tow feeds the HUD
world.tow = tow;
let towHealth = null; // its own damage-delta source: separate from the other jobs
const loopTour = new LoopTourService(world, scene); // Harbor Loop Tour: same frame-loop pattern; world.loopTour feeds the HUD
world.loopTour = loopTour;
let loopTourHealth = null; // its own damage-delta source: separate from the other jobs
const cashPickup = new CashPickupService(world, scene); // Armored Cash Pickup: same frame-loop pattern; world.cashPickup feeds the HUD
world.cashPickup = cashPickup;
let cashPickupHealth = null; // its own damage-delta source: separate from the other jobs
window.__game = { world, renderer, air, gp, taxi, photoTour, foodCourier, valetRush, tow, loopTour, cashPickup };

// Per-frame context for cashPickup.update; credits pay + bonus exactly once per event and announces each phase.
function cashPickupCtx() {
  const p = world.player;
  const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
  let delta = 0;
  if (car) {
    if (cashPickupHealth !== null && cashPickupHealth.car === car) delta = Math.max(0, cashPickupHealth.hp - car.health);
    cashPickupHealth = { car, hp: car.health };
  } else {
    cashPickupHealth = null;
  }
  const money = (n) => `$${n.toLocaleString('en-US')}`;
  return {
    carPos: { x: p.px, z: p.pz },
    carSpeed: car ? car.speedF : 0,
    inCar: !!car,
    carDamageDelta: delta,
    onEvent(ev) {
      if (ev.type !== 'cashPickup') return;
      const total = ev.pay + ev.bonus;
      if (ev.phase === 'bag') {
        world.cash += total;
        world.notify(`CASH BAG ${ev.bagsDone}/4  +${money(total)}`, 'mission');
      } else if (ev.phase === 'paid') {
        world.cash += total;
        world.notify(`VAULT DELIVERY COMPLETE  +${money(total)}${ev.bonus ? '  (clean getaway)' : ''}`, 'mission');
      } else if (ev.phase === 'failed') world.notify('Cash pickup abandoned. The bags are gone.', 'warn');
    },
  };
}

// Per-frame context for loopTour.update; pays out and announces tour events (pay + bonus credited once per stop / once at the end).
function loopTourCtx() {
  const p = world.player;
  const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
  let delta = 0;
  if (car) {
    if (loopTourHealth !== null && loopTourHealth.car === car) delta = Math.max(0, loopTourHealth.hp - car.health);
    loopTourHealth = { car, hp: car.health };
  } else {
    loopTourHealth = null;
  }
  const money = (n) => `$${n.toLocaleString('en-US')}`;
  return {
    carPos: { x: p.px, z: p.pz },
    carSpeed: car ? car.speedF : 0,
    inCar: !!car,
    carDamageDelta: delta,
    onEvent(ev) {
      if (ev.type !== 'loopTour') return;
      if (ev.phase === 'boarded') world.notify('Tourists aboard. Visit the 5 pink rings in order.', 'info');
      else if (ev.phase === 'stop') {
        world.cash += ev.pay + ev.bonus;
        world.notify(`STOP ${ev.stopsDone}/5  +${money(ev.pay + ev.bonus)}${ev.bonus ? '  (smooth ride)' : ''}`, 'mission');
      } else if (ev.phase === 'paid') {
        world.cash += ev.pay + ev.bonus;
        world.notify(`LOOP TOUR COMPLETE  +${money(ev.pay + ev.bonus)}${ev.bonus ? '  (on schedule)' : ''}`, 'mission');
      } else if (ev.phase === 'failed') world.notify('Loop tour abandoned. The tourists walked off.', 'warn');
    },
  };
}

// Per-frame context for tow.update; pays out and announces tow events.
function towCtx() {
  const p = world.player;
  const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
  let delta = 0;
  if (car) {
    if (towHealth !== null && towHealth.car === car) delta = Math.max(0, towHealth.hp - car.health);
    towHealth = { car, hp: car.health };
  } else {
    towHealth = null;
  }
  return {
    carPos: { x: p.px, z: p.pz },
    carSpeed: car ? car.speedF : 0,
    inCar: !!car,
    carDamageDelta: delta,
    onEvent(ev) {
      if (ev.type !== 'tow') return;
      if (ev.phase === 'hooked') world.notify('Stranded car hooked. Tow it to the orange ring.', 'info');
      else if (ev.phase === 'paid') {
        world.cash += ev.pay + ev.bonus;
        world.notify(`TOW DELIVERED  +$${(ev.pay + ev.bonus).toLocaleString('en-US')}${ev.bonus ? `  (bonus $${ev.bonus})` : ''}`, 'mission');
      } else if (ev.phase === 'snapped') world.notify('Tow cable snapped! Keep it under 25 m/s.', 'warn');
      else if (ev.phase === 'failed') world.notify('Tow abandoned. No pay.', 'warn');
    },
  };
}

// Build the per-frame context taxi.update expects from the player's car and pay out / announce taxi events.
function taxiCtx() {
  const p = world.player;
  const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null; // boats and walking do not count as being in the cab
  let delta = 0;
  if (car) {
    if (taxiHealth !== null && taxiHealth.car === car) delta = Math.max(0, taxiHealth.hp - car.health);
    taxiHealth = { car, hp: car.health };
  } else {
    taxiHealth = null;
  }
  return {
    carPos: { x: p.px, z: p.pz },
    carSpeed: car ? car.speedF : 0,
    inCar: !!car,
    carDamageDelta: delta,
    onEvent(ev) {
      if (ev.type !== 'taxi') return;
      if (ev.phase === 'pickup') world.notify('Fare aboard. Take them to the yellow ring.', 'info');
      else if (ev.phase === 'paid') {
        world.cash += ev.fare + ev.tip;
        world.notify(`FARE PAID  +$${(ev.fare + ev.tip).toLocaleString('en-US')}${ev.tip ? `  (tip $${ev.tip})` : ''}`, 'mission');
      } else if (ev.phase === 'failed') world.notify('Fare abandoned. No pay.', 'warn');
    },
  };
}
const hud = new Hud();
window.__game.hud = hud;

// Per-frame context for photoTour.update. Money: each photo pays PER_SPOT ('photo' event), the final 'paid' event carries only BASE_PAY + tips.
function photoCtx() {
  const p = world.player;
  const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
  let delta = 0;
  if (car) {
    if (photoHealth !== null && photoHealth.car === car) delta = Math.max(0, photoHealth.hp - car.health);
    photoHealth = { car, hp: car.health };
  } else {
    photoHealth = null;
  }
  return {
    carPos: { x: p.px, z: p.pz },
    carSpeed: car ? car.speedF : 0,
    inCar: !!car,
    carDamageDelta: delta,
    wrecked: !!car && car.health <= 0,
    onEvent(ev) {
      if (ev.type === 'photo') {
        if (ev.flash) hud.flash(!!shot);
        if (ev.pay) {
          world.cash += ev.pay;
          world.notify(`PHOTO TAKEN  +$${ev.pay.toLocaleString('en-US')}`, 'mission');
        }
      } else if (ev.type === 'photoTour') {
        if (ev.phase === 'pickup') world.notify('Tourist aboard. Drive to the orange rings for photos.', 'info');
        else if (ev.phase === 'paid') {
          world.cash += ev.pay;
          world.notify(`TOUR COMPLETE  +$${ev.pay.toLocaleString('en-US')}${ev.tip ? `  (tip $${ev.tip})` : ''}`, 'mission');
        } else if (ev.phase === 'failed') world.notify('Photo tour abandoned. No tips.', 'warn');
      }
    },
  };
}
// Per-frame context for foodCourier.update. Money: every 'dropPaid' pays ev.reward; the single 'chainPaid' event pays BASE_PAY once after the last drop; 'failed' pays nothing.
function courierCtx() {
  const p = world.player;
  const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
  let delta = 0;
  if (car) {
    if (courierHealth !== null && courierHealth.car === car) delta = Math.max(0, courierHealth.hp - car.health);
    courierHealth = { car, hp: car.health };
  } else {
    courierHealth = null;
  }
  return {
    carPos: { x: p.px, z: p.pz },
    carSpeed: car ? car.speedF : 0,
    inCar: !!car,
    carDamageDelta: delta,
    wrecked: !!car && car.health <= 0,
    onEvent(ev) {
      if (ev.type !== 'courier') return;
      if (ev.phase === 'pickup') world.notify('Order picked up. Deliver it to the green ring while it is hot.', 'info');
      else if (ev.phase === 'dropPaid') {
        world.cash += ev.reward;
        const tag = ev.hot ? `HOT  x${ev.chain}` : ev.cold ? 'COLD' : 'WARM';
        world.notify(`DELIVERED ${ev.dropsDone}/${FOOD_COURIER.MAX_CHAIN}  +$${ev.reward.toLocaleString('en-US')}  (${tag})`, 'mission');
      } else if (ev.phase === 'chainPaid') {
        world.cash += ev.pay;
        world.notify(`CHAIN COMPLETE  +$${ev.pay.toLocaleString('en-US')}`, 'mission');
      } else if (ev.phase === 'failed') world.notify(ev.reason === 'wrecked' ? 'Car wrecked. Delivery run over.' : 'Order abandoned. Run over.', 'warn');
    },
  };
}
// Per-frame context for valetRush.update. Money: every 'parked' event pays ev.reward (PER_PARK); the single 'paid' event pays ev.pay (BASE_PAY + tips) once after the third park; 'failed' pays nothing.
function valetCtx() {
  const p = world.player;
  const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
  let delta = 0;
  if (car) {
    if (valetHealth !== null && valetHealth.car === car) delta = Math.max(0, valetHealth.hp - car.health);
    valetHealth = { car, hp: car.health };
  } else {
    valetHealth = null;
  }
  return {
    carPos: { x: p.px, z: p.pz },
    carSpeed: car ? car.speedF : 0,
    inCar: !!car,
    carDamageDelta: delta,
    onEvent(ev) {
      if (ev.type !== 'valet') return;
      if (ev.phase === 'handover') world.notify('Keys handed over. Park the car in the violet bay.', 'info');
      else if (ev.phase === 'parked') {
        world.cash += ev.reward;
        world.notify(`PARKED ${ev.parksDone}/${VALET.MAX_PARKS}  +$${ev.reward.toLocaleString('en-US')}`, 'mission');
      } else if (ev.phase === 'paid') {
        world.cash += ev.pay;
        const tips = [ev.tipFast ? 'FAST' : '', ev.tipClean ? 'CLEAN' : ''].filter(Boolean).join(' + ');
        world.notify(`VALET COMPLETE  +$${ev.pay.toLocaleString('en-US')}${tips ? `  (${tips})` : ''}`, 'mission');
      } else if (ev.phase === 'failed') {
        world.notify(ev.reason === 'wrecked' ? 'Car wrecked. Valet run over.' : ev.reason === 'timeout' ? 'Out of time. Valet run over.' : 'Car abandoned. Valet run over.', 'warn');
      }
    },
  };
}
const minimap = new Minimap(document.getElementById('minimap'), world.layout);
const audio = new GameAudio();
window.__game.audio = audio;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) {
    audio.toggleMute();
    ui.setMuted(audio.muted);
    world.notify(audio.muted ? 'Sound off' : 'Sound on', 'info');
  }
});
const ui = new Ui(input, {
  onStart(mode) {
    audio.start(); // runs inside the click / key press that left the title screen
    if (mode === 'continue') {
      const save = loadSave();
      if (save) {
        world.applySave(save);
        gp.restore(save.gp); // championship points, round and the Vento Apex R unlock
      }
    } else {
      clearSave();
      gp.restore(null); // a new game starts a fresh championship
    }
    world.rig.snap(world.player, world.collision);
    hud.show(true);
  },
  onPause() {
    writeSave(world);
    audio.setPaused(true);
  },
  onResume() {
    audio.setPaused(false);
  },
});
ui.setMuted(audio.muted);
if (!shot) ui.setSave(loadSave());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let mapFrame = 0;
function drawMinimap() {
  if (!shot && (mapFrame++ & 1)) return; // the minimap redraws at half the frame rate (it is the costliest 2D job)
  const ic = world.intercept;
  const q = ic.active ? ic.position : null;
  minimap.draw(world.player, world.vehicles, world.missions.target, world.rig.yaw, {
    peds: world.peds.list,
    crests: world.crests.near,
    boats: { ...world.boats.mapView, ...world.contraband.mapView },
    armored: world.armored.mapView,
    ambient: world.ambient.active?.mapIcon ?? null,
    customs: world.customs.mapView,
    gp: gp.mapView,
    taxi: taxi.targetPos(),
    photo: photoTour.targetPos(),
    courier: foodCourier.targetPos(),
    valet: valetRush.targetPos(),
    tow: tow.targetPos(),
    loopTour: loopTour.targetPos(),
    cashPickup: cashPickup.targetPos(),
    now: shot === 'airpursuit' ? air.time : shot === 'customs' || shot === 'gp' || shot === 'tow' || shot === 'loop' || shot === 'cash' || shot === 'taxi' || shot === 'photo' || shot === 'courier' || shot === 'valet' ? 12.3 : undefined, // the Air-1 preset runs on its own fixed clock so the cruiser blink is identical on every load
    intercept: q && { x: q.x, z: q.z, h: q.h, dist: ic.dist, near: R_NEAR, far: R_FAR, outside: ic.dist > R_FAR && ic.upload < 100 },
  });
  hud.drawAirMinimap(minimap, world, world.rig.yaw); // Air-1 spotlight disc, rotor icon and Spike-Pod ticks on top
}

if (shot) {
  // ?shot=airpursuit is built by airpursuit.js itself (it owns the helicopter, beam and strip staging); every other shot goes through shots.js
  if (shot === 'airpursuit') setupAirPursuitShot(world, air, hud, ui);
  else if (shot === 'customs') stageCustomsShot(world, hud, ui); // Solaris Customs hero frame (customsShot.js)
  else if (shot === 'gp') gp.setupDeterministicShot(hud, ui); // Sunset GP round 1 under way (sunsetGP.js owns the staging)
  else if (shot === 'taxi') stageTaxiShot(world, taxi, taxiCtx, hud, ui); // Costa Cab hero frame (taxiShot.js)
  else if (shot === 'photo') stagePhotoShot(world, photoTour, photoCtx, hud, ui); // Sunset Photo Tour hero frame (photoShot.js)
  else if (shot === 'courier') stageCourierShot(world, foodCourier, courierCtx, hud, ui); // Costa Food Delivery hero frame (foodCourierShot.js)
  else if (shot === 'valet') stageValetShot(world, valetRush, valetCtx, hud, ui); // Marina Hotel Valet hero frame (valetShot.js)
  else if (shot === 'tow') stageTowShot(world, tow, towCtx, hud, ui); // Costa Tow Service hero frame (towShot.js)
  else if (shot === 'loop') stageLoopTourShot(world, loopTour, loopTourCtx, hud, ui); // Harbor Loop Tour hero frame (loopTourShot.js)
  else if (shot === 'cash') stageCashPickupShot(world, cashPickup, cashPickupCtx, hud, ui); // Armored Cash Pickup hero frame (cashPickupShot.js)
  else prepareShot(shot, { world, hud, ui });
  hud.update(0, world); // dt 0: refresh the Air-1 pill/glare and the other HUD readouts once more so the frame matches the final world state
  drawMinimap();
  renderer.render(scene, camera);
  window.__ready = true;
} else if (params.get('bench')) {
  startBench({ world, hud, ui, renderer, drawMinimap, seconds: Number(params.get('secs')) || 30 });
} else {
  let last = performance.now();
  let clock = 0;
  let saveClock = 0;
  const saveNow = () => {
    if (ui.state !== 'title' && !world.fx) writeSave(world);
  };
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => document.hidden && saveNow());
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (ui.state === 'title') {
      clock += dt;
      world.updateTitle(dt, clock);
    } else if (ui.state === 'playing') {
      const mouse = input.takeMouse();
      world.update(dt, input, mouse);
      taxi.update(dt, taxiCtx());
      photoTour.update(dt, photoCtx());
      foodCourier.update(dt, courierCtx());
      valetRush.update(dt, valetCtx());
      tow.update(dt, towCtx());
      loopTour.update(dt, loopTourCtx());
      cashPickup.update(dt, cashPickupCtx());
      hud.update(dt, world);
      audio.update(dt, world);
      drawMinimap();
      saveClock += dt;
      if (world.saveRequested || saveClock > 10) {
        world.saveRequested = false;
        saveClock = 0;
        saveNow();
      }
    }
    input.endFrame();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}
