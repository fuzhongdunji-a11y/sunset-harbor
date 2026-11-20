// photoTour: the Sunset Photo Tour job. Drive to a lit stand, pick up a tourist, then take photos at 3 spots across the city. States: IDLE -> TO_PICKUP -> TOUR -> (PAID | FAILED) -> 20 s cooldown -> IDLE.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// Money routing (single source of truth, main.js follows it): every photo pays PER_SPOT through its own 'photo' event (pay field).
// The final 'paid' event carries ONLY the remainder: BASE_PAY + tips (pay = BASE_PAY + tip). Nothing is paid twice.
export const PHOTO_TOUR = {
  BASE_PAY: 150,
  PER_SPOT: 200,
  TIP_FAST: 300,
  TIP_SMOOTH: 250,
};

const SPOT_COUNT = 3;
const CLEAN_DAMAGE = 30; // health points of damage allowed for the smooth tip
const PAR_SPEED = 14; // m/s: beating DRIVEN distance / 14 earns the fast tip
const SHOOT_OFFSET = 2.6; // m: the tourist stands beside the car while shooting

// Constants mirrored from taxi.js
const PICKUP_R = 6; // distance to stand for pickup
const PICKUP_SPEED = 1; // car must be stopped under 1 m/s
const STAND_COUNT = 6;
const SEA_Z = 330; // intersections south of this are beach/sea
const OUT_LIMIT = 20; // s out of the car during TOUR before failing
const COOLDOWN = 20;
const WALK_TIME = 1.5;
const SHOOT_R = 8; // distance to spot ring for shooting
const SHOOT_TIME = 1.2; // time tourist stays outside
const MIN_SPOT_DISTANCE = 150;

// Ring geometry and material for tourist spots
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffa500, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });

// Tourist figure: simple low‑poly boxes with a camera box
const bodyGeom = new THREE.BoxGeometry(0.5, 1.7, 0.4);
const bodyMat = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
const headGeom = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const headMat = new THREE.MeshLambertMaterial({ color: 0xffe0b2 });
const camGeom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const camMat = new THREE.MeshLambertMaterial({ color: 0x000000 });

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

class Tourist {
  constructor(scene) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.85;
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.9;
    const cam = new THREE.Mesh(camGeom, camMat);
    cam.position.y = 2.0;
    cam.position.z = -0.3;
    g.add(body, head, cam);
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
  // Stand still at a point (stepped out of the car for a photo); not a walk, so update() ignores it.
  stand(x, y, z, faceX, faceZ) {
    this.active = false;
    this.group.position.set(x, y, z);
    this.group.rotation.y = Math.atan2(faceX - x, faceZ - z);
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

export class PhotoTourService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    // Anchors: road intersections inland of beach (z < SEA_Z)
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < SEA_Z) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 4099 + 17);
    this.stands = this._spreadStands(this.anchors, STAND_COUNT);
    this.activeStand = null;
    this.spots = this._pickSpots(); // chosen once: fixed for every tour
    this.activeSpotIndex = 0;
    this.state = 'IDLE';
    this.cooldown = 0;
    this.time = 0;
    this.marker = new Marker(scene);
    this.spotMarker = new Marker(scene);
    this.passenger = new Tourist(scene);
    this.boarding = false;
    this.outTime = 0;
    this.lastPos = null;
    this.carPos = null;
    this.trip = { distance: 0, time: 0, damage: 0 };
    this.shooting = false;
    this.shootTimer = 0;
    this.spotsDone = 0;
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

  // Farthest-point sampling from a random seed anchor (rng is the layout-seeded stream, so spots are deterministic per seed).
  // Every pair must be >= MIN_SPOT_DISTANCE apart; retry from another seed anchor otherwise.
  _pickSpots() {
    if (this.anchors.length === 0) return [];
    for (let attempt = 0; attempt < 1000; attempt++) {
      const picked = [this.rng.pick(this.anchors)];
      while (picked.length < Math.min(SPOT_COUNT, this.anchors.length)) {
        let best = null, bd = -1;
        for (const cand of this.anchors) {
          const d = Math.min(...picked.map((p) => Math.hypot(cand.x - p.x, cand.z - p.z)));
          if (d > bd) { bd = d; best = cand; }
        }
        picked.push(best);
      }
      let ok = picked.length === SPOT_COUNT;
      for (let i = 0; ok && i < picked.length; i++) {
        for (let j = i + 1; j < picked.length; j++) {
          if (Math.hypot(picked[i].x - picked[j].x, picked[i].z - picked[j].z) < MIN_SPOT_DISTANCE) { ok = false; break; }
        }
      }
      if (ok) return picked;
    }
    return this.anchors.slice(0, SPOT_COUNT); // degenerate layout: should not happen with an 80 m grid
  }

  // Put the service on a given stand right away (used by staging code).
  forceStand(stand) {
    this.activeStand = stand;
    this.marker.setPos(stand.x, this._groundY(stand.x, stand.z), stand.z);
    this.state = 'TO_PICKUP';
    this.cooldown = 0;
  }

  // Jump straight into the tour with the given spot active and the tourist already aboard (used by ?shot=photo).
  forceTour(spotIndex, spotsDone) {
    this.marker.hide();
    this.passenger.hide();
    this.trip = { distance: 0, time: 0, damage: 0 };
    this.lastPos = null;
    this.outTime = 0;
    this.boarding = false;
    this.shooting = false;
    this.shootTimer = 0;
    this.spotsDone = spotsDone;
    this.state = 'TOUR';
    this._activateSpot(spotIndex);
  }

  // The spot ring shows from the moment the spot becomes active (like taxi's destination marker).
  _activateSpot(i) {
    this.activeSpotIndex = i;
    const s = this.spots[i];
    if (s) this.spotMarker.setPos(s.x, this._groundY(s.x, s.z), s.z);
  }

  _cancelShot() {
    this.shooting = false;
    this.shootTimer = 0;
    this.passenger.hide();
  }

  _groundY(x, z) {
    return (this.world.layout.groundHeightAt ? this.world.layout.groundHeightAt(x, z) : 0) + 0.08;
  }

  _pickStand() {
    if (this.stands.length === 0) return false;
    const pool = this.stands.length > 1 ? this.stands.filter((s) => s !== this.activeStand) : this.stands;
    this.activeStand = this.rng.pick(pool);
    this.marker.setPos(this.activeStand.x, this._groundY(this.activeStand.x, this.activeStand.z), this.activeStand.z);
    return true;
  }

  targetPos() {
    if (this.state === 'TO_PICKUP' && this.activeStand) return { x: this.activeStand.x, z: this.activeStand.z };
    if (this.state === 'TOUR' && !this.boarding && this.spots[this.activeSpotIndex]) return { x: this.spots[this.activeSpotIndex].x, z: this.spots[this.activeSpotIndex].z };
    return null;
  }

  _finish(success) {
    this.state = success ? 'PAID' : 'FAILED';
    this.cooldown = COOLDOWN;
    this.marker.hide();
    this.spotMarker.hide();
    this.passenger.hide();
    this.boarding = false;
    this.activeSpotIndex = 0;
    this.shooting = false;
    this.shootTimer = 0;
    this.spotsDone = 0;
  }

  // ctx = { carPos, carSpeed, inCar, carDamageDelta, wrecked?, onEvent }
  update(dt, ctx) {
    const { carPos, carSpeed, inCar, carDamageDelta, onEvent } = ctx;
    this.time += dt;
    this.carPos = carPos;
    this.marker.bob(this.time);
    this.spotMarker.bob(this.time);

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
        this.state = 'TOUR';
        if (onEvent) onEvent({ type: 'photoTour', phase: 'pickup' });
        break;
      }

      case 'TOUR': {
        // The tourist is still walking to the car: the first spot activates only once they are in (taxi does the same).
        if (this.boarding && this.passenger.update(dt)) {
          this.boarding = false;
          this._activateSpot(0);
        }
        this.trip.time += dt; // total tour time, including boarding and photo stops
        // A wrecked car ends the tour (spot pay already paid stays; tips are lost).
        if (ctx.wrecked) {
          this._cancelShot();
          this._finish(false);
          if (onEvent) onEvent({ type: 'photoTour', phase: 'failed' });
          return;
        }
        if (!inCar) {
          this.outTime += dt;
          if (this.shooting) this._cancelShot();
          this.lastPos = { x: carPos.x, z: carPos.z }; // walking does not count as driven distance
          if (this.outTime > OUT_LIMIT) {
            this._finish(false);
            if (onEvent) onEvent({ type: 'photoTour', phase: 'failed' });
          }
          break;
        }
        this.outTime = 0; // out-of-car time is continuous: re-entering the car resets it
        // DRIVEN distance: accumulated per-frame movement, never straight-line start-to-end.
        if (this.lastPos) this.trip.distance += Math.hypot(carPos.x - this.lastPos.x, carPos.z - this.lastPos.z);
        this.lastPos = { x: carPos.x, z: carPos.z };
        this.trip.damage += Math.max(0, carDamageDelta || 0);

        const spot = this.spots[this.activeSpotIndex];
        if (this.boarding || !spot) break;
        const stopped = Math.abs(carSpeed) < PICKUP_SPEED;
        const near = Math.hypot(carPos.x - spot.x, carPos.z - spot.z) <= SHOOT_R;

        if (!this.shooting && stopped && near) {
          // The tourist steps out beside the car and holds the camera up for SHOOT_TIME.
          this.shooting = true;
          this.shootTimer = 0;
          this.passenger.stand(carPos.x + SHOOT_OFFSET, this._groundY(carPos.x, carPos.z), carPos.z, carPos.x, carPos.z);
        } else if (this.shooting && !(stopped && near)) {
          this._cancelShot(); // the player drove off mid-shot: the photo is lost, the ring stays up
        }

        if (this.shooting) {
          this.shootTimer += dt;
          if (this.shootTimer >= SHOOT_TIME) {
            const idx = this.activeSpotIndex;
            this._cancelShot(); // tourist climbs back in
            this.spotMarker.hide();
            this.spotsDone += 1;
            // The flash fires when the photo is actually taken (end of the shoot), together with the per-photo pay.
            if (onEvent) {
              onEvent({ type: 'photo', flash: true, spot: idx });
              onEvent({ type: 'photo', spot: idx, pay: PHOTO_TOUR.PER_SPOT });
            }
            if (this.spotsDone >= SPOT_COUNT) {
              const tipSmooth = this.trip.damage < CLEAN_DAMAGE ? PHOTO_TOUR.TIP_SMOOTH : 0;
              const tipFast = this.trip.time < this.trip.distance / PAR_SPEED ? PHOTO_TOUR.TIP_FAST : 0;
              const tip = tipSmooth + tipFast;
              // pay = remainder only (photos were paid one by one, see the routing note at the top)
              this._finish(true);
              if (onEvent) onEvent({ type: 'photoTour', phase: 'paid', pay: PHOTO_TOUR.BASE_PAY + tip, base: PHOTO_TOUR.BASE_PAY, tip });
            } else {
              this._activateSpot(idx + 1);
            }
          }
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
    if (this.state !== 'TO_PICKUP' && this.state !== 'TOUR') return { visible: false, label: '', pay: 0, spotsDone: 0, spotsTotal: SPOT_COUNT, distanceLeft: 0 };
    const t = this.targetPos();
    const distanceLeft = t && this.carPos ? Math.hypot(t.x - this.carPos.x, t.z - this.carPos.z) : 0;
    let label;
    if (this.state === 'TO_PICKUP') label = 'PHOTO TOUR: PICK UP';
    else if (this.boarding) label = 'PHOTO TOUR: BOARDING';
    else label = `PHOTO TOUR: ${this.spotsDone}/${SPOT_COUNT} PHOTOS`;
    // "pay so far" = what the run is worth now (base + photos taken); tips are settled at the end
    const pay = this.state === 'TOUR' ? PHOTO_TOUR.BASE_PAY + this.spotsDone * PHOTO_TOUR.PER_SPOT : 0;
    return { visible: true, label, pay, spotsDone: this.spotsDone, spotsTotal: SPOT_COUNT, distanceLeft };
  }
}
