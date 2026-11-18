// boatSystem: the Sunrunner 28 speedboat (arcade planing physics, Hydro-Trim boost, hull damage, sinking), the three moored boats at the marina piers, boarding / dismounting, wake foam, and the instanced meshes that draw every boat in two draw calls (+1 for wake foam, +1 for strobes).
import * as THREE from '../vendor/three.module.min.js';
import { seaHeight } from './environment.js';
import { buildShoreline, DISMOUNT_RANGE, GROUND_Z } from './shoreline.js';
import { BOAT_TYPES, buildSunrunnerGeometry, buildPatrolGeometry, buildFoamGeometry, buildStrobeGeometry } from './boatModels.js';
import { ParticlePool } from './particles.js';
import { makeRng } from './rng.js';

const DEG = Math.PI / 180;
export const TOP_SPEED = 34.0; // m/s forward
export const REVERSE_SPEED = 9.0;
const THRUST = 22.0;
const BOOST_THRUST = 1.25;
const BOOST_TIME = 1.2;
export const BOOST_COOLDOWN = 6.0;
const BOOST_HOP = Math.sqrt(2 * 9.81 * 1.8); // vertical launch speed that lifts the hull 1.8 m
const PLANING = 10; // m/s
export const HULL_HP = 250;
const BOARD_RANGE = 3.2;
const RESPAWN_AFTER = 60;
const STRAY_RANGE = 180;
const SINK_TIME = 4.0;
const RESCUE_FEE = 250;
const WAKE_MAX = 160;
const FOAM_LIFE = 1.4;
const SPRAY_LIFE = 0.55;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Boat {
  constructor(typeKey, id) {
    this.isBoat = true;
    this.id = id;
    this.typeKey = typeKey;
    this.type = BOAT_TYPES[typeKey];
    this.kind = typeKey === 'patrol' ? 'patrol' : 'boat';
    this.x = 0;
    this.z = 0;
    this.y = -0.5;
    this.h = 0;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.speedF = 0;
    this.steer = 0;
    this.pitch = 0;
    this.roll = 0;
    this.slip = 0;
    this.impact = 0;
    this.hp = HULL_HP;
    this.driver = null;
    this.input = { throttle: 0, steer: 0, hand: false };
    this.prevHand = false;
    this.topSpeed = typeKey === 'patrol' ? 32.5 : TOP_SPEED;
    this.boostT = 0;
    this.boostCd = 0;
    this.airborne = false;
    this.docked = false;
    this.mooring = null;
    this.sinking = false;
    this.sinkT = 0;
    this.sunk = false;
    this.respawnT = 0;
    this.strayT = 0;
    this.lastHitT = -9;
    this.phase = id * 1.7;
    this.wakeAcc = 0;
    this.sprayAcc = 0;
    this.visible = true;
    this.shield = 0;
    this.contact = null;
    this.locked = false;
  }

  get health() {
    return (this.hp / HULL_HP) * 100;
  }

  get speedKmh() {
    return Math.abs(this.speedF) * 3.6;
  }

  get knots() {
    return Math.abs(this.speedF) * 1.944;
  }

  get boostReady() {
    return this.boostCd <= 0 && !this.sinking;
  }

  // Distance from a world point to the hull's oriented rectangle (0 when inside).
  distanceTo(x, z) {
    const dx = x - this.x, dz = z - this.z;
    const s = Math.sin(this.h), c = Math.cos(this.h);
    const a = -c * dx + s * dz, b = s * dx + c * dz;
    return Math.hypot(Math.max(Math.abs(a) - this.type.wid / 2, 0), Math.max(Math.abs(b) - this.type.len / 2, 0));
  }

  get radius() {
    return this.type.wid * 0.48;
  }

  circles() {
    const o = this.type.len * 0.33;
    const s = Math.sin(this.h), c = Math.cos(this.h);
    return [o, 0, -o].map((d) => ({ x: this.x + s * d, z: this.z + c * d }));
  }
}

export class BoatSystem {
  constructor(world, scene, seed = 1) {
    this.world = world;
    this.scene = scene;
    this.layout = world.layout;
    this.shore = buildShoreline(world.layout);
    this.rng = makeRng(seed * 977 + 41);
    this.list = [];
    this.time = 0;
    this.flash = 0; // strobe clock
    this.smoke = new ParticlePool(scene, { max: 40, size: 2.6, opacity: 0.7, gravity: -1.2, drag: 0.8, from: 0x2a2a2a, to: 0x8a8a8a });
    this._buildMeshes(scene);
    this.moored = [];
    for (const pier of world.layout.marina.piers) {
      const b = this.create('sunrunner');
      b.pier = pier.id;
      b.mooring = pier.moor;
      this.remoor(b);
      this.moored.push(b);
    }
    this.wake = { n: 0, x: new Float32Array(WAKE_MAX * 3), v: new Float32Array(WAKE_MAX * 3), life: new Float32Array(WAKE_MAX), span: new Float32Array(WAKE_MAX), yaw: new Float32Array(WAKE_MAX), size: new Float32Array(WAKE_MAX), kind: new Uint8Array(WAKE_MAX), next: 0 };
    this.render(0);
  }

  _buildMeshes(scene) {
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mk = (geo, mat, count) => {
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.frustumCulled = false; // instances spread over the whole bay: one cull test would need a bound around all of them
      im.count = 0;
      scene.add(im);
      return im;
    };
    this.imSun = mk(buildSunrunnerGeometry(), lit, 3);
    this.imPatrol = mk(buildPatrolGeometry(), lit, 2);
    this.imPatrol.visible = false;
    this.imStrobe = mk(buildStrobeGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), 4);
    this.imStrobe.setColorAt(0, _c.setRGB(1, 1, 1));
    this.imStrobe.visible = false;
    const foamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
    this.imFoam = mk(buildFoamGeometry(), foamMat, WAKE_MAX);
    this.imFoam.visible = false;
  }

  create(typeKey) {
    const b = new Boat(typeKey, this.list.length);
    this.list.push(b);
    return b;
  }

  // Put a (moored) boat back at its berth.
  remoor(b) {
    const m = b.mooring;
    b.x = m.x;
    b.z = m.z;
    b.h = m.h;
    b.vx = b.vz = b.vy = b.speedF = 0;
    b.steer = b.pitch = b.roll = 0;
    b.hp = HULL_HP;
    b.docked = true;
    b.sinking = false;
    b.sunk = false;
    b.airborne = false;
    b.boostT = b.boostCd = 0;
    b.driver = null;
    b.respawnT = b.strayT = 0;
    b.y = this.waterAt(b.x, b.z);
  }

  waterAt(x, z) {
    return seaHeight(x, z, this.world.env.time);
  }

  // The boat the player could climb into from here, if any.
  candidate(px, pz) {
    let best = null, bd = BOARD_RANGE;
    for (const b of this.list) {
      if (b.kind !== 'boat' || b.driver || b.sunk || b.sinking) continue;
      const d = b.distanceTo(px, pz);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  board(b) {
    const w = this.world, p = w.player;
    if (p.inCar) return;
    b.docked = false;
    b.strayT = 0;
    p.enter(b);
    w.emit('door');
    w.notify(`${b.type.name}: W/S throttle   A/D steer   Space trim boost`, 'info');
    w.contraband.onBoard(b);
  }

  // Where F would put the player on dry land from this boat (within 6 m of a pier or the shoreline), or null.
  dismountSpot(b) {
    return this.shore.landingSpot(b.x, b.z, DISMOUNT_RANGE, (x, z) => this.world.collision.isFree(x, z, 0.4));
  }

  dismount(b) {
    const w = this.world, p = w.player;
    if (Math.abs(b.speedF) > 12) return w.notify('Throttle down to step off', 'warn');
    const spot = this.dismountSpot(b);
    if (!spot) return w.notify('Too far from a pier or the shore', 'warn');
    this._putOnLand(b, spot);
    w.emit('door');
    return undefined;
  }

  _putOnLand(b, spot) {
    const w = this.world, p = w.player;
    w.placeOnFoot(b);
    p.x = spot.x;
    p.z = spot.z;
    p.y = spot.y - 0.5; // standing on the deck / sand ...
    p.jump = 0.5; // ... dropped in from 0.5 m above it, so the step off reads as a hop
    p.heading = Math.atan2(spot.x - b.x, spot.z - b.z);
    p.vx = p.vz = 0;
    p.vy = 0.001; // a non-zero vy lets the foot controller run the drop
    b.input.throttle = 0;
    b.input.hand = false;
  }

  // Release the player's boat without moving the player (arrest / respawn): it returns to its berth, or is dropped if it is not a berth boat.
  release(b) {
    b.driver = null;
    b.input.throttle = 0;
    b.input.hand = false;
    if (b.mooring) b.strayT = RESPAWN_AFTER - 1;
    else b.sunk = true;
  }

  // Physics sub-step (called with the same fixed dt as the car physics).
  step(dt) {
    for (const b of this.list) {
      if (b.sunk) continue;
      this._stepBoat(b, dt);
    }
  }

  _stepBoat(b, dt) {
    const t = this.time;
    const sea = this.waterAt(b.x, b.z);
    b.contact = null;
    b.impact = 0;
    if (b.docked) {
      b.y = sea + Math.sin(t * Math.PI * 2 * 1.4 + b.phase) * 0.08;
      b.pitch = Math.sin(t * 1.9 + b.phase) * 0.012;
      b.roll = Math.sin(t * 1.5 + b.phase * 2) * 0.012;
      return;
    }
    if (b.sinking) {
      b.input.throttle = 0;
      b.input.steer = 0;
      b.input.hand = false;
      b.sinkT += dt;
      b.y = sea - Math.min(1, b.sinkT / SINK_TIME) * 2.4;
      b.pitch += (0.5 - b.pitch) * Math.min(1, 0.8 * dt);
      b.roll += (0.15 - b.roll) * Math.min(1, 0.8 * dt);
    }
    const inp = b.input;
    const sh = Math.sin(b.h), ch = Math.cos(b.h);
    let vF = b.vx * sh + b.vz * ch;
    let lat = -b.vx * ch + b.vz * sh;
    const hand = !!inp.hand;
    if (hand && !b.prevHand && b.boostCd <= 0 && !b.sinking && !b.airborne) {
      b.boostT = BOOST_TIME;
      b.boostCd = BOOST_COOLDOWN;
      if (vF > 8) {
        b.vy = BOOST_HOP; // trims up and jumps the crest
        b.airborne = true;
      }
      if (b.driver?.isPlayer) this.world.emit('boatBoost');
    }
    b.prevHand = hand;
    b.boostCd = Math.max(0, b.boostCd - dt);
    b.boostT = Math.max(0, b.boostT - dt);
    const boosting = b.boostT > 0;
    const vmax = b.topSpeed * (boosting ? 1.25 : 1);
    const thr = b.sinking ? 0 : inp.throttle;
    if (thr > 0) {
      if (vF < -0.5) vF += THRUST * 0.9 * dt;
      else if (vF < vmax) vF = Math.min(vmax, vF + THRUST * (boosting ? BOOST_THRUST : 1) * thr * dt); // no more push once at the cap: 34 m/s, 42.5 m/s trimmed up
    } else if (thr < 0) {
      if (vF > 0.5) vF -= THRUST * 0.9 * dt;
      else if (vF > -REVERSE_SPEED) vF = Math.max(-REVERSE_SPEED, vF - THRUST * 0.5 * dt);
    }
    if (!b.airborne) vF -= vF * (Math.abs(vF) > PLANING ? 0.42 : 0.85) * dt; // linear water drag: planing is slipperier than displacement (none while the hull is in the air)
    lat *= Math.exp(-2.2 * dt); // the hull slides before it bites
    b.slip = Math.abs(lat);
    // rudder: needs way on to carve
    b.steer += (inp.steer - b.steer) * Math.min(1, 7 * dt);
    const way = 0.35 + 0.65 * Math.min(1, Math.abs(vF) / TOP_SPEED);
    const yaw = 1.65 * b.steer * way * (vF < -0.3 ? -1 : 1);
    b.vx = sh * vF - ch * lat;
    b.vz = ch * vF + sh * lat;
    b.h += yaw * dt;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    this._collide(b, dt);

    const nsh = Math.sin(b.h), nch = Math.cos(b.h);
    b.speedF = b.vx * nsh + b.vz * nch;
    const sp = Math.abs(b.speedF);
    // bow rides up onto the plane and chops over the swell; leans into turns
    const planeK = Math.min(1, sp / TOP_SPEED);
    const pitchT = planeK * 7.5 * DEG + Math.sin(t * 3.8 + b.phase) * 1.8 * DEG * Math.min(1, sp / 8);
    const rollT = -b.steer * planeK * 16 * DEG;
    if (!b.sinking) {
      b.pitch += (pitchT - b.pitch) * Math.min(1, 6 * dt);
      b.roll += (rollT - b.roll) * Math.min(1, 7 * dt);
    }
    // vertical: ride the swell, or fly after a trim hop
    const swell = this.waterAt(b.x, b.z);
    if (b.sinking) return;
    if (b.airborne) {
      b.vy -= 9.81 * dt;
      b.y += b.vy * dt;
      b.pitch += (-Math.atan2(b.vy, Math.max(sp, 6)) * 0.5 + 0.12 - b.pitch) * Math.min(1, 3 * dt);
      if (b.y <= swell && b.vy < 0) {
        b.y = swell;
        if (-b.vy > 2.5 && b.driver?.isPlayer) this.world.emit('boatSlam');
        if (-b.vy > 2.5) this._splash(b);
        b.vy = 0;
        b.airborne = false;
      }
    } else {
      b.y += (swell - b.y) * Math.min(1, 14 * dt);
    }
  }

  // Hull vs. piers, quays, the freighter, the lighthouse and the beach.
  _collide(b, dt) {
    let aground = false;
    let hardest = 0;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const c of b.circles()) {
        const hit = this.shore.pushOut(c.x, c.z, b.radius);
        if (!hit) continue;
        b.x += hit.nx * hit.depth;
        b.z += hit.nz * hit.depth;
        const vn = b.vx * hit.nx + b.vz * hit.nz;
        if (vn < 0) {
          const rest = hit.kind === 'solid' ? 0.25 : 0;
          b.vx -= (1 + rest) * vn * hit.nx;
          b.vz -= (1 + rest) * vn * hit.nz;
          hardest = Math.max(hardest, -vn);
        }
        if (hit.kind === 'shore') aground = true;
        moved = true;
        break;
      }
      if (!moved) break;
    }
    if (b.z < GROUND_Z + 1) aground = true;
    if (aground) {
      // grounding guardrail: hull friction and a slide back down the coastal normal, so a boat can never reach the street
      const k = Math.exp(-6.5 * dt);
      b.vx *= k;
      b.vz *= k;
      b.vz += 3 * dt;
    }
    b.impact = hardest;
    if (hardest > 2 && this.time - b.lastHitT > 0.35) {
      b.lastHitT = this.time;
      this.damage(b, hardest * 2.2);
    }
  }

  damage(b, amount) {
    if (b.sinking || b.sunk) return;
    b.hp = Math.max(0, b.hp - amount * (b.driver?.isPlayer ? this.world.durability : 1));
    if (b.hp <= 0) {
      b.sinking = true;
      b.sinkT = 0;
      b.boostT = 0;
    }
  }

  _splash(b) {
    const s = Math.sin(b.h), c = Math.cos(b.h);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this._wakeEmit(b.x, b.y + 0.2, b.z, Math.cos(a) * 4 + s * b.speedF * 0.3, 4.5, Math.sin(a) * 4 + c * b.speedF * 0.3, 0, 0.9, 1, SPRAY_LIFE * 1.3);
    }
  }

  // Once per frame.
  update(dt) {
    this.time += dt;
    this.flash += dt;
    const w = this.world;
    for (const b of this.list) {
      if (b.sinking && !b.sunk) {
        if (this.smoke && Math.random() < 0.9) this.smoke.emit(b.x + (Math.random() - 0.5) * 1.2, b.y + 1.2, b.z + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, 1.6 + Math.random(), (Math.random() - 0.5) * 0.8, 1.6);
        if (b.sinkT >= SINK_TIME) this._finishSink(b);
      }
      if (b.sunk) {
        if (b.mooring) {
          b.respawnT -= dt;
          if (b.respawnT <= 0 && Math.hypot(w.player.px - b.mooring.x, w.player.pz - b.mooring.z) > 30) this.remoor(b);
        }
        continue;
      }
      // an unattended berth boat that has drifted off comes home after a minute
      if (b.mooring && !b.driver && !b.docked) {
        const away = Math.hypot(b.x - b.mooring.x, b.z - b.mooring.z) > STRAY_RANGE;
        b.strayT = away ? b.strayT + dt : Math.max(b.strayT, 0);
        if ((b.strayT >= RESPAWN_AFTER || (!away && b.strayT >= RESPAWN_AFTER - 0.5)) && Math.hypot(w.player.px - b.mooring.x, w.player.pz - b.mooring.z) > 30) this.remoor(b);
      }
      // wake foam
      const sp = Math.abs(b.speedF);
      if (!b.docked && sp > 7 && !b.airborne) this._emitWake(b, dt, sp);
      else if (b.airborne && sp > 7) this._emitSpray(b, dt, sp);
    }
    this.smoke.update(dt);
    this._updateWake(dt);
    this.render(dt);
  }

  _finishSink(b) {
    const w = this.world, p = w.player;
    b.sunk = true;
    b.respawnT = RESPAWN_AFTER;
    if (b.driver?.isPlayer) {
      const spot = this.shore.nearestShore(b.x, b.z, (x, z) => w.collision.isFree(x, z, 0.4));
      this._putOnLand(b, spot);
      if (!w.fx) {
        const fee = Math.min(w.cash, RESCUE_FEE);
        w.cash -= fee;
        w.notify(`Water rescue fee  -$${fee}`, 'warn');
      }
      w.rig.snap(p, w.collision);
    }
    b.driver = null;
    if (!b.mooring) b.hp = 0;
  }

  // ---- wake foam ----

  _emitWake(b, dt, sp) {
    b.wakeAcc += dt * (4 + sp * 0.28);
    const s = Math.sin(b.h), c = Math.cos(b.h);
    const L = b.type.len;
    while (b.wakeAcc >= 1) {
      b.wakeAcc -= 1;
      const sx = b.x - s * L * 0.46, sz = b.z - c * L * 0.46;
      const out = sp * 0.17;
      const size = 1.4 + Math.min(1, sp / TOP_SPEED) * 1.3;
      for (const side of [1, -1]) {
        // V arm: foam stays where it was dropped and drifts outward, so the line it forms opens at the wake angle
        this._wakeEmit(sx + c * side * b.type.wid * 0.38, b.y, sz - s * side * b.type.wid * 0.38, c * side * out, 0, -s * side * out, 0, size, 0, FOAM_LIFE, b.h - side * 22 * DEG);
      }
    }
    if (sp > 14) this._emitSpray(b, dt, sp);
  }

  // Rooster tail: droplets thrown up and back off the transom.
  _emitSpray(b, dt, sp) {
    b.sprayAcc += dt * (14 + sp * 0.5) * (b.boostT > 0 ? 1.6 : 1);
    const s = Math.sin(b.h), c = Math.cos(b.h);
    const L = b.type.len;
    while (b.sprayAcc >= 1) {
      b.sprayAcc -= 1;
      const j = (this.rng() - 0.5) * 2;
      const j2 = this.rng();
      this._wakeEmit(b.x - s * L * 0.5, b.y + 0.5, b.z - c * L * 0.5, -s * sp * 0.22 + c * j * 1.6, 4.2 + j2 * 3, -c * sp * 0.22 - s * j * 1.6, 0, 1.0 + j2 * 0.5, 1, SPRAY_LIFE, b.h);
    }
  }

  _wakeEmit(x, y, z, vx, vy, vz, _unused, size, kind, life, yaw = 0) {
    const W = this.wake;
    const i = W.next;
    W.next = (W.next + 1) % WAKE_MAX;
    if (W.life[i] <= 0) W.n++;
    W.x[i * 3] = x;
    W.x[i * 3 + 1] = y;
    W.x[i * 3 + 2] = z;
    W.v[i * 3] = vx;
    W.v[i * 3 + 1] = vy;
    W.v[i * 3 + 2] = vz;
    W.life[i] = W.span[i] = life;
    W.size[i] = size;
    W.kind[i] = kind;
    W.yaw[i] = yaw;
  }

  _updateWake(dt) {
    const W = this.wake;
    if (W.n <= 0) return;
    let n = 0;
    for (let i = 0; i < WAKE_MAX; i++) {
      if (W.life[i] <= 0) continue;
      W.life[i] -= dt;
      if (W.life[i] <= 0) continue;
      n++;
      const k = i * 3;
      if (W.kind[i] === 1) {
        W.v[k + 1] -= 14 * dt;
        W.x[k + 1] += W.v[k + 1] * dt;
        if (W.x[k + 1] < -0.45) W.life[i] = 0;
      } else {
        W.x[k + 1] = this.waterAt(W.x[k], W.x[k + 2]) + 0.3; // the water mesh is coarser than the swell it samples: float the foam above its facets
      }
      W.x[k] += W.v[k] * dt;
      W.x[k + 2] += W.v[k + 2] * dt;
    }
    W.n = n;
  }

  // ---- drawing ----

  render(dt) {
    let ns = 0, np = 0, nst = 0;
    const flash = Math.floor(this.flash * 6) % 2 === 0;
    for (const b of this.list) {
      if (b.sunk) continue;
      _e.set(-b.pitch, b.h, b.roll, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(1, 1, 1));
      if (b.typeKey === 'patrol') {
        this.imPatrol.setMatrixAt(np++, _m);
        // red / blue strobes on the roof bar, alternating
        for (const side of [1, -1]) {
          _p.set(side * 0.6, 2.05, -0.05).applyMatrix4(_m);
          _m.compose(_p, _q, _s.set(1, 1, 1));
          this.imStrobe.setMatrixAt(nst, _m);
          const on = (side > 0) === flash;
          this.imStrobe.setColorAt(nst, on ? _c.setRGB(side > 0 ? 1.2 : 0.25, side > 0 ? 0.12 : 0.55, side > 0 ? 0.1 : 1.4) : _c.setRGB(0.12, 0.12, 0.16));
          nst++;
          _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(1, 1, 1));
        }
      } else {
        this.imSun.setMatrixAt(ns++, _m);
      }
    }
    this.imSun.count = ns;
    this.imSun.instanceMatrix.needsUpdate = true;
    this.imPatrol.count = np;
    this.imPatrol.visible = np > 0;
    if (np) this.imPatrol.instanceMatrix.needsUpdate = true;
    this.imStrobe.count = nst;
    this.imStrobe.visible = nst > 0;
    if (nst) {
      this.imStrobe.instanceMatrix.needsUpdate = true;
      this.imStrobe.instanceColor.needsUpdate = true;
    }
    // foam
    const W = this.wake;
    let nf = 0;
    for (let i = 0; i < WAKE_MAX; i++) {
      if (W.life[i] <= 0) continue;
      const f = W.life[i] / W.span[i];
      const k = i * 3;
      const grow = W.kind[i] === 1 ? W.size[i] * Math.min(1, f * 2) : W.size[i] * (0.35 + 0.65 * f);
      _e.set(0, W.yaw[i], 0, 'YXZ');
      _q.setFromEuler(_e);
      if (W.kind[i] === 1) _s.set(grow * 1.3, grow * 7, grow * 1.3);
      else _s.set(grow * 1.15, 2, grow * 2.4);
      _m.compose(_p.set(W.x[k], W.x[k + 1], W.x[k + 2]), _q, _s);
      this.imFoam.setMatrixAt(nf++, _m);
    }
    this.imFoam.count = nf;
    this.imFoam.visible = nf > 0;
    if (nf) this.imFoam.instanceMatrix.needsUpdate = true;
    void dt;
  }

  // Minimap data: pier berths, moored boats, patrol boats.
  get mapView() {
    return {
      moored: this.list.filter((b) => b.kind === 'boat' && !b.sunk && b.docked).map((b) => ({ x: b.x, z: b.z, h: b.h })),
      patrols: this.list.filter((b) => b.kind === 'patrol' && !b.sunk).map((b) => ({ x: b.x, z: b.z, h: b.h })),
    };
  }
}
