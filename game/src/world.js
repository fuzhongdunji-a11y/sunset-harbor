// world: assembles the city, environment, vehicles, player, camera and missions into one simulation with a single update().
import * as THREE from '../vendor/three.module.min.js';
import { generateCity } from './cityLayout.js';
import { buildCity } from './cityBuilder.js';
import { buildScenery } from './scenery.js';
import { Environment } from './environment.js';
import { Collision } from './collision.js';
import { VehicleManager } from './vehicles.js';
import { PAINTS } from './vehicleModels.js';
import { Player } from './player.js';
import { CameraRig } from './cameraRig.js';
import { MissionTracker } from './missions.js';
import { START_CASH } from './config.js';

const TYPE_WEIGHTS = [['marlin', 0.3], ['pico', 0.2], ['vesper', 0.12], ['dune', 0.2], ['harborVan', 0.18]];
const ENTER_RANGE = 2.6;

export class World {
  constructor(scene, camera, seed = 1) {
    this.scene = scene;
    this.camera = camera;
    this.layout = generateCity(seed);
    scene.add(buildCity(this.layout, seed), buildScenery(this.layout));
    this.env = new Environment(scene);
    this.collision = new Collision(this.layout.colliders, this.layout.bounds);
    this.vehicles = new VehicleManager(scene, this.collision, this.layout.groundHeightAt);
    this._spawnParkedCars();
    const s = this.layout.start;
    this.player = new Player(scene, s.x, s.z, s.heading);
    this.rig = new CameraRig(camera);
    this.rig.yaw = s.heading;
    this.missions = new MissionTracker(scene);
    this.cash = START_CASH;
    this.wanted = 0;
    this.district = '';
    this.messages = []; // {text, kind} consumed by the HUD
    this.prompt = '';
    this.focus = { x: s.x, z: s.z };
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

  get focusPoint() {
    return { x: this.player.px, z: this.player.pz };
  }

  // Put the player behind the wheel of a vehicle (used by shots and mission setups).
  placeInCar(vehicle) {
    if (this.player.inCar) this.player.vehicle.driver = null;
    this.player.enter(vehicle);
  }

  update(dt, input, mouse) {
    const p = this.player;
    if (input.pressed('KeyF')) this._toggleVehicle();

    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (p.inCar) p.updateDriving(input);
      this.vehicles.update(h);
      if (!p.inCar) p.updateFoot(h, input, this.rig.yaw, this.collision, this.vehicles, this.layout.groundHeightAt);
    }
    this.afterStep(dt, mouse);
  }

  // Everything that runs once per rendered frame after the physics sub-steps.
  afterStep(dt, mouse) {
    const p = this.player;
    this.rig.update(dt, p, mouse, this.collision);
    this.env.update(dt, this.camera, this.focusPoint);
    const done = this.missions.update(dt, p);
    if (done) {
      this.cash += done.reward;
      this.notify(`MISSION PASSED  +$${done.reward}`, 'mission');
      const next = this.missions.active;
      if (next) this.notify(`Next: ${next.title}`, 'info');
      else this.notify('All jobs done. Free roam in Costa Serena!', 'info');
    }
    const d = this.layout.districtAt(p.px, p.pz);
    if (d !== this.district) {
      this.district = d;
      this.notify(d.toUpperCase(), 'district');
    }
    this.prompt = '';
    if (!p.inCar) {
      const car = this.vehicles.nearest(p.x, p.z, ENTER_RANGE);
      if (car) this.prompt = `[F] Drive the ${car.type.name}`;
    }
  }

  _toggleVehicle() {
    const p = this.player;
    if (p.inCar) {
      if (Math.abs(p.vehicle.speedF) > 7) return this.notify('Slow down to get out', 'warn');
      if (!p.exit(this.collision, this.vehicles)) this.notify('No room to get out', 'warn');
      return undefined;
    }
    const car = this.vehicles.nearest(p.x, p.z, ENTER_RANGE);
    if (car) p.enter(car);
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
