// world: assembles city, environment, vehicles, traffic, pedestrians, police, wanted level, missions and the player into one simulation with a single update().
import * as THREE from '../vendor/three.module.min.js';
import { generateCity } from './cityLayout.js';
import { buildCity } from './cityBuilder.js';
import { buildScenery } from './scenery.js';
import { Environment } from './environment.js';
import { ContactShadows } from './contactShadows.js';
import { Collision } from './collision.js';
import { VehicleManager } from './vehicles.js';
import { PAINTS } from './vehicleModels.js';
import { Player } from './player.js';
import { CameraRig } from './cameraRig.js';
import { MissionTracker } from './missions.js';
import { RoadNet } from './roadNet.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Wanted } from './wanted.js';
import { SignalIntercept } from './signalIntercept.js';
import { ArmoredHeist } from './armoredTruck.js';
import { Crests } from './crests.js';
import { AmbientDirector } from './ambient/AmbientDirector.js';
import { TUNER_DEF } from './ambient/TunerBreakdownEvent.js';
import { makeRng } from './rng.js';
import { START_CASH } from './config.js';

const TYPE_WEIGHTS = [['marlin', 0.3], ['pico', 0.2], ['vesper', 0.12], ['dune', 0.2], ['harborVan', 0.18]];
const ENTER_RANGE = 2.6;
const TRAFFIC_COUNT = 20;
const PED_COUNT = 35;
const FX_TIME = 2.8; // length of the WASTED / BUSTED screen
const NO_INPUT = { down: () => false, pressed: () => false };

export class World {
  constructor(scene, camera, seed = 1) {
    this.scene = scene;
    this.camera = camera;
    this.layout = generateCity(seed);
    scene.add(buildCity(this.layout, seed), buildScenery(this.layout));
    this.env = new Environment(scene);
    this.collision = new Collision(this.layout.colliders, this.layout.bounds);
    this.shadows = new ContactShadows(scene);
    this.vehicles = new VehicleManager(scene, this.collision, this.layout.groundHeightAt);
    this._spawnParkedCars();
    const s = this.layout.start;
    this.player = new Player(scene, s.x, s.z, s.heading);
    this.rig = new CameraRig(camera);
    this.rig.yaw = s.heading;
    this.messages = []; // {text, kind} consumed by the HUD
    this.events = []; // one-shot sound cues ('hitPed', 'mission', 'busted', 'wasted', 'door', 'carjack') consumed by audio
    this.cash = START_CASH;
    this.wanted = new Wanted((t, k) => this.notify(t, k), {
      onRaise: () => this.emit('wantedUp'),
      onVouch: (left) => {
        this.notify(`POLICE VOUCH REDEEMED: ${left === 0 ? '1★ FORGIVEN' : 'ONE STAR FORGIVEN'}`, 'vouch');
        this.emit('escaped');
        this.saveRequested = true;
      },
      onEscape: (peak) => {
        const bonus = 120 * Math.max(1, peak); // shaking the cops off pays, more the hotter it got
        this.cash += bonus;
        this.emit('escaped');
        this.notify(`LOST THEM  +$${bonus}`, 'escape');
      },
    });
    this.district = '';
    this.prompt = '';
    this.promptProgress = -1; // 0..1 fills the bar under the prompt (hold-to-repair), -1 hides it
    this.ambientCaption = null; // {text, t} bottom-centre caption when an ambient event first comes into notice range
    this._input = NO_INPUT; // the frame's input, for systems that need held keys outside the physics loop
    this.fx = null; // {kind: 'wasted' | 'busted', t}
    this.saveRequested = false;
    this.stats = { missions: 0 };
    this.durability = 1; // crash damage multiplier (Sun-Crest milestone 20 lowers it)
    this.crestToast = null; // {n, tally, group, milestone, t} for the HUD after a Sun-Crest pickup
    this.crests = new Crests(scene, this.layout, this.collision, seed);

    const rng = makeRng(seed * 4099 + 11);
    this.net = new RoadNet(this.layout);
    this.traffic = new Traffic(this.vehicles, this.net, rng);
    this.peds = new Pedestrians(scene, this.net, rng, this.layout.groundHeightAt, PED_COUNT);
    this.police = new Police(this.vehicles, this.net, rng, this.collision);
    this.intercept = new SignalIntercept(this, scene, rng);
    this.armored = new ArmoredHeist(this, scene, rng);
    this.ambient = new AmbientDirector(this, scene, makeRng(seed * 7919 + 5));
    this.ambient.register('TUNER', TUNER_DEF);
    this.armoredPops = []; // floating texts ("HEAVY RAM!", "ON-FOOT GRAB!") for the HUD
    this.armoredResult = null; // {lines, total, t} payout breakdown for the HUD after Armored Shakedown
    this.missions = new MissionTracker(this, scene);
    this.traffic.populate(TRAFFIC_COUNT, s);
    this.peds.populate(s);
  }

  _spawnParkedCars() {
    const L = this.layout;
    const rng = L.spawnRng;
    const pickType = () => {
      let r = rng();
      for (const [k, w] of TYPE_WEIGHTS) {
        if ((r -= w) <= 0) return k;
      }
      return 'marlin';
    };
    const sc = L.starterCar;
    this.starterCar = this.vehicles.spawn('marlin', 0xe4572e, sc.x, sc.z, sc.h);
    this.starterCar.owned = true; // the player's own ride: no crime when taking it
    let count = 0;
    for (const slot of L.slots) {
      if (count >= 70) break;
      if (Math.hypot(slot.x - sc.x, slot.z - sc.z) < 9) continue;
      const near = Math.hypot(slot.x - L.start.x, slot.z - L.start.z) < 170;
      if (rng() > (near ? 0.2 : 0.022)) continue;
      const type = pickType();
      this.vehicles.spawn(type, rng.pick(PAINTS), slot.x + rng.range(-0.15, 0.15), slot.z + rng.range(-0.8, 0.8), slot.h + rng.range(-0.04, 0.04));
      count++;
    }
  }

  notify(text, kind = 'info') {
    this.messages.push({ text, kind });
  }

  emit(type) {
    if (this.events.length > 24) this.events.shift();
    this.events.push(type);
  }

  get focusPoint() {
    return { x: this.player.px, z: this.player.pz };
  }

  // Put the player behind the wheel of a vehicle (used by shots, mission setups and loading a save).
  placeInCar(vehicle) {
    if (this.player.inCar) this.player.vehicle.driver = null;
    this.traffic.release(vehicle);
    vehicle.stolen = true;
    this.player.enter(vehicle);
  }

  // Everything the player's progress consists of, restored from a (sanitized) save.
  applySave(save) {
    const p = this.player;
    this.cash = save.cash;
    this.missions.restore(save.completed);
    this.crests.restore(save.crests, this);
    let { x, z } = save;
    for (let r = 0; r < 14 && !this.collision.isFree(x, z, 1.6); r += 1) {
      const a = r * 2.4;
      x = save.x + Math.cos(a) * r * 1.5;
      z = save.z + Math.sin(a) * r * 1.5;
    }
    if (p.inCar) this.placeOnFoot(this.player.vehicle);
    p.x = x;
    p.z = z;
    p.y = this.layout.groundHeightAt(x, z);
    p.heading = save.h;
    p.vx = p.vz = 0;
    this.rig.yaw = save.h;
    if (save.car) {
      for (const v of [...this.vehicles.list]) if (v.kind === 'parked' && !v.driver && v.distanceTo(x, z) < 6) this.vehicles.remove(v);
      const v = this.vehicles.spawn(save.car.type, save.car.paint, x, z, save.h);
      this.placeInCar(v);
    }
    this.wanted.clear();
    this.wanted.vouch = save.vouch ?? 0;
    this.police.clearAll();
    this.traffic.scatter({ x, z });
    this.peds.populate({ x, z });
    this.rig.snap(p, this.collision);
  }

  // Detach the player from a car without placing them anywhere (the caller moves them).
  placeOnFoot(vehicle) {
    const p = this.player;
    vehicle.driver = null;
    vehicle.input.throttle = 0;
    p.vehicle = null;
    p.mode = 'foot';
    p.person.group.visible = true;
  }

  update(dt, input, mouse) {
    const p = this.player;
    this._input = input;
    if (this.fx) {
      this.fx.t += dt;
      input = NO_INPUT;
      mouse = { dx: 0, dy: 0 };
      if (this.fx.t > FX_TIME) this._respawn();
    }
    if (input.pressed('KeyF')) this._toggleVehicle();

    // AI decides once per frame; physics then runs in fixed sub-steps
    const ctx = { vehicles: this.vehicles.list, points: this._obstaclePoints(), target: null };
    const focus = this.focusPoint;
    this.traffic.update(dt, ctx, focus);
    this.intercept.drive(dt, ctx);
    this.armored.drive(dt, ctx);
    const camFwd = { x: Math.sin(this.rig.yaw), z: Math.cos(this.rig.yaw) };
    const arrest = this.fx ? null : this.police.update(dt, ctx, p, this.wanted, camFwd);
    if (arrest === 'busted') this._startFx('busted');

    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (p.inCar) p.updateDriving(input);
      this.vehicles.update(h);
      if (!p.inCar) p.updateFoot(h, input, this.rig.yaw, this.collision, this.vehicles, this.layout.groundHeightAt);
    }
    this.afterStep(dt, mouse);
  }

  _obstaclePoints() {
    const pts = this.peds.roadPoints();
    if (!this.player.inCar) pts.push({ x: this.player.x, z: this.player.z });
    return pts;
  }

  // Everything that runs once per rendered frame after the physics sub-steps.
  afterStep(dt, mouse) {
    const p = this.player;
    this.rig.update(dt, p, mouse, this.collision);
    this.env.update(dt, this.camera, this.focusPoint);
    this.vehicles.cull(this.camera.position.x, this.camera.position.z);

    const hits = this.peds.update(dt, { vehicles: this.vehicles.list, focus: this.focusPoint });
    for (const h of hits) {
      if (h.vehicle.driver?.isPlayer) {
        this.wanted.commit('hitPed');
        this.emit('hitPed');
        this.notify('Pedestrian hit!', 'warn');
      }
    }
    this._contactShadows();
    this._playerCrimesAndDamage(dt);
    this.wanted.update(dt, this.police.nearest);

    if (!this.fx) {
      const done = this.missions.update(dt);
      if (done) {
        this.cash += done.reward;
        this.stats.missions++;
        this.saveRequested = true;
        this.emit('mission');
        this.notify(`MISSION PASSED  +$${done.reward.toLocaleString('en-US')}`, 'mission');
        if (done.note) this.notify(done.note, 'info');
        if (done.lines) this.armoredResult = { lines: done.lines, total: done.reward };
        this.notify(`Next: ${this.missions.mission.title}`, 'info');
      }
      this.crests.update(dt, this);
    }
    this.rig.aid = p.inCar ? this.intercept.active ? this.intercept.position : this.armored.aid : null; // the camera keeps the quarry in frame
    const d = this.layout.districtAt(p.px, p.pz);
    if (d !== this.district) {
      this.district = d;
      this.notify(d.toUpperCase(), 'district');
    }
    this.ambient.update(dt, this._input);
    this.prompt = '';
    this.promptProgress = -1;
    if (!p.inCar && !this.fx) {
      const car = this._enterCandidate();
      if (car) this.prompt = `[F] ${this._enterVerb(car)} the ${car.type.name}`;
      const ev = this.ambient.active;
      if (ev?.prompt) {
        // the ambient event's own prompt wins; the car it belongs to can still be taken with F
        this.prompt = car && car.ambientEvent === ev ? `${ev.prompt}   or  F: steal it` : ev.prompt;
        this.promptProgress = ev.promptBar;
      }
    }
  }

  // Blob shadows under everything that moves (one instanced draw call); cars beyond the shadow-map range rely on these alone.
  _contactShadows() {
    const sh = this.shadows;
    const cam = this.camera.position;
    sh.begin();
    for (const v of this.vehicles.list) {
      if (!v.group.visible || (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 > 260 * 260) continue;
      sh.add(v.x, v.y, v.z, v.type.wid * 0.62, v.type.len * 0.6, v.h);
    }
    const p = this.player;
    if (!p.inCar && p.person.group.visible) sh.add(p.x, p.y, p.z, 0.55, 0.5, p.heading);
    for (const q of this.peds.list) {
      if (!q.active || !q.model.group.visible) continue;
      if (q.state === 'down') sh.add(q.x, q.y, q.z, 0.7, 1.0, q.heading);
      else sh.add(q.x, q.y, q.z, 0.5, 0.45, q.heading);
    }
    sh.end();
  }

  _enterCandidate() {
    const p = this.player;
    const car = this.vehicles.nearest(p.x, p.z, ENTER_RANGE);
    if (!car || (car.driver?.ai && Math.abs(car.speedF) > 6)) return null;
    return car;
  }

  _enterVerb(car) {
    if (car.driver?.ai) return 'Hijack';
    if (car.owned || car.stolen) return 'Drive';
    return 'Steal';
  }

  _playerCrimesAndDamage(dt) {
    const p = this.player;
    if (this.fx) return;
    const pv = p.vehicle;
    if (pv) {
      const other = pv.contact;
      if (other && pv.impact > 4 && other.kind === 'traffic') this.wanted.commit('hitCar');
      const cushion = pv.shield > 0 ? 0.35 : 1; // ramming the armored truck is meant to be repeatable
      pv.shield = Math.max(0, pv.shield - dt);
      if (pv.impact > 6) pv.health = Math.max(0, pv.health - (pv.impact - 5) * 3.4 * this.durability * cushion);
      if (pv.health <= 0) {
        pv.wrecked = true;
        this._startFx('wasted');
      }
      return;
    }
    // run over on foot
    for (const v of this.vehicles.list) {
      if (Math.abs(v.x - p.x) > 5 || Math.abs(v.z - p.z) > 5) continue;
      if (Math.abs(v.speedF) > 8 && v.distanceTo(p.x, p.z) < 0.7) {
        this._startFx('wasted');
        break;
      }
    }
  }

  _startFx(kind) {
    if (this.fx) return;
    this.fx = { kind, t: 0 };
    this.emit(kind);
    this.notify(kind === 'wasted' ? 'WASTED' : 'BUSTED', 'warn');
  }

  // After the WASTED / BUSTED screen: fine the player, drop them at the start point with a clean record.
  _respawn() {
    const p = this.player;
    const kind = this.fx.kind;
    const fine = Math.min(this.cash, kind === 'busted' ? 200 + 150 * this.wanted.stars : 300);
    this.cash -= fine;
    if (p.inCar) {
      const v = p.vehicle;
      this.placeOnFoot(v);
      this.vehicles.remove(v); // wrecked or impounded
    }
    this.police.clearAll();
    this.wanted.clear();
    const s = this.layout.start;
    p.x = s.x;
    p.z = s.z;
    p.y = this.layout.groundHeightAt(s.x, s.z);
    p.heading = s.heading;
    p.vx = p.vz = 0;
    this.rig.yaw = s.heading;
    this.rig.snap(p, this.collision);
    this.missions.onPlayerDown();
    this.fx = null;
    this.saveRequested = true;
    this.notify(kind === 'busted' ? `Booked and released. Fine $${fine}` : `Patched up at Costa General. Bill $${fine}`, 'info');
  }

  _witnessed(x, z) {
    if (this.police.nearest < 45) return true;
    return this.peds.list.some((q) => q.active && q.state !== 'down' && q.model.group.visible && Math.hypot(q.x - x, q.z - z) < 24);
  }

  _toggleVehicle() {
    const p = this.player;
    if (p.inCar) {
      if (Math.abs(p.vehicle.speedF) > 7) return this.notify('Slow down to get out', 'warn');
      if (!p.exit(this.collision, this.vehicles)) this.notify('No room to get out', 'warn');
      else this.emit('door');
      return undefined;
    }
    const car = this._enterCandidate();
    if (!car) return undefined;
    if (car.driver?.ai) {
      this.peds.ejectDriver(car.x + Math.cos(car.h) * 1.6, car.z - Math.sin(car.h) * 1.6, this.focusPoint);
      this.wanted.commit('carjack');
      this.notify('Carjacked!', 'warn');
      this.emit('carjack');
    } else if (car.ambientEvent) {
      car.ambientEvent.onStolen(); // the stranded tuner: the owner saw everything and calls the police
    } else if (!car.owned && !car.stolen) {
      if (this._witnessed(car.x, car.z)) {
        this.wanted.commit('stealParked');
        this.notify('Someone saw you steal that car!', 'warn');
      } else {
        this.notify('Nobody saw you. Smooth.', 'info');
      }
    }
    this.traffic.release(car);
    car.stolen = true;
    p.enter(car);
    this.emit('door');
    return undefined;
  }

  // Slow orbit around the harbour for the title screen.
  updateTitle(dt, time) {
    const a = time * 0.05 - 0.9;
    const r = 120;
    this.camera.position.set(-110 + Math.sin(a) * r, 20 + Math.sin(time * 0.1) * 3, 372 + Math.cos(a) * 30);
    this.camera.lookAt(new THREE.Vector3(-20 + Math.sin(a) * 40, 42, 40));
    this.env.update(dt, this.camera, { x: -60, z: 200 });
    this.messages.length = 0;
  }
}
