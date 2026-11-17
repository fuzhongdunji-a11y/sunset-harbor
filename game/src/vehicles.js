// vehicles: arcade car physics (grip, drift, handbrake, wall and car collisions) and the manager that owns every car.
import { CAR_TYPES, buildCarModel } from './vehicleModels.js';

const IDLE_INPUT = { throttle: 0, steer: 0, hand: false };
const CULL_FAR = 420; // beyond this a car is hidden (fog is nearly opaque by then)
const WHEEL_NEAR = 95; // wheels are only drawn inside this range

export class Vehicle {
  constructor(typeKey, paint, x, z, heading) {
    this.typeKey = typeKey;
    this.type = CAR_TYPES[typeKey];
    this.paint = paint;
    this.x = x;
    this.z = z;
    this.y = 0.04;
    this.h = heading;
    this.vx = 0;
    this.vz = 0;
    this.steer = 0;
    this.speedF = 0; // signed forward speed, m/s
    this.driver = null;
    this.input = { throttle: 0, steer: 0, hand: false };
    this.impact = 0; // strongest collision this frame (m/s), read by camera shake
    this.roll = 0;
    this.pitch = 0;
    this.kind = 'parked'; // 'parked' | 'traffic' | 'police' (drives minimap colour and AI rules)
    this.health = 100;
    this.locked = false; // police cruisers and wrecks cannot be entered
    this.wrecked = false;
    this.contact = null; // the car we touched this step
    this.wheelsShown = true;
    const model = buildCarModel(typeKey, paint);
    this.group = model.group;
    this.chassis = model.chassis;
    this.wheels = model.wheels;
    this.wheelRadius = model.wheelRadius;
    this.lights = model.lights ?? null; // police light bar {red, blue}
    this._syncMesh();
  }

  get forward() {
    return [Math.sin(this.h), Math.cos(this.h)];
  }

  get speedKmh() {
    return Math.abs(this.speedF) * 3.6;
  }

  // Distance from a world point to the car's oriented rectangle (0 when inside).
  distanceTo(x, z) {
    const [a, b] = this._local(x, z);
    const ex = Math.max(Math.abs(a) - this.type.wid / 2, 0);
    const ez = Math.max(Math.abs(b) - this.type.len / 2, 0);
    return Math.hypot(ex, ez);
  }

  _local(x, z) {
    const dx = x - this.x, dz = z - this.z;
    const s = Math.sin(this.h), c = Math.cos(this.h);
    return [-c * dx + s * dz, s * dx + c * dz]; // [right, forward]
  }

  // Push a circle (pedestrian) out of this car; returns {nx, nz, depth} or null.
  pushOutCircle(x, z, r) {
    const [a, b] = this._local(x, z);
    const hw = this.type.wid / 2, hl = this.type.len / 2;
    const pa = Math.min(Math.max(a, -hw), hw), pb = Math.min(Math.max(b, -hl), hl);
    let da = a - pa, db = b - pb;
    let d = Math.hypot(da, db);
    let depth;
    if (d > 1e-6) {
      if (d >= r) return null;
      depth = r - d;
      da /= d;
      db /= d;
    } else {
      const ma = hw - Math.abs(a), mb = hl - Math.abs(b);
      if (ma < mb) {
        da = Math.sign(a) || 1;
        db = 0;
        depth = ma + r;
      } else {
        da = 0;
        db = Math.sign(b) || 1;
        depth = mb + r;
      }
    }
    const s = Math.sin(this.h), c = Math.cos(this.h);
    return { nx: -c * da + s * db, nz: s * da + c * db, depth };
  }

  // True while an AI or the player is at the wheel.
  get driven() {
    return !!this.driver;
  }

  update(dt, collision, groundHeightAt) {
    // parked cars at rest skip the whole step
    if (!this.driver && this.vx === 0 && this.vz === 0 && Math.abs(this.speedF) < 1e-3 && !this.wake) return;
    this.wake = false;
    const T = this.type;
    const driven = !!this.driver;
    const inp = driven ? this.input : IDLE_INPUT;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    let vF = this.vx * sh + this.vz * ch;
    let vR = -this.vx * ch + this.vz * sh;

    if (driven) {
      if (inp.throttle > 0) {
        if (vF < -0.5) vF = Math.min(0, vF + T.brake * dt);
        else vF += T.accel * inp.throttle * (1 - Math.max(0, vF) / T.maxSpeed) * dt;
      } else if (inp.throttle < 0) {
        if (vF > 0.5) vF = Math.max(0, vF - T.brake * dt);
        else vF = Math.max(-T.maxReverse, vF - T.accel * 0.55 * dt);
      } else {
        const drag = (1.4 + Math.abs(vF) * 0.09) * dt;
        vF = Math.abs(vF) <= drag ? 0 : vF - Math.sign(vF) * drag;
      }
      if (inp.hand) vF *= Math.exp(-1.7 * dt);
    } else {
      // parked: strong friction so bumped cars roll to a stop quickly
      const drag = (6 + Math.abs(vF) * 0.3) * dt;
      vF = Math.abs(vF) <= drag ? 0 : vF - Math.sign(vF) * drag;
    }
    const grip = driven ? (inp.hand ? 1.7 : 8.5 - 3 * Math.min(1, Math.abs(vF) / 36)) : 9;
    vR *= Math.exp(-grip * dt);

    const maxSteer = 0.58 / (1 + Math.pow(Math.abs(vF) / 13, 1.25));
    const target = inp.steer * maxSteer;
    this.steer += (target - this.steer) * Math.min(1, 9 * dt);
    let yaw = (vF / T.wheelbase) * Math.tan(this.steer);
    if (inp.hand && Math.abs(vF) > 6) yaw *= 1.45;

    // recompose with the old basis, then turn the car: the sideways slip it creates is what decays through grip
    this.vx = sh * vF - ch * vR;
    this.vz = ch * vF + sh * vR;
    this.h += yaw * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.impact = 0;
    this._collideStatic(collision);
    if (!driven && Math.hypot(this.vx, this.vz) < 0.04 && Math.abs(vF) < 0.04) {
      this.vx = this.vz = 0; // settle and go back to sleep
    }

    const nvF = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    const lat = -this.vx * Math.cos(this.h) + this.vz * Math.sin(this.h);
    const accel = (nvF - this.speedF) / Math.max(dt, 1e-4);
    this.speedF = nvF;
    this.pitch += (-Math.max(-12, Math.min(12, accel)) * 0.0035 - this.pitch) * Math.min(1, 6 * dt);
    this.roll += (-(yaw * nvF) * 0.012 + lat * 0.006 - this.roll) * Math.min(1, 6 * dt);
    this.y += (groundHeightAt(this.x, this.z) - this.y) * Math.min(1, 14 * dt);

    const spin = (nvF * dt) / this.wheelRadius;
    for (const wl of this.wheels) {
      wl.spin.rotation.x += spin;
      if (wl.front) wl.steer.rotation.y = this.steer;
    }
    this._syncMesh();
  }

  _circles() {
    const hl = this.type.len / 2;
    const off = hl - this.type.wid * 0.55;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    return [off, 0, -off].map((o) => ({ x: this.x + sh * o, z: this.z + ch * o }));
  }

  get radius() {
    return this.type.wid * 0.52;
  }

  _collideStatic(collision) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of this._circles()) {
        const hit = collision.pushOut(c.x, c.z, this.radius);
        if (hit) {
          this._resolve(hit.nx, hit.nz, hit.depth, 0.3);
          moved = true;
          break;
        }
        const wall = collision.constrain(c.x, c.z, this.radius);
        if (wall.hit) {
          this._resolve(wall.nx, wall.nz, Math.hypot(wall.x - c.x, wall.z - c.z), 0.3);
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
  }

  // Shift the car along the contact normal and bounce its velocity off it.
  _resolve(nx, nz, depth, restitution) {
    this.x += nx * depth;
    this.z += nz * depth;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= (1 + restitution) * vn * nx;
      this.vz -= (1 + restitution) * vn * nz;
      this.vx *= 0.985;
      this.vz *= 0.985;
      this.impact = Math.max(this.impact, -vn);
    }
  }

  _syncMesh() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.h;
    this.chassis.rotation.x = this.pitch;
    this.chassis.rotation.z = this.roll;
  }
}

export class VehicleManager {
  constructor(scene, collision, groundHeightAt) {
    this.scene = scene;
    this.collision = collision;
    this.groundHeightAt = groundHeightAt;
    this.list = [];
  }

  spawn(typeKey, paint, x, z, heading, kind = 'parked') {
    const v = new Vehicle(typeKey, paint, x, z, heading);
    v.kind = kind;
    v.y = this.groundHeightAt(x, z);
    v._syncMesh();
    this.list.push(v);
    this.scene.add(v.group);
    return v;
  }

  remove(v) {
    const k = this.list.indexOf(v);
    if (k >= 0) this.list.splice(k, 1);
    this.scene.remove(v.group);
  }

  update(dt) {
    for (const v of this.list) v.contact = null;
    for (const v of this.list) v.update(dt, this.collision, this.groundHeightAt);
    for (let i = 0; i < this.list.length; i++) {
      for (let j = i + 1; j < this.list.length; j++) this._collidePair(this.list[i], this.list[j]);
    }
  }

  _collidePair(a, b) {
    if (Math.abs(a.x - b.x) > 6 || Math.abs(a.z - b.z) > 6) return;
    const ca = a._circles(), cb = b._circles();
    let best = null;
    for (const p of ca) {
      for (const q of cb) {
        const dx = p.x - q.x, dz = p.z - q.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1e-4;
          if (!best || rr - d > best.depth) best = { nx: dx / d, nz: dz / d, depth: rr - d };
        }
      }
    }
    if (!best) return;
    a.contact = b;
    b.contact = a;
    a.wake = b.wake = true;
    const ma = a.type.weight, mb = b.type.weight;
    const total = ma + mb;
    a.x += best.nx * best.depth * (mb / total);
    a.z += best.nz * best.depth * (mb / total);
    b.x -= best.nx * best.depth * (ma / total);
    b.z -= best.nz * best.depth * (ma / total);
    const rel = (a.vx - b.vx) * best.nx + (a.vz - b.vz) * best.nz;
    if (rel < 0) {
      const j = (-(1 + 0.35) * rel) / (1 / ma + 1 / mb);
      a.vx += (j * best.nx) / ma;
      a.vz += (j * best.nz) / ma;
      b.vx -= (j * best.nx) / mb;
      b.vz -= (j * best.nz) / mb;
      a.impact = Math.max(a.impact, -rel);
      b.impact = Math.max(b.impact, -rel);
    }
  }

  // Distance LOD, once per frame: far cars are not drawn at all, mid-range cars drop their wheel meshes (4 draw calls per car, twice with the shadow pass).
  cull(cx, cz) {
    for (const v of this.list) {
      const d2 = (v.x - cx) * (v.x - cx) + (v.z - cz) * (v.z - cz);
      v.group.visible = d2 < CULL_FAR * CULL_FAR || !!v.driver?.isPlayer;
      const wheels = d2 < WHEEL_NEAR * WHEEL_NEAR;
      if (wheels !== v.wheelsShown) {
        v.wheelsShown = wheels;
        for (const wl of v.wheels) wl.steer.visible = wheels;
      }
    }
  }

  nearest(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const v of this.list) {
      if (v.locked || (v.driver && v.driver.isPlayer)) continue;
      const d = v.distanceTo(x, z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  // Strongest overlap between a pedestrian circle and any car: {nx, nz, depth, vehicle} or null.
  pushOutCircle(x, z, r) {
    let best = null;
    for (const v of this.list) {
      if (Math.abs(v.x - x) > 5 || Math.abs(v.z - z) > 5) continue;
      const hit = v.pushOutCircle(x, z, r);
      if (hit && (!best || hit.depth > best.depth)) best = { ...hit, vehicle: v };
    }
    return best;
  }
}
