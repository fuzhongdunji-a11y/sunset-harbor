// StuntHaulerEvent: the Sky-Ad Stunt Hauler. A safety-yellow ramp truck cruises a straight avenue at 25 km/h with a 22 degree ramp lowered at its tail and a
// tethered neon "COSTA COLA" promo drone cube hanging 9 m above the road, 12 m past the ramp's top lip. Drive up the ramp from behind: below 65 km/h you get a
// short hop and $100 of air time (the cube stays); at 65 km/h and up the lip boosts you into the cube: 16 neon shards, 2 s of 0.4x slow-motion from a side camera,
// +$850 and a full repair. A sanctioned stunt: it never adds a wanted star. The truck's cab is locked; it leaves when you are 250 m away.
import * as THREE from '../../vendor/three.module.min.js';
import { RoadDriver } from '../roadDriver.js';
import { LANE } from '../roadNet.js';
import { spotFree } from '../traffic.js';
import { RAMP_ANGLE, RAMP_LIP_Z, RAMP_LIP_Y, RAMP_REAR_Z, RAMP_WID, rampHeightAt, buildChevronPlane } from './HaulerModel.js';
import { CUBE_SIZE, SHARD_COUNT, makeChevronTexture, makeCubeTexture, buildDroneCube, buildTether, buildShards } from './HaulerArt.js';

export const HAULER_CRUISE = 25 / 3.6; // 25 km/h
export const HAULER_NOTICE = 130; // caption and minimap icon range
export const JINGLE_RANGE = 100;
const LEAVE_DIST = 250;
const CUBE_AHEAD = 12; // metres past the ramp's top lip
const CUBE_UP = 9; // centre height above the road
const SMASH_KMH = 65;
const BOOST = 5.7; // extra upward speed at the lip when fast enough (m/s): puts the car through the cube from 65 km/h up to well past 100
const MIN_VREL = 5; // slowest launch speed relative to the truck (m/s), so a crawl still clears the cab
const HIT_R = 2.2; // car sphere radius against the cube's box
const SLOMO_SCALE = 0.4;
const SLOMO_REAL = 2.0; // seconds of real time
const BLEND_BACK = 0.45;
const CAM_SIDE = 9.5;
const CAM_UP = 6.8;
const CAM_FOV = 52;
const SHARD_LIFE = 2.4;
const AIR_MIN = 0.45; // airtime that counts as a jump
const SMASH_PAY = 850;
const AIR_PAY = 100;
const LABEL = '[AMBIENT] Promo Stunt Hauler Nearby';

const up = new THREE.Vector3(0, 1, 0);
const dummy = new THREE.Object3D();
const smooth = (u) => u * u * (3 - 2 * u);

// Does a hauler fit here? A clear lane stretch (no parked or moving car within 14 m) on open ground.
export function haulerFits(world, spot) {
  return spotFree(world.vehicles.list, spot.x, spot.z, 14) && world.collision.isFree(spot.x, spot.z, 2.2);
}

export class StuntHaulerEvent {
  constructor(world, scene, spot) {
    this.kind = 'hauler';
    this.world = world;
    this.scene = scene;
    this.spot = spot;
    this.state = 'cruise'; // cruise -> slomo -> spent
    this.t = 0;
    this.dist = Infinity;
    this.announced = false;
    this.onRamp = false;
    this.flight = null; // {kmh, hit} for the player's current jump
    this.airPaid = false;
    this.slowT = 0;
    this.camSide = 1;
    this.seed = 7;
    this.cubeCenter = new THREE.Vector3();

    world.traffic.clearArea(spot.x, spot.z, 14, world.focusPoint);
    const truck = (this.truck = world.vehicles.spawnHauler(spot.x, spot.z, spot.h));
    truck.ambientEvent = this;
    this.drv = new RoadDriver(truck, world.net, world.traffic.rng, { cruise: HAULER_CRUISE, straight: true });
    this.drv.place(spot.i, spot.j, spot.d, spot.along);

    this.chevTex = makeChevronTexture();
    this.chevrons = buildChevronPlane(this.chevTex);
    truck.chassis.add(this.chevrons);
    this.cubeTex = makeCubeTexture();
    this.drone = buildDroneCube(this.cubeTex);
    this.tether = buildTether();
    this.shards = buildShards(scene);
    scene.add(this.drone.group, this.tether);
    this.shard = Array.from({ length: SHARD_COUNT }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), ang: 0, spin: 0, base: 1 }));
    this._animate(0);
  }

  // World point `z` metres along the truck (from its centre) and `y` above the road.
  _at(z, y, out = new THREE.Vector3()) {
    const tr = this.truck;
    return out.set(tr.x + Math.sin(tr.h) * z, tr.y + y, tr.z + Math.cos(tr.h) * z);
  }

  // Minimap marker: while the cube is still tethered or the smash is playing out.
  get mapIcon() {
    return this.state !== 'spent' && this.dist <= HAULER_NOTICE ? { x: this.truck.x, z: this.truck.z, h: this.truck.h, kind: 'hauler' } : null;
  }

  // True while the jingle should play (cube up, player within 100 m).
  get jingleOn() {
    return this.state === 'cruise' && this.dist < JINGLE_RANGE;
  }

  lockedNear(x, z) {
    return this.truck.distanceTo(x, z) < 3;
  }

  // ---- AI and physics hooks (called by the director) ----
  drive(dt, ctx) {
    this.drv.update(dt, ctx);
  }

  // Every physics sub-step: put the player's car on the ramp surface, launch it at the lip, test the cube, notice touchdown.
  step() {
    const car = this.world.player.vehicle;
    if (!car) {
      this.flight = null;
      this._leaveRamp(null);
      return;
    }
    if (car.airborne) {
      if (this.flight && !this.flight.hit && this.state === 'cruise') this._testCube(car);
      return;
    }
    if (this.flight) this._touchdown(car);
    this._ramp(car);
  }

  _leaveRamp(car) {
    this.onRamp = false;
    if (car && car.onRampOf === this.truck) car.onRampOf = null;
  }

  _ramp(car) {
    const tr = this.truck;
    const [r, f] = tr._local(car.x, car.z);
    if (!this.onRamp) {
      if (Math.abs(r) < RAMP_WID / 2 - 0.1 && f > RAMP_REAR_Z + 0.2 && f < RAMP_LIP_Z - 0.3 && car.y - tr.y < 1.5) {
        this.onRamp = true;
        car.onRampOf = tr; // the ramp is not a wall: the truck's cab does not stop a car that is driving up it
      } else {
        return;
      }
    }
    if (Math.abs(r) > RAMP_WID / 2 + 0.3 || f < RAMP_REAR_Z - 0.3) {
      this._leaveRamp(car);
      return;
    }
    if (f >= RAMP_LIP_Z) {
      this._launch(car);
      return;
    }
    const s = smooth(Math.min(1, Math.max(0, (f - RAMP_REAR_Z) / 1.4)));
    car.y = tr.y + rampHeightAt(f);
    car.pitch = -RAMP_ANGLE * s;
  }

  // Off the lip: ballistic flight in the truck's frame of reference, boosted when fast enough to reach the cube.
  _launch(car) {
    const tr = this.truck;
    const fx = Math.sin(tr.h), fz = Math.cos(tr.h);
    let vr = (car.vx - tr.vx) * fx + (car.vz - tr.vz) * fz; // speed relative to the truck, along it
    if (vr < MIN_VREL) {
      car.vx += fx * (MIN_VREL - vr);
      car.vz += fz * (MIN_VREL - vr);
      vr = MIN_VREL;
    }
    const kmh = car.speedKmh;
    const fast = kmh >= SMASH_KMH;
    car.vy = vr * Math.tan(RAMP_ANGLE) + (fast ? BOOST : 0);
    car.y = tr.y + RAMP_LIP_Y;
    car.airborne = true;
    car.airTime = 0;
    this._leaveRamp(car);
    this.flight = { kmh, hit: false };
    if (fast) this.world.emit('ambLaunch');
  }

  // The car (a sphere) against the 3 m cube (a box), both in world space.
  _testCube(car) {
    const c = this.cubeCenter, hh = CUBE_SIZE / 2;
    const dx = Math.max(Math.abs(car.x - c.x) - hh, 0);
    const dy = Math.max(Math.abs(car.y + 0.8 - c.y) - hh, 0);
    const dz = Math.max(Math.abs(car.z - c.z) - hh, 0);
    if (dx * dx + dy * dy + dz * dz < HIT_R * HIT_R && this.flight.kmh >= SMASH_KMH - 5) this._smash(car);
  }

  // Wheels back on the ground: a jump that missed the cube (or was too slow for it) pays once per hauler.
  _touchdown(car) {
    const f = this.flight;
    this.flight = null;
    if (f.hit || this.airPaid || car.airTime < AIR_MIN) return;
    const w = this.world;
    this.airPaid = true;
    w.cash += AIR_PAY;
    w.saveRequested = true;
    w.notify(`AIR TIME  +$${AIR_PAY}`, 'air');
    w.emit('ambAir');
  }

  // ---- the smash ----
  _rand() {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  _smash(car) {
    const w = this.world, tr = this.truck;
    this.flight.hit = true;
    this.state = 'slomo';
    this.slowT = 0;
    w.timeScale = SLOMO_SCALE;
    this.drone.group.visible = false;
    this.tether.visible = false;

    // camera side: whichever flank of the street is open further out (the building line is the limit)
    const nx = Math.cos(tr.h), nz = -Math.sin(tr.h); // the truck's left
    const mid = this._at(RAMP_LIP_Z + CUBE_AHEAD / 2, 0);
    const room = (sgn) => {
      let d = 0;
      while (d < 16 && w.collision.isFree(mid.x + nx * sgn * (d + 1.5), mid.z + nz * sgn * (d + 1.5), 0.8)) d += 1.5;
      return d;
    };
    this.camSide = room(1) >= room(-1) ? 1 : -1;

    // shards: two big face panels flung toward the camera, fourteen radiating (magenta / cyan / yellow)
    const C = this.cubeCenter, fx = Math.sin(tr.h), fz = Math.cos(tr.h);
    this.shards.visible = true;
    this.shardAge = 0;
    this.shard.forEach((s, k) => {
      s.p.copy(C);
      s.ang = this._rand() * 6;
      s.axis.set(this._rand() - 0.5, this._rand() - 0.5, this._rand() - 0.5).normalize();
      s.spin = (this._rand() < 0.5 ? -1 : 1) * 6;
      if (k < 2) {
        const along = k === 0 ? -0.45 : 0.45;
        s.v.set(nx * this.camSide * 0.9 + fx * along, 0.35, nz * this.camSide * 0.9 + fz * along).multiplyScalar(6.5);
        s.base = 2.2;
        s.spin = k === 0 ? 3 : -3;
      } else {
        const a = this._rand() * Math.PI * 2, sp = 9 + this._rand() * 9;
        s.v.set(Math.cos(a) * sp, 4 + this._rand() * 6, Math.sin(a) * sp);
        s.base = 0.8 + this._rand() * 0.6;
      }
      s.v.x += tr.vx;
      s.v.z += tr.vz;
    });
    this._moveShards(0);

    w.cash += SMASH_PAY;
    w.saveRequested = true;
    car.health = 100; // full repair; no star: the stunt is sanctioned
    w.notify(`STUNT SMASH!  +$${SMASH_PAY}\nVEHICLE REPAIRED 100%`, 'stunt');
    w.emit('ambShatter');
    w.emit('ambStunt');
  }

  _moveShards(dt) {
    this.shardAge += dt;
    const u = this.shardAge / SHARD_LIFE;
    this.shards.visible = u < 1;
    this.shard.forEach((s, k) => {
      s.v.y -= 9.81 * dt;
      s.p.addScaledVector(s.v, dt);
      s.ang += s.spin * dt;
      dummy.position.copy(s.p);
      dummy.quaternion.setFromAxisAngle(s.axis, s.ang);
      dummy.scale.setScalar(Math.max(0.001, s.base * (1 - u)));
      dummy.updateMatrix();
      this.shards.setMatrixAt(k, dummy.matrix);
    });
    this.shards.instanceMatrix.needsUpdate = true;
  }

  // Screenshot hook (?shot=hauler): freeze the instant the car punches through the cube, `seconds` into the slow-motion.
  showcaseSmash(car, seconds) {
    const tr = this.truck;
    const at = this._at(RAMP_LIP_Z + CUBE_AHEAD + 1.1, 0); // just past the cube's centre: the car has already driven through the near face
    car.x = at.x;
    car.z = at.z;
    car.h = tr.h;
    car.y = tr.y + 8.0;
    car.pitch = -19 * (Math.PI / 180);
    car.airborne = true;
    car.vx = Math.sin(tr.h) * 22;
    car.vz = Math.cos(tr.h) * 22;
    car.speedF = 22;
    car.vy = 4;
    car._syncMesh();
    this._animate(0);
    this.flight = { kmh: 80, hit: false };
    this._smash(car);
    this.slowT = seconds;
    this.dist = Math.hypot(this.world.player.px - tr.x, this.world.player.pz - tr.z); // the frozen frame never runs update(): the minimap icon needs this
    this._moveShards(seconds); // the picture is taken 0.18 s of world time after the impact
    this.world.timeScale = 0;
  }

  // ---- per-frame ----
  _animate(gameDt) {
    const tr = this.truck;
    this.chevTex.offset.y -= 1.8 * gameDt;
    const spent = this.state !== 'cruise';
    const bob = Math.sin(this.t * 2.0) * 0.35;
    this._at(RAMP_LIP_Z + CUBE_AHEAD, CUBE_UP, this.cubeCenter);
    if (this.state === 'cruise') this.cubeCenter.y = tr.y + CUBE_UP + bob;
    this.drone.group.position.copy(this.cubeCenter);
    this.drone.group.rotation.y = this.t * 1.4;
    this.drone.group.visible = !spent;
    this.tether.visible = !spent;
    if (!spent) {
      const a = this._at(2.7, 3.05), b = new THREE.Vector3(this.cubeCenter.x, this.cubeCenter.y - CUBE_SIZE / 2, this.cubeCenter.z);
      const dir = b.clone().sub(a);
      const len = dir.length();
      this.tether.position.copy(a).addScaledVector(dir, 0.5);
      this.tether.scale.set(1, len, 1);
      this.tether.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
    }
  }

  // Side stunt camera: pulled over the rig's own camera after it has updated, then blended back to the chase view.
  _camera() {
    const t = this.slowT;
    if (t >= SLOMO_REAL + BLEND_BACK) return;
    const w = this.world, cam = w.camera, tr = this.truck;
    const k = t < SLOMO_REAL ? 1 : 1 - smooth((t - SLOMO_REAL) / BLEND_BACK);
    const nx = Math.cos(tr.h) * this.camSide, nz = -Math.sin(tr.h) * this.camSide;
    const car = w.player.vehicle;
    const lip = this._at(RAMP_LIP_Z, 0), cube = this.cubeCenter;
    const mx = (lip.x + cube.x) / 2, mz = (lip.z + cube.z) / 2;
    const pos = new THREE.Vector3(mx + nx * CAM_SIDE, tr.y + CAM_UP, mz + nz * CAM_SIDE);
    const look = new THREE.Vector3(((car?.x ?? cube.x) + cube.x) / 2, ((car ? car.y + 0.8 : cube.y) + cube.y) / 2, ((car?.z ?? cube.z) + cube.z) / 2);
    cam.position.lerp(pos, k);
    cam.lookAt(w.rig.target.clone().lerp(look, k));
    cam.fov += (CAM_FOV - cam.fov) * k;
    cam.updateProjectionMatrix();
  }

  // Real-time update. Returns false once the event is over (truck 250 m away or removed).
  update(dt) {
    const w = this.world, p = w.player;
    const gameDt = dt * w.timeScale;
    this.t += dt;
    this.dist = Math.hypot(p.px - this.truck.x, p.pz - this.truck.z);
    if (!w.vehicles.list.includes(this.truck) || this.dist > LEAVE_DIST) return false;
    if (!this.announced && this.dist <= HAULER_NOTICE && this.state === 'cruise') {
      this.announced = true;
      w.ambientCaption = { text: LABEL, t: 3, color: '#ff55dd' };
    }
    this._animate(gameDt);
    if (this.state === 'slomo') {
      this.slowT += dt;
      this._moveShards(gameDt);
      if (this.slowT >= SLOMO_REAL && w.timeScale !== 1) w.timeScale = 1;
      if (this.slowT >= SLOMO_REAL + BLEND_BACK) this.state = 'spent';
      this._camera();
    }
    return true;
  }

  dispose() {
    const w = this.world, tr = this.truck;
    if (this.state === 'slomo' || w.timeScale !== 1) w.timeScale = 1;
    const car = w.player.vehicle;
    if (car) this._leaveRamp(car);
    this.scene.remove(this.drone.group, this.tether, this.shards);
    tr.chassis.remove(this.chevrons);
    for (const m of [this.drone.cube, this.drone.rotors, this.tether, this.shards, this.chevrons]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.shards.dispose();
    this.chevTex.dispose();
    this.cubeTex.dispose();
    tr.ambientEvent = null;
    w.vehicles.remove(tr);
  }
}

export const HAULER_DEF = {
  curb: LANE, // the truck drives in the right-hand lane
  aligned: true, // on a road that runs the way the player is heading, so the ramp faces them
  fits: haulerFits,
  create: (world, scene, spot) => new StuntHaulerEvent(world, scene, spot),
};
