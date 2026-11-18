// vehicles: arcade car physics (grip, drift, handbrake, wall and car collisions) and the manager that owns every car.
import { CAR_TYPES, buildCarModel, buildCustomBody, rimGeometry } from './vehicleModels.js';
import { SWATCHES, RIMS, CHASSIS_TIERS, tunedTop, accelBonus, stepNitrous } from './customsCatalog.js';

const IDLE_INPUT = { throttle: 0, steer: 0, hand: false };
const CULL_FAR = 420; // beyond this a car is hidden (fog is nearly opaque by then)
const WHEEL_NEAR = 95; // wheels are only drawn inside this range

const PUNCTURE = { time: 9.0, top: 0.55, grip: 0.48, hit: 0.62 }; // Air-1 Spike-Pod run-flat: seconds, top-speed, lateral-grip and instant-speed multipliers
let nextVehicleId = 1;

export class Vehicle {
  constructor(typeKey, paint, x, z, heading) {
    this.id = nextVehicleId++; // unique for the session: Air-1 remembers which car it locked onto (Cold Swap)
    this.puncturedTimer = 0; // seconds of run-flat left after a Spike-Pod hit
    this.yawKick = 0; // one-shot yaw rate (rad/s) from the blow-out, decays quickly
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
    this.grip = 8.5; // current lateral grip, eased toward its target
    this.slip = 0; // sideways speed (m/s) before grip acts: drift readout for camera and HUD
    this.kind = 'parked'; // 'parked' | 'traffic' | 'police' | 'target' (drives minimap colour and AI rules; 'target' = Signal Intercept sedan)
    this.bumped = null; // last car that hit us since the owner cleared it (survives the physics sub-steps, unlike `contact`)
    this.hitSpeed = 0; // hardest closing speed (m/s) of a car-to-car hit since the owner last cleared it
    this.hitBy = null; // the car that delivered it
    this.airborne = false; // in flight after a ramp launch (see ambient/StuntHaulerEvent.js)
    this.vy = 0;
    this.onRampOf = null; // the hauler truck whose ramp this car is driving up
    this.airTime = 0; // seconds in the current flight
    this.landedSpeed = 0; // vertical speed at the last touchdown
    this.shield = 0; // seconds of reduced crash damage left (the player's car while ramming an armored truck)
    this.health = 100;
    this.accelMultiplier = this.type.accelMult ?? 1; // tuned cars pull harder (the Roadside Tuner is 1.15)
    this.ambientEvent = null; // the ambient city event that owns this car, until it is stolen or driven off
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
    this.topSpeed = this.type.maxSpeed; // raised by Solaris Customs engine tiers
    this.custom = null; // Solaris Customs spec: {paint, rim, engine, chassis, n2o, n2oCharge, n2oCooldown, isBoosting}
    this.dmgMul = 1; // crash damage multiplier from the chassis tier
    this.ramMul = 1; // police ram impulse multiplier from the chassis tier
    this.gripRecover = 1; // how fast lateral grip returns after a slide (chassis tier)
    this.frozen = false; // pinned by the garage state machine (no physics)
    this.swatch = -1; // paint swatch applied inside Solaris Customs (Export Board bonus)
    this._customGeo = null;
    this._syncMesh();
  }

  // Fit a Solaris Customs spec {paint: swatch index or -1, rim, engine, chassis, n2o}: derived stats plus live paint / rim / aero geometry (no extra draw calls).
  applyCustom(spec, keepCharge = true) {
    const old = this.custom;
    const c = (this.custom = { paint: spec.paint, rim: spec.rim, engine: spec.engine, chassis: spec.chassis, n2o: spec.n2o, n2oCharge: keepCharge && old ? old.n2oCharge : 1, n2oCooldown: 0, isBoosting: false, released: false });
    this.topSpeed = tunedTop(this.type.maxSpeed, c.engine);
    this.accelMultiplier = (this.type.accelMult ?? 1) * (1 + accelBonus(c.engine));
    const ch = c.chassis > 0 ? CHASSIS_TIERS[c.chassis - 1] : null;
    this.dmgMul = ch ? ch.dmg : 1;
    this.ramMul = ch ? ch.ram : 1;
    this.gripRecover = ch ? 1 + ch.grip : 1;
    const body = this.chassis.children[0];
    if (!this._baseGeo) this._baseGeo = body.geometry;
    const paintHex = c.paint >= 0 ? SWATCHES[c.paint].hex : null;
    const geo = buildCustomBody(this.typeKey, this._baseGeo, paintHex, RIMS[c.rim].hex, c.rim > 0);
    body.geometry = geo;
    if (this._customGeo) this._customGeo.dispose();
    this._customGeo = geo;
    const rims = rimGeometry(c.rim > 0 ? RIMS[c.rim].hex : null);
    for (const wl of this.wheels) wl.spin.geometry = rims;
    if (paintHex !== null) this.paint = paintHex;
  }

  get forward() {
    return [Math.sin(this.h), Math.cos(this.h)];
  }

  get speedKmh() {
    return Math.abs(this.speedF) * 3.6;
  }

  // A tyre blows: speed drops to 0.62x at once, top speed 0.55x and lateral grip 0.48x for 9 s, with a one-shot yaw kick (rad/s, signed).
  puncture(kick) {
    if (this.puncturedTimer > 0) return; // one blow-out at a time: a second strip must not stack the 0.62x drop or restart the 9 s clock
    kick = Math.max(-0.35, Math.min(0.35, kick)); // brief: one-shot yaw kick of at most +/-0.35 rad/s
    this.puncturedTimer = PUNCTURE.time;
    this.vx *= PUNCTURE.hit;
    this.vz *= PUNCTURE.hit;
    this.speedF *= PUNCTURE.hit;
    this.yawKick = kick;
    this.wake = true;
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
    if (this.frozen) { this.impact = 0; this.contact = null; return this._syncMesh(); } // pinned inside the Solaris Customs bay
    if (this.airborne) return this._fly(dt, collision, groundHeightAt);
    // parked cars at rest skip the whole step
    if (!this.driver && this.vx === 0 && this.vz === 0 && Math.abs(this.speedF) < 1e-3 && !this.wake) return;
    this.wake = false;
    const T = this.type;
    const driven = !!this.driver;
    const inp = driven ? this.input : IDLE_INPUT;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    let vF = this.vx * sh + this.vz * ch;
    let vR = -this.vx * ch + this.vz * sh;
    const flat = this.puncturedTimer > 0;
    if (flat) this.puncturedTimer = Math.max(0, this.puncturedTimer - dt);
    let topSpeed = flat ? this.topSpeed * PUNCTURE.top : this.topSpeed;
    // Nitrous (Left Shift, player only): extra forward thrust and a temporary speed ceiling while the bottle burns
    const cu = this.custom;
    let n2o = null;
    if (cu && driven && this.driver.isPlayer) n2o = stepNitrous(cu, dt, !!inp.boost, Math.abs(vF), inp.throttle, !!inp.hand && Math.atan2(Math.abs(vR), Math.max(Math.abs(vF), 1)) > 0.314);
    else if (cu && cu.isBoosting) cu.isBoosting = false;
    if (n2o && !flat) topSpeed += n2o.ceil;

    if (driven) {
      if (inp.throttle > 0) {
        if (vF < -0.5) vF = Math.min(0, vF + T.brake * dt);
        else {
          // punchy launch off the line, strong mid-range pull, soft top end
          const r = Math.max(0, vF) / topSpeed;
          const launch = 1 + 0.4 * Math.max(0, 1 - Math.max(0, vF) / 8);
          const scale = this.driver.isPlayer ? 0.72 : 1; // the player's cars build speed over several seconds so the pull is felt; AI keeps its old pace
          vF += T.accel * this.accelMultiplier * scale * inp.throttle * launch * (1 - Math.pow(r, 1.25)) * dt;
          if (n2o && !flat) vF += n2o.thrust * Math.max(0, Math.min(1, (topSpeed - vF) / 3)) * dt;
        }
      } else if (inp.throttle < 0) {
        if (vF > 0.5) vF = Math.max(0, vF - T.brake * (this.driver.isPlayer ? 0.62 : 1) * dt); // firm but not a wall: ~1.4 s from 100 km/h
        else vF = Math.max(-T.maxReverse, vF - T.accel * 0.55 * dt);
      } else {
        const drag = (1.4 + Math.abs(vF) * 0.09) * dt;
        vF = Math.abs(vF) <= drag ? 0 : vF - Math.sign(vF) * drag;
      }
      if (inp.hand) vF *= Math.exp(-(inp.throttle > 0 ? 0.55 : 1.0) * dt); // keep the gas down and the slide carries its speed
      if (flat && vF > topSpeed) vF -= (vF - topSpeed) * Math.min(1, 7 * dt); // run-flat cap: settles onto 0.55x top speed within a second
    } else {
      // parked: strong friction so bumped cars roll to a stop quickly
      const drag = (6 + Math.abs(vF) * 0.3) * dt;
      vF = Math.abs(vF) <= drag ? 0 : vF - Math.sign(vF) * drag;
    }
    // grip eases back after a handbrake slide instead of snapping, so the car settles out of a drift
    const gripTarget = (driven ? (inp.hand ? 1.7 : 8.5 - 3 * Math.min(1, Math.abs(vF) / 36)) : 9) * (flat ? PUNCTURE.grip : 1);
    this.grip += (gripTarget - this.grip) * Math.min(1, (gripTarget < this.grip ? 20 : 5 * this.gripRecover) * dt);
    this.slip = Math.abs(vR);
    vR *= Math.exp(-this.grip * dt);

    const maxSteer = 0.62 / (1 + Math.pow(Math.abs(vF) / 14, 1.3));
    const target = inp.steer * maxSteer;
    // quick to turn in, quicker to unwind: the wheel centres itself when the key is released
    const steerRate = inp.steer === 0 || Math.sign(inp.steer) !== Math.sign(this.steer) ? 15 : 9;
    this.steer += (target - this.steer) * Math.min(1, steerRate * dt);
    let yaw = (vF / T.wheelbase) * Math.tan(this.steer);
    if (inp.hand && Math.abs(vF) > 6) yaw *= 1.45;
    // self-aligning assist for the human driver: the nose follows the slide, so a slide is catchable (and a handbrake turn still swings)
    if (driven && this.driver.isPlayer && !inp.hand && Math.abs(vF) > 4) yaw -= vR * 0.16;
    if (this.yawKick !== 0) {
      yaw += this.yawKick; // blow-out swing, dies away in about a second
      this.yawKick *= Math.exp(-3 * dt);
      if (Math.abs(this.yawKick) < 0.01) this.yawKick = 0;
    }

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
    return (this.type.circles ?? [off, 0, -off]).map((o) => ({ x: this.x + sh * o, z: this.z + ch * o }));
  }

  get radius() {
    return this.type.circleR ?? this.type.wid * 0.52;
  }

  // Ballistic flight (ramp jumps): no grip or steering, gravity on y, back to normal driving when the wheels meet the ground.
  _fly(dt, collision, groundHeightAt) {
    this.vy -= 9.81 * dt;
    this.y += this.vy * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.impact = 0;
    this._collideStatic(collision);
    const hv = Math.hypot(this.vx, this.vz);
    this.airTime += dt;
    // nose follows the trajectory (a little less steep, so it reads as a stable jump), no roll
    this.pitch += (-Math.atan2(this.vy, Math.max(hv, 1)) * 0.8 - this.pitch) * Math.min(1, 4 * dt);
    this.roll += (0 - this.roll) * Math.min(1, 3 * dt);
    const spin = (this.speedF * dt) / this.wheelRadius;
    for (const wl of this.wheels) wl.spin.rotation.x += spin;
    const g = groundHeightAt(this.x, this.z);
    if (this.y <= g && this.vy < 0) {
      this.y = g;
      this.landedSpeed = -this.vy;
      this.vy = 0;
      this.airborne = false;
    }
    this._syncMesh();
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

  // The Signal Intercept quarry: a black sedan nobody can climb into. Its AI controller is attached by the caller.
  spawnTarget(x, z, heading, paint) {
    const v = this.spawn('shade', paint, x, z, heading, 'target');
    v.locked = true;
    return v;
  }

  // The Armored Shakedown truck: locked, never driven by the player. Its AI controller is attached by the caller.
  spawnArmored(x, z, heading, paint) {
    const v = this.spawn('armored', paint, x, z, heading, 'target');
    v.locked = true;
    return v;
  }

  // The Sky-Ad Stunt Hauler: a locked ramp truck. Its AI controller is attached by the event.
  spawnHauler(x, z, heading) {
    const v = this.spawn('hauler', 0xffcc00, x, z, heading, 'target');
    v.locked = true;
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
    if (a.airborne || b.airborne || a.onRampOf === b || b.onRampOf === a) return; // a car in flight sails over everything; one on the ramp ignores the truck's cab
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
    a.bumped = b;
    b.bumped = a;
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
      if (-rel > a.hitSpeed) { a.hitSpeed = -rel; a.hitBy = b; }
      if (-rel > b.hitSpeed) { b.hitSpeed = -rel; b.hitBy = a; }
    }
  }

  // Distance LOD, once per frame: far cars are not drawn at all, mid-range cars drop their wheel meshes (4 draw calls per car, twice with the shadow pass).
  cull(cx, cz) {
    for (const v of this.list) {
      const d2 = (v.x - cx) * (v.x - cx) + (v.z - cz) * (v.z - cz);
      v.group.visible = d2 < CULL_FAR * CULL_FAR || !!v.driver?.isPlayer;
      const wheels = d2 < WHEEL_NEAR * WHEEL_NEAR;
      if (v.typeKey === 'armored') v.wheelsShown = true;
      else if (wheels !== v.wheelsShown) {
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
