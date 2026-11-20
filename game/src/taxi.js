// taxi: the Costa Cab fare job. Drive to a lit stand, stop within 6 m, a passenger walks to the car, then run them 250 m+ to a bobbing yellow ring. States: IDLE -> TO_PICKUP -> TO_DROPOFF -> (PAID | FAILED) -> 20 s cooldown -> IDLE.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const TAXI = {
  BASE_FARE: 120,
  PER_METER: 0.9,
  TIP_FAST: 250,
  TIP_CLEAN: 200,
};

const PICKUP_R = 6;
const PICKUP_SPEED = 1; // m/s: the car must be stopped
const DROP_R = 6;
const MIN_TRIP = 250; // destination is at least this far (straight line) from the stand
const PAR_SPEED = 14; // m/s: beating distance / 14 earns the fast tip
const CLEAN_DAMAGE = 30; // health points of damage allowed for the clean tip
const OUT_LIMIT = 20; // s out of the car during TO_DROPOFF before the passenger bails
const COOLDOWN = 20;
const WALK_TIME = 1.5;
const STAND_COUNT = 6;
const SEA_Z = 330; // intersections south of this are beach/sea

// Rings share one geometry and material; each Marker owns its own mesh so it can sit at its own spot.
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
const pawnGeom = new THREE.BoxGeometry(0.5, 1.7, 0.4);
const pawnMat = new THREE.MeshLambertMaterial({ color: 0x3355ff });
const headGeom = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const headMat = new THREE.MeshLambertMaterial({ color: 0xf0c9a0 });

class Marker {
  constructor(scene) {
    this.mesh = new THREE.Mesh(ringGeom, ringMat);
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

// Passenger figure: boxes only. Walks from the stand to the car in WALK_TIME seconds, then disappears.
class Passenger {
  constructor(scene) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(pawnGeom, pawnMat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.9;
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
  // Returns true on the frame the walk finishes.
  update(dt) {
    if (!this.active) return false;
    this.t = Math.min(1, this.t + dt / WALK_TIME);
    this.group.position.lerpVectors(this.from, this.to, this.t);
    this.group.position.y = this.from.y + Math.abs(Math.sin(this.t * Math.PI * 4)) * 0.08;
    if (this.t >= 1) {
      this.hide();
      return true;
    }
    return false;
  }
  hide() {
    this.group.visible = false;
    this.active = false;
  }
}

export class TaxiService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    // Anchors are the road intersections of the generated grid (xs x zs), inland of the beach. Stands are STAND_COUNT of them spread by farthest-point sampling.
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < SEA_Z) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 4099 + 17);
    this.stands = this._spreadStands(this.anchors, STAND_COUNT);
    this.activeStand = null;
    this.destination = null;
    this.state = 'IDLE';
    this.cooldown = 0;
    this.time = 0;
    this.marker = new Marker(scene);
    this.destinationMarker = new Marker(scene);
    this.passenger = new Passenger(scene);
    this.boarding = false; // the passenger is still walking to the car
    this.outTime = 0;
    this.lastPos = null;
    this.carPos = null;
    this.trip = { distance: 0, time: 0, damage: 0 };
  }

  _spreadStands(list, n) {
    if (list.length === 0) return [];
    const picked = [this.rng.pick(list)];
    while (picked.length < Math.min(n, list.length)) {
      let best = null, bd = -1;
      for (const a of list) {
        const d = Math.min(...picked.map((p) => Math.hypot(a.x - p.x, a.z - p.z)));
        if (d > bd) { bd = d; best = a; }
      }
      picked.push(best);
    }
    return picked;
  }

  _groundY(x, z) {
    return (this.world.layout.groundHeightAt ? this.world.layout.groundHeightAt(x, z) : 0) + 0.08;
  }

  // Pick the next stand (never the one just used when there is a choice).
  _pickStand() {
    if (this.stands.length === 0) return false;
    const pool = this.stands.length > 1 ? this.stands.filter((s) => s !== this.activeStand) : this.stands;
    this.activeStand = this.rng.pick(pool);
    this.marker.setPos(this.activeStand.x, this._groundY(this.activeStand.x, this.activeStand.z), this.activeStand.z);
    return true;
  }

  // Put the service on a given stand right away (used by the ?shot=taxi staging).
  forceStand(stand) {
    this.activeStand = stand;
    this.marker.setPos(stand.x, this._groundY(stand.x, stand.z), stand.z);
    this.state = 'TO_PICKUP';
    this.cooldown = 0;
  }

  // Select a destination anchor at least MIN_TRIP away from the pickup.
  _pickDestination() {
    const s = this.activeStand;
    let pool = this.anchors.filter((a) => Math.hypot(a.x - s.x, a.z - s.z) >= MIN_TRIP);
    if (pool.length === 0) pool = this.anchors.filter((a) => a !== s);
    this.destination = this.rng.pick(pool);
    this.destinationMarker.setPos(this.destination.x, this._groundY(this.destination.x, this.destination.z), this.destination.z);
  }

  targetPos() {
    if (this.state === 'TO_PICKUP' && this.activeStand) return { x: this.activeStand.x, z: this.activeStand.z };
    if (this.state === 'TO_DROPOFF' && this.destination && !this.boarding) return { x: this.destination.x, z: this.destination.z };
    return null;
  }

  _finish(success) {
    this.state = success ? 'PAID' : 'FAILED';
    this.cooldown = COOLDOWN;
    this.marker.hide();
    this.destinationMarker.hide();
    this.passenger.hide();
    this.boarding = false;
    this.destination = null;
  }

  _par() {
    return this.trip.distance / PAR_SPEED;
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, carDamageDelta, onEvent } = ctx;
    this.time += dt;
    this.carPos = carPos;
    this.marker.bob(this.time);
    this.destinationMarker.bob(this.time);

    switch (this.state) {
      case 'IDLE':
        if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown <= 0 && this._pickStand()) this.state = 'TO_PICKUP';
        break;

      case 'TO_PICKUP': {
        if (!inCar || Math.abs(carSpeed) >= PICKUP_SPEED) break;
        const s = this.activeStand;
        if (Math.hypot(carPos.x - s.x, carPos.z - s.z) > PICKUP_R) break;
        this.passenger.start(s.x, this._groundY(s.x, s.z), s.z, carPos.x, carPos.z);
        this.trip = { distance: 0, time: 0, damage: 0 };
        this.lastPos = { x: carPos.x, z: carPos.z };
        this.outTime = 0;
        this.boarding = true;
        this.marker.hide();
        this.state = 'TO_DROPOFF';
        if (onEvent) onEvent({ type: 'taxi', phase: 'pickup' });
        break;
      }

      case 'TO_DROPOFF': {
        if (this.boarding && this.passenger.update(dt)) {
          this.boarding = false;
          this._pickDestination(); // the destination activates once the passenger is in
        }
        this.trip.time += dt;
        if (!inCar) {
          this.outTime += dt;
          if (this.outTime > OUT_LIMIT) {
            this._finish(false);
            if (onEvent) onEvent({ type: 'taxi', phase: 'failed' });
          }
          this.lastPos = { x: carPos.x, z: carPos.z };
          break;
        }
        this.outTime = 0;
        this.trip.distance += Math.hypot(carPos.x - this.lastPos.x, carPos.z - this.lastPos.z);
        this.lastPos = { x: carPos.x, z: carPos.z };
        this.trip.damage += Math.max(0, carDamageDelta || 0);
        if (!this.boarding && this.destination && Math.hypot(carPos.x - this.destination.x, carPos.z - this.destination.z) <= DROP_R) {
          const fare = Math.round(TAXI.BASE_FARE + TAXI.PER_METER * this.trip.distance);
          const tip = (this.trip.time < this._par() ? TAXI.TIP_FAST : 0) + (this.trip.damage < CLEAN_DAMAGE ? TAXI.TIP_CLEAN : 0);
          this._finish(true);
          if (onEvent) onEvent({ type: 'taxi', phase: 'paid', fare, tip });
        }
        break;
      }

      case 'PAID':
      case 'FAILED':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown <= 0) this.state = 'IDLE';
        break;
    }
  }

  hudState() {
    if (this.state !== 'TO_PICKUP' && this.state !== 'TO_DROPOFF') return { visible: false, label: '', fare: 0, tip: 0, distanceLeft: 0 };
    const t = this.targetPos();
    const distanceLeft = t && this.carPos ? Math.hypot(t.x - this.carPos.x, t.z - this.carPos.z) : 0;
    if (this.state === 'TO_PICKUP') return { visible: true, label: 'TAXI: PICK UP FARE', fare: 0, tip: 0, distanceLeft };
    const fare = Math.round(TAXI.BASE_FARE + TAXI.PER_METER * this.trip.distance);
    const tip = (this.trip.time < this._par() ? TAXI.TIP_FAST : 0) + (this.trip.damage < CLEAN_DAMAGE ? TAXI.TIP_CLEAN : 0);
    return { visible: true, label: this.boarding ? 'TAXI: BOARDING' : 'TAXI: DROP OFF', fare, tip, distanceLeft };
  }
}
