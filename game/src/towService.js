// towService: a tow service job. Drive to a roadside stranded car, hook it, tow it to a drop-off point.
// States: IDLE -> TO_STRANDED -> HOOKING (1s) -> TOWING -> (PAID | FAILED) -> 20s cooldown -> IDLE.
// ctx (per frame, from main.js): { carPos:{x,z}, carSpeed, inCar, carDamageDelta, onEvent(ev) }.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const TOW = {
  BASE_PAY: 180,
  PER_METER: 0.7,
  BONUS_FAST: 200,
  BONUS_CLEAN: 150,
};

const PICKUP_R = 5; // distance to trigger hook
const HOOK_TIME = 1.0;
const MAX_SPEED = 25; // m/s
const SNAP_TIME = 3; // seconds above MAX_SPEED (total) before the cable snaps
const MAX_OUT = 20; // seconds out of car before failure during towing
const COOLDOWN = 20;
const FIRST_DELAY = 12; // seconds after load before the first stranded car appears
const TRIP_MIN_DIST = 200; // destination at least 200m from stranded car
const TRACK_SPACING = 6; // path distance of towed car behind player
const DELIVER_R = 6;
const PAR_SPEED = 12; // m/s par for the fast bonus
const MAX_CRUMBS = 600;
const SEA_Z = 330; // used for anchor selection
const CABLE_Y = 0.7;

// ring marker used for stranded car and drop-off
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const ringMatOrange = new THREE.MeshBasicMaterial({ color: 0xffa500, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
const bodyGeom = new THREE.BoxGeometry(2, 0.8, 4.2);
const cabinGeom = new THREE.BoxGeometry(1.7, 0.6, 2.2);
const wheelGeom = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 12).rotateZ(Math.PI / 2);
const lightGeom = new THREE.SphereGeometry(0.14, 8, 8);
const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a8f98, flatShading: true });
const cabinMat = new THREE.MeshLambertMaterial({ color: 0x3a4250, flatShading: true });
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

class Marker {
  constructor(scene) {
    this.mesh = new THREE.Mesh(ringGeom, ringMatOrange);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.baseY = 0;
    scene.add(this.mesh);
  }
  setPos(x, y, z) {
    this.baseY = y;
    this.mesh.position.set(x, y, z);
    this.mesh.visible = true;
  }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
  hide() {
    this.mesh.visible = false;
  }
}

// The stranded driver: a simple figure that walks to the car during the hook and then vanishes.
class Driver {
  constructor(scene) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.4), new THREE.MeshLambertMaterial({ color: 0xff7a1a }));
    body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshLambertMaterial({ color: 0xf0c9a0 }));
    head.position.y = 1.6;
    g.add(body, head);
    g.visible = false;
    scene.add(g);
    this.group = g;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.t = 0;
    this.active = false;
  }
  start(fromX, fromY, fromZ, toX, toZ) {
    this.from.set(fromX, fromY, fromZ);
    this.to.set(toX, fromY, toZ);
    this.t = 0;
    this.active = true;
    this.group.position.copy(this.from);
    this.group.rotation.y = Math.atan2(toX - fromX, toZ - fromZ);
    this.group.visible = true;
  }
  update(dt) {
    if (!this.active) return;
    this.t = Math.min(1, this.t + dt / HOOK_TIME);
    this.group.position.lerpVectors(this.from, this.to, this.t);
    this.group.position.y = this.from.y + Math.abs(Math.sin(this.t * Math.PI * 4)) * 0.08;
    if (this.t >= 1) this.hide();
  }
  hide() {
    this.group.visible = false;
    this.active = false;
  }
}

export class TowService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < SEA_Z) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 4099 + 19);
    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;
    this.marker = new Marker(scene); // stranded car ring
    this.dropMarker = new Marker(scene); // drop-off ring
    this.driver = new Driver(scene);
    this.car = null; // stranded car group
    this.hazardLights = null;
    this.cable = null; // THREE.Line
    this.cablePos = null; // its position attribute
    this.crumbs = []; // player trail while towing: {x, z, y}
    this.towingTime = 0;
    this.towedDamage = 0;
    this.towDistance = 0; // metres the player has driven while towing
    this.highSpeedTimer = 0;
    this.outTime = 0;
    this.hookTimer = 0;
    this.destination = null;
    this.driverStart = null;
    this.currentPay = 0;
    this.lastPlayer = null;
  }

  _groundY(x, z) {
    return (this.world.layout.groundHeightAt ? this.world.layout.groundHeightAt(x, z) : 0) + 0.08;
  }

  _buildCar() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.7;
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.position.set(0, 1.4, -0.2);
    group.add(body, cabin);
    for (const [wx, wz] of [[-0.95, -1.4], [0.95, -1.4], [-0.95, 1.4], [0.95, 1.4]]) {
      const w = new THREE.Mesh(wheelGeom, wheelMat);
      w.position.set(wx, 0.34, wz);
      group.add(w);
    }
    // hazard lights: amber, blink while waiting
    this.hazardLights = [];
    for (const lx of [-0.8, 0.8]) {
      const l = new THREE.Mesh(lightGeom, new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 1 }));
      l.position.set(lx, 1.2, 2.15);
      group.add(l);
      this.hazardLights.push(l);
    }
    return group;
  }

  _spawnStrandedCar() {
    const anchor = this.rng.pick(this.anchors);
    const x = anchor.x + 4.3; // kerb-side lane next to the junction
    const z = anchor.z;
    const y = this._groundY(x, z);
    const group = this._buildCar();
    group.position.set(x, y, z);
    group.rotation.y = this.rng.pick([0, Math.PI]);
    this.scene.add(group);
    this.car = group;
    this.driverStart = { x: x + 2.5, y: this._groundY(x + 2.5, z), z: z + 2 };
    this.driver.hide();
    this.marker.setPos(x, y, z);
    this._pickDestination(anchor);
  }

  _pickDestination(strandedAnchor) {
    let pool = this.anchors.filter((a) => Math.hypot(a.x - strandedAnchor.x, a.z - strandedAnchor.z) >= TRIP_MIN_DIST);
    if (pool.length === 0) pool = this.anchors;
    this.destination = this.rng.pick(pool);
    this.dropMarker.hide(); // shown once the car is hooked
  }

  // Shot/test hook: skip straight to TOWING with the stranded car parked at `from` ({x,z}) and the player at (px,pz) with a trail between them.
  forceTowing(from, px, pz) {
    this._clearCable();
    this._removeCar();
    this._spawnStrandedCar();
    this.car.position.set(from.x, this._groundY(from.x, from.z), from.z);
    this.state = 'TOWING';
    this.towingTime = 0;
    this.towedDamage = 0;
    this.towDistance = 0;
    this.highSpeedTimer = 0;
    this.outTime = 0;
    this.hazardLights = null;
    this.marker.hide();
    const dist = (a) => Math.hypot(a.x - px, a.z - pz);
    this.destination = this.anchors.filter((a) => dist(a) > 60).sort((a, b) => dist(a) - dist(b))[0];
    this.dropMarker.setPos(this.destination.x, this._groundY(this.destination.x, this.destination.z), this.destination.z);
    this.crumbs = [{ x: from.x, z: from.z }, { x: px, z: pz }];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.cablePos = geo.getAttribute('position');
    this.cable = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x20e070 }));
    this.cable.frustumCulled = false;
    this.scene.add(this.cable);
  }

  _clearCable() {
    if (!this.cable) return;
    this.scene.remove(this.cable);
    this.cable.geometry.dispose();
    this.cable.material.dispose();
    this.cable = null;
    this.cablePos = null;
  }

  _finish(success) {
    this.state = success ? 'PAID' : 'FAILED';
    this.cooldown = COOLDOWN;
    this.marker.hide();
    this.dropMarker.hide();
    this.driver.hide();
    this._clearCable();
    this.hazardLights = null;
    // the towed car stays where it stopped until the cooldown ends (see update)
  }

  _removeCar() {
    if (!this.car) return;
    this.scene.remove(this.car);
    this.car = null;
  }

  targetPos() {
    if (this.state === 'TO_STRANDED' || this.state === 'HOOKING') {
      return { x: this.marker.mesh.position.x, z: this.marker.mesh.position.z };
    }
    if (this.state === 'TOWING' && this.destination) return { x: this.destination.x, z: this.destination.z };
    return null;
  }

  hudState() {
    const visible = this.state === 'TO_STRANDED' || this.state === 'HOOKING' || this.state === 'TOWING';
    const label = this.state === 'TOWING' ? 'TOWING' : 'TOW CALL';
    const pay = Math.round(TOW.BASE_PAY + TOW.PER_METER * this.towDistance);
    let distanceLeft = 0;
    if (this.car && this.destination && this.state === 'TOWING') {
      distanceLeft = Math.hypot(this.destination.x - this.car.position.x, this.destination.z - this.car.position.z);
    } else if (this.car) {
      distanceLeft = this.lastPlayer ? Math.hypot(this.car.position.x - this.lastPlayer.x, this.car.position.z - this.lastPlayer.z) : 0;
    }
    return { visible, label, pay, distanceLeft };
  }

  // Place the towed car on the player's trail, TRACK_SPACING metres of path behind the player.
  _followTrail(px, pz) {
    const c = this.crumbs;
    let need = TRACK_SPACING;
    let ax = px, az = pz;
    for (let i = c.length - 1; i >= 0; i--) {
      const seg = Math.hypot(c[i].x - ax, c[i].z - az);
      if (seg >= need && seg > 1e-4) {
        const k = need / seg;
        const x = ax + (c[i].x - ax) * k;
        const z = az + (c[i].z - az) * k;
        this.car.position.set(x, this._groundY(x, z), z);
        this.car.rotation.y = Math.atan2(ax - x, az - z); // nose toward the player
        return;
      }
      need -= seg;
      ax = c[i].x;
      az = c[i].z;
    }
    // trail shorter than the spacing: the car has not started moving yet
  }

  _updateCable(px, pz) {
    if (!this.cable) return;
    const a = this.cablePos;
    a.setXYZ(0, px, this._groundY(px, pz) + CABLE_Y, pz);
    a.setXYZ(1, this.car.position.x, this.car.position.y + CABLE_Y, this.car.position.z);
    a.needsUpdate = true;
    this.cable.geometry.computeBoundingSphere();
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, carDamageDelta, onEvent } = ctx;
    const px = carPos.x, pz = carPos.z;
    this.lastPlayer = { x: px, z: pz };
    this.time += dt;
    this.marker.bob(this.time);
    this.dropMarker.bob(this.time);

    // hazard lights blinking
    if (this.hazardLights) {
      const on = Math.sin(this.time * 6) > 0;
      for (const l of this.hazardLights) l.material.opacity = on ? 1 : 0.15;
    }

    switch (this.state) {
      case 'IDLE':
        if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown <= 0) {
          this._spawnStrandedCar();
          this.state = 'TO_STRANDED';
        }
        break;

      case 'TO_STRANDED':
        if (inCar && carSpeed < 1 && Math.hypot(px - this.car.position.x, pz - this.car.position.z) <= PICKUP_R) {
          this.state = 'HOOKING';
          this.hookTimer = 0;
          this.driver.start(this.driverStart.x, this.driverStart.y, this.driverStart.z, this.car.position.x, this.car.position.z);
          onEvent({ type: 'tow', phase: 'hooked' });
        }
        break;

      case 'HOOKING':
        this.hookTimer += dt;
        this.driver.update(dt);
        if (this.hookTimer >= HOOK_TIME) {
          this.driver.hide();
          this.state = 'TOWING';
          this.towingTime = 0;
          this.towedDamage = 0;
          this.towDistance = 0;
          this.highSpeedTimer = 0;
          this.outTime = 0;
          this.hazardLights = null;
          this.marker.hide();
          this.dropMarker.setPos(this.destination.x, this._groundY(this.destination.x, this.destination.z), this.destination.z);
          this.crumbs = [{ x: this.car.position.x, z: this.car.position.z }, { x: px, z: pz }];
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
          this.cablePos = geo.getAttribute('position');
          this.cable = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x20e070 }));
          this.cable.frustumCulled = false;
          this.scene.add(this.cable);
          this._updateCable(px, pz);
        }
        break;

      case 'TOWING': {
        this.towingTime += dt;
        // extend the breadcrumb trail (only while the player is driving) and move the towed car along it
        const last = this.crumbs[this.crumbs.length - 1];
        const step = Math.hypot(px - last.x, pz - last.z);
        if (inCar && step >= 1) {
          this.crumbs.push({ x: px, z: pz });
          this.towDistance += step;
          if (this.crumbs.length > MAX_CRUMBS) this.crumbs.shift();
        }
        this._followTrail(px, pz);
        this._updateCable(px, pz);
        // damage accumulation (towed car takes 1.5x what the player's car takes)
        this.towedDamage += carDamageDelta * 1.5;
        // high speed timer
        if (carSpeed > MAX_SPEED) this.highSpeedTimer += dt;
        if (this.highSpeedTimer > SNAP_TIME) {
          onEvent({ type: 'tow', phase: 'snapped' });
          this._finish(false); // towed car stays put
          break;
        }
        // out of car timer
        if (!inCar) this.outTime += dt;
        if (this.outTime > MAX_OUT) {
          onEvent({ type: 'tow', phase: 'failed' });
          this._finish(false);
          break;
        }
        // arrival: the towed car must reach the ring
        if (Math.hypot(this.car.position.x - this.destination.x, this.car.position.z - this.destination.z) <= DELIVER_R) {
          const pay = Math.round(TOW.BASE_PAY + TOW.PER_METER * this.towDistance);
          let bonus = 0;
          if (this.towingTime < this.towDistance / PAR_SPEED) bonus += TOW.BONUS_FAST;
          if (this.towedDamage < 20) bonus += TOW.BONUS_CLEAN;
          this.currentPay = pay + bonus;
          onEvent({ type: 'tow', phase: 'paid', pay, bonus });
          this._finish(true);
        }
        break;
      }

      case 'PAID':
      case 'FAILED':
        if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown <= 0) {
          this._removeCar();
          this.state = 'IDLE';
        }
        break;
    }
  }
}
