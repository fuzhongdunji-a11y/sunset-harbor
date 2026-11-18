// airpursuit: Costa Air-1, the police helicopter at 3+ stars. Procedural low-poly chopper (hull, two rotors), a dynamic searchlight cone + ground disc,
// a pool of three road Spike-Pods, the six-state machine (INACTIVE / INBOUND / TRACKING / LOCKED / SEARCHING / REFUEL_RTB), the searchlight line-of-sight test
// against static cover, the Cold Swap vehicle-ID tracker, the predictive Spike-Pod solver with its strip-vs-car overlap test, and the Scanner Ghost payout.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';
import { ParticlePool } from './particles.js';
import { DIRS, LANE, rightOf } from './roadNet.js';

const DEG = Math.PI / 180;
export const AIR_CFG = {
  gateStars: 3, gateTime: 4.0, // dispatch: 3+ stars held this long
  inboundBack: 220, inboundAlt: 58, inboundSpeed: 42, trackDist: 65,
  offset: 28, alt: { 3: 42, 4: 36, 5: 30 }, speed: { 3: 34, 4: 40, 5: 46 }, accel: 18,
  slew: { 3: 22, 4: 30, 5: 38 }, cone: 13 * DEG, gimbalDrop: 1.4,
  lockAt: 1.5, lockUp: 1.0, lockDown: 0.75, // lockTimer seconds, +1.0/s inside the disc with a clear line, -0.75/s otherwise
  losBreak: 2.0, loseDist: 110, lockedLoseDist: 95, breakFactor: 1.15, breakTime: 2.0,
  dropEvery: 9.0, dropProb: { 4: 0.65, 5: 0.85 }, dropForce: 18.0, dropSpeed: 14.0, telegraph: 1.4, stripW: 5.6, stripD: 1.4, armedFor: 22.0,
  leadT: 2.2, maxRange: 75.0, dodgeRange: 8.0, dodgeSpeed: 15.0, dodgeMax: 4,
  sweepR: 16.0, // radius of the searchlight's own sweep around the last-known position while SEARCHING
  spiralR0: 22.0, spiralK: 3.5, spiralW: 0.55, searchMax: 18.0, reacquire: 45.0, cloakSpeed: 26.0, cloakNear: 35.0,
  fuel: 150.0, rtbClimb: 9.0, rtbSpeed: 48.0, rtbEnd: 280.0, rtbMax: 8.0, rtbCooldown: 25.0,
  ghostMin: 8.0, base: { 3: 650, 4: 1200, 5: 2000 }, swap: 150, dodge: 100,
};
const PAD = { x: 0, z: 330 }; // the harbor helipad the chopper heads for when it leaves
const COVER_CELL = 24; // must match collision.js
const ICE = new THREE.Color(0xd8f2ff);
const AMBER = new THREE.Color(0xffb899);
const SEG = 12; // searchlight ring segments

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const starTier = (s) => clamp(s, 3, 5);

// ---------- geometry ----------

// Hull, tail boom, skids and two strobe tabs (the tabs' vertex colours are rewritten every frame). Origin = cabin centre, +Z = nose.
function buildHull() {
  const NAVY = 0x24457c, WHITE = 0xf2f4f8, DARK = 0x15161a, GLASS = 0x7fd0ff, YEL = 0xffd23f;
  const b = new MeshBuilder();
  b.slab([-1.0, -1.7, 1.0, 1.5], [-0.85, -1.4, 0.85, 1.2], -0.9, 0.8, { side: NAVY, top: NAVY, bottom: WHITE }, { bottom: true });
  b.slab([-0.9, 1.0, 0.9, 2.3], [-0.55, 1.2, 0.55, 1.6], -0.9, 0.5, { side: GLASS, top: GLASS, bottom: WHITE }, { bottom: true }); // glazed nose
  b.box(-1.02, -0.2, -0.9, 1.02, 0.02, 1.2, WHITE); // livery stripe
  b.slab([-0.42, -6.6, 0.42, -1.5], [-0.22, -6.6, 0.22, -1.5], -0.1, 0.7, NAVY); // tail boom
  b.box(-0.07, 0.4, -6.9, 0.07, 1.9, -5.9, NAVY); // fin
  b.box(-1.0, 0.45, -6.4, 1.0, 0.52, -5.8, WHITE); // tailplane
  b.box(-0.7, 0.8, -1.2, 0.7, 1.35, 0.9, DARK); // engine cowling
  b.box(-0.12, 1.35, -0.12, 0.12, 1.95, 0.12, DARK); // mast
  b.box(-0.2, -1.4, 1.0, 0.2, -0.9, 1.6, DARK); // searchlight pod under the nose
  for (const s of [-1, 1]) {
    b.box(s * 1.1 - 0.05, -1.4, -1.6, s * 1.1 + 0.05, -1.3, 2.3, DARK); // skid
    for (const z of [-0.8, 1.2]) b.box(s * 1.07 - 0.04, -1.3, z - 0.05, s * 1.07 + 0.04, -0.85, z + 0.05, DARK); // struts
    b.box(s * 0.97, -0.7, 0.2, s * 1.01, -0.5, 1.0, YEL); // door handle accent
  }
  const tabStart = b.pos.length / 3;
  b.box(-1.25, -1.38, 1.9, -0.95, -1.28, 2.4, 0xff3b3b); // port strobe tab
  b.box(0.95, -1.38, 1.9, 1.25, -1.28, 2.4, 0x3b8dff); // starboard strobe tab
  const geo = b.build();
  return { geo, tabStart, tabEnd: b.pos.length / 3 };
}

// Main rotor (4 blades + a swept blur disc) with per-vertex alpha so the blur stays see-through while the blades read.
function buildRotor() {
  const b = new MeshBuilder();
  const m = new THREE.Matrix4();
  for (let k = 0; k < 4; k++) {
    b.setTransform(m.makeRotationY((k * Math.PI) / 2));
    b.box(-0.17, -0.02, 0.35, 0.17, 0.03, 5.2, 0x2a2f3a);
  }
  const bladeVerts = b.pos.length / 3;
  b.setTransform(null);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    b.tri([0, 0, 0], [Math.sin(a0) * 5.2, 0, Math.cos(a0) * 5.2], [Math.sin(a1) * 5.2, 0, Math.cos(a1) * 5.2], 0xe8f0ff);
  }
  const g = b.build();
  const count = b.pos.length / 3;
  const rgba = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    rgba[i * 4] = b.col[i * 3];
    rgba[i * 4 + 1] = b.col[i * 3 + 1];
    rgba[i * 4 + 2] = b.col[i * 3 + 2];
    rgba[i * 4 + 3] = i < bladeVerts ? 0.9 : 0.14;
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return g;
}

function buildTailRotor() {
  const b = new MeshBuilder();
  b.box(-0.03, -0.62, -0.09, 0.03, 0.62, 0.09, 0x2a2f3a); // one long blade through the hub = two blades
  b.box(-0.07, -0.1, -0.1, 0.07, 0.1, 0.1, 0x15161a);
  return b.build();
}

// Searchlight: apex + 12 cone-base points + disc centre + 12 disc points = 26 vertices, rewritten every frame.
function buildLight() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(26 * 3), 3));
  const idx = [];
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    idx.push(0, 1 + i, 1 + j, 13, 14 + i, 14 + j);
  }
  g.setIndex(idx);
  return g;
}

// One Spike-Pod: flat strip (5.6 x 1.4 m) with a black plate, hazard chevrons, spikes and a 3.2 m ring around the middle. Long axis = X.
function buildPodGeometry() {
  const b = new MeshBuilder();
  const W = AIR_CFG.stripW / 2, D = AIR_CFG.stripD / 2;
  b.box(-W, 0, -D, W, 0.1, D, 0x2b2f38, { bottom: false });
  for (let k = 0; k < 6; k++) {
    const x = -W + 0.3 + k * ((2 * W - 0.6) / 5);
    b.quad([x - 0.2, 0.105, -D + 0.1], [x - 0.2, 0.105, D - 0.1], [x + 0.2, 0.105, D - 0.1], [x + 0.2, 0.105, -D + 0.1], k % 2 ? 0x15161a : 0xffcc1a, [0, 1, 0]);
  }
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 5; k++) {
      const cx = -W + 0.7 + k * ((2 * W - 1.4) / 4), cz = r ? 0.3 : -0.3, s = 0.09;
      const base = [[cx - s, 0.1, cz - s], [cx + s, 0.1, cz - s], [cx + s, 0.1, cz + s], [cx - s, 0.1, cz + s]];
      const tip = [cx, 0.42, cz];
      for (let i = 0; i < 4; i++) b.tri(base[i], base[(i + 1) % 4], tip, 0xdfe5ee);
    }
  }
  const ro = 1.6, ri = 1.42, n = 12;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    b.quad([Math.cos(a0) * ri, 0.04, Math.sin(a0) * ri], [Math.cos(a0) * ro, 0.04, Math.sin(a0) * ro], [Math.cos(a1) * ro, 0.04, Math.sin(a1) * ro], [Math.cos(a1) * ri, 0.04, Math.sin(a1) * ri], 0xffc21a, [0, 1, 0]);
  }
  return b.build();
}

// ---------- geometry tests ----------

// Separating-axis test between two oriented rectangles in the XZ plane. Each: {x, z, ax, az (unit axis A), hx (half extent along A), hz (half extent along B = perpendicular)}.
function obbOverlap(a, b) {
  const axes = [[a.ax, a.az], [-a.az, a.ax], [b.ax, b.az], [-b.az, b.ax]];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [ux, uz] of axes) {
    const ra = a.hx * Math.abs(a.ax * ux + a.az * uz) + a.hz * Math.abs(-a.az * ux + a.ax * uz);
    const rb = b.hx * Math.abs(b.ax * ux + b.az * uz) + b.hz * Math.abs(-b.az * ux + b.ax * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

const vehicleBox = (v) => ({ x: v.x, z: v.z, ax: -Math.cos(v.h), az: Math.sin(v.h), hx: v.type.wid / 2, hz: v.type.len / 2 });

// ---------- the system ----------

export class AirPursuit {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.state = 'INACTIVE';
    this.rtbCooldown = 0;
    this.gateT = 0;
    this.time = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.bank = 0;
    this.pitch = 0;
    this.axis = new THREE.Vector3(0, -1, 0); // searchlight direction
    this.disc = { x: 0, z: 0, R: 9, gy: 0 };
    this.losClear = true;
    this.lockTimer = 0;
    this.losFailT = 0;
    this.breakT = 0;
    this.searchT = 0;
    this.rtbT = 0;
    this.fuelT = 0;
    this.stateT = 0;
    this.lastKnown = { x: 0, z: 0 };
    this.trackedVehicleId = null;
    this.decoyCloak = false;
    this.pursuit = { lockedTotal: 0, peak: 0, cold: 0, dodged: 0, sinceDrop: 0, dropClock: 0 };
    this.pods = [0, 1, 2].map(() => ({ state: 'free', t: 0, x: 0, y: 0, z: 0, tx: 0, tz: 0, ty: 0, hl: 0, hit: false, near: false, nearMin: 1e9, nearSpeed: 0 }));
    this.podCount = 0;
    this.toast = null; // {amount, t} read by the HUD
    this.view = { state: 'INACTIVE', label: '', color: '#ffffff', fill: 0, cloak: false, glare: 0, pulse: false };
    this.audio = { active: false, dist: 999, closing: 0 };
    this.bcT = 0;
    this._prevDist = null;
    this._prevInCar = false;
    this._dir = new THREE.Vector3(1, 0, 0);
    this._seen = new Set();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qs = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
    this._build(scene);
    // the wanted system tells us when the level hits zero (a clean escape pays out; an arrest does not)
    world.wanted.onZero = (peakStars) => this._onWantedZero(peakStars);
    // tick with the world: wrap afterStep so shots, the bench and the live loop all run the same code on game time
    const orig = world.afterStep.bind(world);
    world.afterStep = (dt, mouse) => {
      orig(dt, mouse);
      this.update(dt);
    };
  }

  _build(scene) {
    const hull = buildHull();
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.hullMesh = new THREE.Mesh(hull.geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.tab = { start: hull.tabStart, end: hull.tabEnd, attr: hull.geo.getAttribute('color') };
    // transparent + double-sided materials are drawn in two passes by default; forceSinglePass keeps each at one draw call (depthWrite is off, so order does not matter)
    this.rotor = new THREE.Mesh(buildRotor(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
    this.rotor.position.set(0, 1.95, 0);
    this.tail = new THREE.Mesh(buildTailRotor(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.tail.position.set(0.14, 1.2, -6.6);
    this.group.add(this.hullMesh, this.rotor, this.tail);
    this.group.visible = false;
    for (const m of [this.hullMesh, this.rotor, this.tail]) m.frustumCulled = false;
    scene.add(this.group);

    this.light = new THREE.Mesh(buildLight(), new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false }));
    this.light.frustumCulled = false;
    this.light.visible = false;
    scene.add(this.light);

    this.podMesh = new THREE.InstancedMesh(buildPodGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 6);
    // instances 0-2 = the pods themselves, 3-5 = the flat, flashing landing-zone marker shown on the road during each pod's 1.4 s fall (same geometry, so still one draw call)
    this.podMesh.frustumCulled = false;
    this.podMesh.visible = false;
    this.podMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 6; i++) this.podMesh.setColorAt(i, this._c.setRGB(1, 1, 1));
    scene.add(this.podMesh);

    // orange rim sparks for the punctured tyre (drawn only while a car is running on its rim)
    this.sparks = new ParticlePool(scene, { max: 48, size: 0.5, additive: true, gravity: 9, drag: 0.3, from: 0xffb030, to: 0x401400 });
  }

  get active() {
    return this.state !== 'INACTIVE';
  }

  // Gimbal origin in world space (under the nose).
  _gimbal(out) {
    return out.set(0, -AIR_CFG.gimbalDrop, 1.3).applyEuler(this._e.set(this.pitch, this.yaw, this.bank, 'YXZ')).add(this.pos);
  }

  // ---------- state transitions ----------

  _to(state) {
    this.state = state;
    this.stateT = 0;
    this.breakT = 0;
    this.losFailT = 0;
    const wanted = this.world.wanted;
    if (state === 'SEARCHING') this.searchT = 0;
    if (state === 'REFUEL_RTB') this.rtbT = 0;
    if (state === 'LOCKED') {
      this.world.emit('airLock');
      this.bcT = 0;
      this.pursuit.sinceDrop = 0;
      this.pursuit.dropClock = 0;
    }
    wanted.setAirLockFreeze(state === 'LOCKED');
    if (state !== 'SEARCHING') wanted.airDecayBoost = 1;
  }

  _spawn(p) {
    const w = this.world;
    const d = this._dir;
    this.pos.set(p.x - d.x * AIR_CFG.inboundBack, 0, p.z - d.z * AIR_CFG.inboundBack);
    this.pos.y = w.layout.groundHeightAt(this.pos.x, this.pos.z) + AIR_CFG.inboundAlt;
    this.vel.set(d.x * AIR_CFG.inboundSpeed, 0, d.z * AIR_CFG.inboundSpeed);
    this.yaw = Math.atan2(d.x, d.z);
    this.bank = this.pitch = 0;
    this.lockTimer = 0;
    this.fuelT = 0;
    this.decoyCloak = false;
    this.axis.set(0, -1, 0);
    this.group.visible = this.light.visible = true;
    this._to('INBOUND');
  }

  // Back to a hidden, idle state. `cooldown` seconds before the next dispatch.
  _stand(cooldown) {
    this.state = 'INACTIVE';
    this.group.visible = this.light.visible = false;
    this.rtbCooldown = cooldown;
    this.lockTimer = 0;
    this.decoyCloak = false;
    this.gateT = 0;
    this.audio.active = false;
    const wanted = this.world.wanted;
    wanted.setAirLockFreeze(false);
    wanted.airDecayBoost = 1;
    for (const p of this.pods) p.state = 'free';
    this._writePods();
  }

  _endPursuit() {
    this.pursuit = { lockedTotal: 0, peak: 0, cold: 0, dodged: 0, sinceDrop: 0, dropClock: 0 };
  }

  // Wanted just reached zero (not an arrest): pay the Scanner Ghost bonus if Air-1 had us pinned long enough.
  _onWantedZero() {
    const w = this.world;
    const pu = this.pursuit;
    if (!w.fx && pu.peak >= 3 && pu.lockedTotal >= AIR_CFG.ghostMin) {
      const amount = AIR_CFG.base[starTier(pu.peak)] + AIR_CFG.swap * pu.cold + AIR_CFG.dodge * Math.min(pu.dodged, AIR_CFG.dodgeMax);
      w.cash += amount;
      w.saveRequested = true;
      w.emit('escaped');
      this.toast = { amount, t: 4.0 };
      this.lastPayout = amount;
    }
    this._endPursuit();
    if (this.state !== 'INACTIVE') this._stand(0);
  }

  // ---------- per-frame ----------

  update(dt) {
    const w = this.world;
    const p = w.player;
    const wanted = w.wanted;
    this.time += dt;
    this._tickToast(dt);
    if (w.fx) {
      // arrested or wrecked: the chase is over, no payout, and the dispatch cooldown is wiped (brief: rtbCooldown resets on arrest even if Air-1 was already home)
      if (this.state !== 'INACTIVE') this._stand(0);
      this.rtbCooldown = 0;
      this.gateT = 0;
      this._endPursuit();
      this._podsTick(dt, p);
      return;
    }
    const stars = wanted.stars;
    const pv = p.vehicle && !p.vehicle.isBoat ? p.vehicle : null;
    const px = p.px, pz = p.pz;
    const speed = p.vehicle ? Math.abs(p.vehicle.speedF) : Math.hypot(p.vx ?? 0, p.vz ?? 0);
    const vx = p.vehicle ? p.vehicle.vx : p.vx ?? 0, vz = p.vehicle ? p.vehicle.vz : p.vz ?? 0;
    if (Math.hypot(vx, vz) > 2) this._dir.set(vx, 0, vz).normalize();
    else if (p.vehicle) this._dir.set(Math.sin(p.vehicle.h), 0, Math.cos(p.vehicle.h));
    if (stars >= 3) this.pursuit.peak = Math.max(this.pursuit.peak, stars);
    if (stars === 0) this.rtbCooldown = 0;

    if (this.state === 'INACTIVE') {
      this.rtbCooldown = Math.max(0, this.rtbCooldown - dt);
      this.gateT = stars >= AIR_CFG.gateStars && this.rtbCooldown === 0 ? this.gateT + dt : 0;
      if (this.gateT >= AIR_CFG.gateTime) this._spawn({ x: px, z: pz });
      this._podsTick(dt, p);
      this._viewUpdate();
      this._prevInCar = p.inCar;
      return;
    }

    this.stateT += dt;
    this.fuelT += dt;
    if (stars === 0) return this._stand(0); // _onWantedZero normally got there first
    this._fly(dt, px, pz, vx, vz, stars);
    this._aim(dt, px, pz, p, stars);
    this._logic(dt, p, pv, px, pz, speed, stars);
    this._podsTick(dt, p);
    this._animate(dt);
    this._viewUpdate();
    this._prevInCar = p.inCar;
  }

  _tickToast(dt) {
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) this.toast = null;
    }
  }

  // Movement for the current state: acceleration-limited chase of a goal point at a state-dependent top speed.
  _fly(dt, px, pz, pvx, pvz, stars) {
    const tier = starTier(stars);
    const A = AIR_CFG;
    let gx = px, gz = pz, vmax = A.speed[tier], altTarget = A.alt[tier], ffx = 0, ffz = 0;
    const d = this._dir;
    const distP = Math.hypot(px - this.pos.x, pz - this.pos.z); // INBOUND uses it to ease from 58 m down to the cruise altitude
    switch (this.state) {
      case 'INBOUND':
        // 42 m/s per the brief, but never slower than the target + 6 m/s: a flat-out Vesper (51 m/s) would otherwise leave Air-1 flying INBOUND forever
        vmax = Math.max(A.inboundSpeed, Math.hypot(pvx, pvz) + 6);
        gx = px + pvx * 1.0;
        gz = pz + pvz * 1.0;
        altTarget = A.alt[tier] + (A.inboundAlt - A.alt[tier]) * clamp((distP - A.trackDist) / (A.inboundBack - A.trackDist), 0, 1);
        break;
      case 'TRACKING':
      case 'LOCKED': {
        // 28 m behind and abeam (right of the heading), riding along with the target's velocity
        const rx = -d.z, rz = d.x;
        gx = px - d.x * A.offset * 0.77 + rx * A.offset * 0.64;
        gz = pz - d.z * A.offset * 0.77 + rz * A.offset * 0.64;
        ffx = pvx;
        ffz = pvz;
        break;
      }
      case 'SEARCHING': {
        const t = this.searchT;
        const ang = 0.4 + A.spiralW * t;
        const r = A.spiralR0 + A.spiralK * t;
        gx = this.lastKnown.x + Math.cos(ang) * r;
        gz = this.lastKnown.z + Math.sin(ang) * r;
        break;
      }
      case 'REFUEL_RTB': {
        const dx = PAD.x - this.pos.x, dz = PAD.z - this.pos.z, L = Math.hypot(dx, dz) || 1;
        gx = this.pos.x + (dx / L) * 400;
        gz = this.pos.z + (dz / L) * 400;
        vmax = A.rtbSpeed;
        altTarget = this.pos.y - this.world.layout.groundHeightAt(this.pos.x, this.pos.z) + 40;
        break;
      }
      default:
    }
    const dx = gx - this.pos.x, dz = gz - this.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    const want = Math.min(vmax, L * 0.9 + Math.hypot(ffx, ffz) * 0.6);
    let tvx = (dx / L) * want + ffx * (this.state === 'TRACKING' || this.state === 'LOCKED' ? 0.8 : 0);
    let tvz = (dz / L) * want + ffz * (this.state === 'TRACKING' || this.state === 'LOCKED' ? 0.8 : 0);
    const tl = Math.hypot(tvx, tvz);
    if (tl > vmax) {
      tvx *= vmax / tl;
      tvz *= vmax / tl;
    }
    const ax = tvx - this.vel.x, az = tvz - this.vel.z;
    const al = Math.hypot(ax, az);
    const amax = A.accel * dt;
    const k = al > amax ? amax / al : 1;
    const ox = this.vel.x, oz = this.vel.z;
    this.vel.x += ax * k;
    this.vel.z += az * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // vertical: follow the terrain at the state's altitude (climbs faster when leaving)
    const gy = this.world.layout.groundHeightAt(this.pos.x, this.pos.z);
    const yTarget = gy + altTarget;
    const vy = this.state === 'REFUEL_RTB' ? A.rtbClimb : 8;
    this.pos.y += clamp(yTarget - this.pos.y, -vy * dt, vy * dt);
    // attitude: nose toward the target when working it, otherwise along the flight path; bank into lateral acceleration, nose-down with speed
    const sp = Math.hypot(this.vel.x, this.vel.z);
    let faceX = this.vel.x, faceZ = this.vel.z;
    if (this.state === 'TRACKING' || this.state === 'LOCKED') {
      faceX = px - this.pos.x;
      faceZ = pz - this.pos.z;
    }
    if (Math.hypot(faceX, faceZ) > 0.5) {
      const ty = Math.atan2(faceX, faceZ);
      let dy = ty - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += clamp(dy, -1.4 * dt, 1.4 * dt);
    }
    const lat = ((this.vel.x - ox) * Math.cos(this.yaw) - (this.vel.z - oz) * Math.sin(this.yaw)) / Math.max(dt, 1e-3);
    this.bank += (clamp(lat / A.accel, -1, 1) * 18 * DEG - this.bank) * Math.min(1, 3 * dt);
    this.pitch += (clamp(sp / A.speed[5], 0, 1) * 10 * DEG - this.pitch) * Math.min(1, 3 * dt);
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
    this.group.updateMatrixWorld(true);
  }

  // Slew the searchlight toward its aim point at the star-dependent rate, then derive the ground disc and the line of sight.
  _aim(dt, px, pz, p, stars) {
    const A = AIR_CFG;
    const w = this.world;
    const g = this._gimbal(this._tmp);
    let ax = px, az = pz;
    if (this.state === 'SEARCHING') {
      // the beam sweeps a ring wider than the disc itself (R is ~8-10 m), otherwise a player standing on the last-known spot would sit inside it forever
      const s = this.time * 1.3;
      ax = this.lastKnown.x + Math.cos(s) * AIR_CFG.sweepR;
      az = this.lastKnown.z + Math.sin(s) * AIR_CFG.sweepR;
    } else if (this.state === 'REFUEL_RTB' || this.state === 'INBOUND') {
      ax = this.pos.x + this.vel.x * 0.6;
      az = this.pos.z + this.vel.z * 0.6;
    }
    const ay = w.layout.groundHeightAt(ax, az);
    const des = this._tmp2.set(ax - g.x, ay - g.y, az - g.z).normalize();
    this._q.setFromUnitVectors(this.axis, des);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(this._q.w)));
    const step = A.slew[starTier(stars)] * DEG * dt;
    const k = ang > 1e-5 ? Math.min(1, step / ang) : 1;
    this._qs.identity().slerp(this._q, k);
    this.axis.applyQuaternion(this._qs).normalize();
    // disc centre = where the beam axis meets the ground; R = h * tan(13 deg)
    const gy = w.layout.groundHeightAt(px, pz);
    const t = this.axis.y < -0.05 ? (gy - g.y) / this.axis.y : 400;
    this.disc.x = g.x + this.axis.x * t;
    this.disc.z = g.z + this.axis.z * t;
    this.disc.gy = gy;
    this.disc.R = Math.max(2, (g.y - gy) * Math.tan(A.cone));
    this._gpos = { x: g.x, y: g.y, z: g.z };
    const ty = (p.vehicle ? p.vehicle.y : p.y ?? gy) + 1.0;
    this.losClear = this._los(g.x, g.y, g.z, px, ty, pz);
    this._drawLight(g, this.axis);
  }

  // Segment vs the static cover boxes (buildings, containers, warehouses, tall poles) along the line from the gimbal to the target.
  _los(gx, gy, gz, tx, ty, tz) {
    const grid = this.world.collision.grid;
    const dx = tx - gx, dy = ty - gy, dz = tz - gz;
    const n = Math.max(2, Math.ceil(Math.hypot(dx, dz) / 6));
    const seen = this._seen;
    seen.clear();
    for (let s = 0; s <= n; s++) {
      const cx = Math.floor((gx + (dx * s) / n) / COVER_CELL), cz = Math.floor((gz + (dz * s) / n) / COVER_CELL);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const list = grid.get(ix * 4096 + iz);
          if (!list) continue;
          for (const c of list) {
            if (seen.has(c)) continue;
            seen.add(c);
            const x0 = c.type === 'aabb' ? c.x0 : c.x - c.r, x1 = c.type === 'aabb' ? c.x1 : c.x + c.r;
            const z0 = c.type === 'aabb' ? c.z0 : c.z - c.r, z1 = c.type === 'aabb' ? c.z1 : c.z + c.r;
            if ((c.h ?? 0) < (c.type === 'aabb' ? 4 : 6)) continue; // palms, lamps and benches do not hide a car from a helicopter
            if (this._segBox(gx, gy, gz, dx, dy, dz, x0, 0, z0, x1, c.h, z1)) return false;
          }
        }
      }
    }
    return true;
  }

  _segBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
    let t0 = 0, t1 = 0.985; // stop just short of the target so the car's own roadside box does not count
    const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < lo[a] || o[a] > hi[a]) return false;
      } else {
        let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) return false;
      }
    }
    return true;
  }

  _drawLight(g, axis) {
    const pos = this.light.geometry.getAttribute('position');
    const col = this.light.geometry.getAttribute('color');
    const A = AIR_CFG;
    // basis around the axis
    const up = Math.abs(axis.y) > 0.95 ? this._tmp2.set(1, 0, 0) : this._tmp2.set(0, 1, 0);
    const ux = up.y * axis.z - up.z * axis.y, uy = up.z * axis.x - up.x * axis.z, uz = up.x * axis.y - up.y * axis.x;
    const ul = Math.hypot(ux, uy, uz);
    const U = [ux / ul, uy / ul, uz / ul];
    const V = [axis.y * U[2] - axis.z * U[1], axis.z * U[0] - axis.x * U[2], axis.x * U[1] - axis.y * U[0]];
    const gy = this.disc.gy + 0.06;
    const sc = Math.sin(A.cone), cc = Math.cos(A.cone);
    pos.setXYZ(0, g.x, g.y, g.z);
    const lock = clamp(this.lockTimer / A.lockAt, 0, 1);
    const c = this._c.copy(ICE).lerp(AMBER, this.state === 'LOCKED' ? 1 : lock * 0.8);
    const I = (this.losClear ? 1 : 0.35) * (this.state === 'INBOUND' || this.state === 'REFUEL_RTB' ? 0.55 : 1);
    col.setXYZ(0, c.r * 0.05 * I, c.g * 0.05 * I, c.b * 0.05 * I); // apex: brightest. Vertex colours are linear and get sRGB-encoded before the additive blend, so these are tiny on purpose
    let cx = 0, cz = 0;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let dx = axis.x * cc + (U[0] * ca + V[0] * sa) * sc;
      let dy = axis.y * cc + (U[1] * ca + V[1] * sa) * sc;
      let dz = axis.z * cc + (U[2] * ca + V[2] * sa) * sc;
      if (dy > -0.05) dy = -0.05;
      const t = (gy - g.y) / dy;
      const x = g.x + dx * t, z = g.z + dz * t;
      pos.setXYZ(1 + i, x, gy, z);
      pos.setXYZ(14 + i, x, gy + 0.02, z);
      col.setXYZ(1 + i, c.r * 0.004 * I, c.g * 0.004 * I, c.b * 0.004 * I);
      col.setXYZ(14 + i, c.r * 0.03 * I, c.g * 0.03 * I, c.b * 0.03 * I);
      cx += x;
      cz += z;
      void dx; void dz;
    }
    pos.setXYZ(13, cx / SEG, gy + 0.02, cz / SEG);
    col.setXYZ(13, c.r * 0.06 * I, c.g * 0.06 * I, c.b * 0.06 * I);
    pos.needsUpdate = col.needsUpdate = true;
  }

  // ---------- state logic ----------

  _logic(dt, p, pv, px, pz, speed, stars) {
    const A = AIR_CFG;
    const wanted = this.world.wanted;
    const pu = this.pursuit;
    const dHeli = Math.hypot(px - this.pos.x, pz - this.pos.z);
    const dDisc = Math.hypot(px - this.disc.x, pz - this.disc.z);
    const inDisc = dDisc <= this.disc.R;
    // audio feed (Doppler): closing speed from the change in distance
    this.audio.dist = Math.hypot(dHeli, this.pos.y - (p.vehicle ? p.vehicle.y : 0));
    if (this._prevDist !== null) this.audio.closing += ((-(this.audio.dist - this._prevDist)) / Math.max(dt, 1e-3) - this.audio.closing) * Math.min(1, 6 * dt);
    this._prevDist = this.audio.dist;
    this.audio.active = true;

    // Cold Swap: on foot to a different civilian car while Air-1 is searching and cannot see the player
    const nowInCar = p.inCar && !p.vehicle.isBoat;
    if (nowInCar && !this._prevInCar && this.state === 'SEARCHING' && p.vehicle.id !== this.trackedVehicleId && (!this.losClear || !inDisc)) {
      this.decoyCloak = true;
      pu.cold = 1;
      this.world.notify('DECOY CLOAK  -  Air-1 lost your car', 'info');
    }
    if (this.decoyCloak && nowInCar && p.vehicle.id === this.trackedVehicleId) this.decoyCloak = false;

    // fuel: bingo after 150 s on station
    if (this.state !== 'REFUEL_RTB' && this.fuelT >= A.fuel) {
      this.world.notify('AIR-1 BINGO FUEL', 'info');
      this._to('REFUEL_RTB');
      return;
    }
    if (stars < 3 && this.state !== 'REFUEL_RTB') {
      this._to('REFUEL_RTB');
      return;
    }

    switch (this.state) {
      case 'INBOUND':
        if (dHeli <= A.trackDist) this._to('TRACKING');
        break;
      case 'TRACKING': {
        if (this.losClear && inDisc) this.lockTimer += A.lockUp * dt;
        else this.lockTimer = Math.max(0, this.lockTimer - A.lockDown * dt);
        this.losFailT = this.losClear ? 0 : this.losFailT + dt;
        if (this.lockTimer >= A.lockAt) {
          this.lockTimer = A.lockAt;
          this.trackedVehicleId = p.vehicle ? p.vehicle.id : null;
          this._to('LOCKED');
        } else if (this.losFailT >= A.losBreak || dHeli > A.loseDist) this._lose(px, pz);
        break;
      }
      case 'LOCKED': {
        pu.lockedTotal += dt;
        this.lockTimer = A.lockAt;
        this.bcT -= dt;
        if (this.bcT <= 0) {
          this.bcT = 1.0;
          wanted.broadcastAirTarget({ x: px, z: pz });
        }
        this.losFailT = this.losClear ? 0 : this.losFailT + dt;
        this.breakT = this.losClear && dDisc > this.disc.R * A.breakFactor ? this.breakT + dt : 0;
        this._maybeDrop(dt, p, stars, speed);
        if (this.losFailT >= A.losBreak || dHeli > A.lockedLoseDist) this._lose(px, pz);
        else if (this.breakT >= A.breakTime) {
          this.lockTimer = A.lockAt * 0.5;
          this._to('TRACKING');
        }
        break;
      }
      case 'SEARCHING': {
        this.searchT += dt;
        wanted.airDecayBoost = 1.25; // wanted.update only applies it once no cruiser is within sight range, so "cruisers also lack LOS" is enforced there
        // re-acquisition: proximity (off while cloaked), the ground disc, or a reckless dash near the chopper
        let seen = this.losClear && inDisc;
        if (!this.decoyCloak && this.losClear && dHeli <= A.reacquire) seen = true;
        if (this.decoyCloak && speed > A.cloakSpeed && dHeli <= A.cloakNear && this.losClear) seen = true;
        if (seen) {
          this.decoyCloak = false;
          this.lockTimer = inDisc ? A.lockAt * 0.6 : 0;
          this._to('TRACKING');
        } else if (this.searchT >= A.searchMax) {
          wanted.applyAirSearchDrop();
          if (this.state !== 'INACTIVE') this._to('REFUEL_RTB');
        }
        break;
      }
      case 'REFUEL_RTB':
        this.rtbT += dt;
        if (dHeli >= A.rtbEnd || this.rtbT >= A.rtbMax) this._stand(wanted.stars === 0 ? 0 : A.rtbCooldown);
        break;
      default:
    }
  }

  _lose(px, pz) {
    this.lastKnown.x = px;
    this.lastKnown.z = pz;
    if (this.trackedVehicleId === null && this.world.player.vehicle) this.trackedVehicleId = this.world.player.vehicle.id;
    this.lockTimer = 0;
    this._to('SEARCHING');
  }

  // ---------- spike pods ----------

  _maybeDrop(dt, p, stars, speed) {
    const A = AIR_CFG;
    const pu = this.pursuit;
    pu.dropClock += dt;
    pu.sinceDrop += dt;
    if (pu.dropClock < A.dropEvery) return;
    pu.dropClock = 0;
    if (stars < 4 || !p.vehicle || p.vehicle.isBoat || speed < A.dropSpeed) return;
    const prob = pu.sinceDrop >= A.dropForce ? 1 : A.dropProb[starTier(stars)];
    if (this._rand() > prob) return;
    const pod = this.pods.find((q) => q.state === 'free');
    if (!pod) return;
    const spot = this._solveDrop(p.vehicle);
    if (!spot) return;
    pu.sinceDrop = 0;
    Object.assign(pod, { state: 'drop', t: 0, x: this.pos.x, y: this.pos.y - 1.5, z: this.pos.z, tx: spot.x, tz: spot.z, ty: this.world.layout.groundHeightAt(spot.x, spot.z), hl: spot.hl, hit: false, near: false, nearMin: 1e9, nearSpeed: 0, hotT: 0 });
    this.world.emit('airSpikeDrop');
  }

  // Deterministic xorshift so the drop roll is reproducible in tests.
  _rand() {
    this._seed = (this._seed ?? 0x5a17ea1) >>> 0;
    this._seed ^= this._seed << 13;
    this._seed >>>= 0;
    this._seed ^= this._seed >>> 17;
    this._seed ^= this._seed << 5;
    this._seed >>>= 0;
    return this._seed / 4294967296;
  }

  // p_lead = p_player + v * 2.2 s, snapped to the nearest lane centreline; shortened until it lies within 75 m of the chopper and clear of junctions.
  _solveDrop(v) {
    const A = AIR_CFG;
    const net = this.world.net;
    const sp = Math.hypot(v.vx, v.vz) || 1;
    const fx = v.vx / sp, fz = v.vz / sp;
    for (let lead = A.leadT; lead >= 0.8; lead -= 0.3) {
      let x = v.x + v.vx * lead, z = v.z + v.vz * lead;
      let hl = Math.atan2(fx, fz);
      const alongX = Math.abs(fx) >= Math.abs(fz);
      const d = alongX ? (fx > 0 ? 0 : 1) : fz > 0 ? 2 : 3;
      const [ni, nj] = net.nearestNode(x, z);
      const r = rightOf(d);
      if (alongX) {
        z = net.zs[nj] + r.z * LANE;
        const dxn = x - net.xs[ni];
        if (Math.abs(dxn) < 14) x = net.xs[ni] + Math.sign(dxn || fx) * 14; // keep off the junction box
      } else {
        x = net.xs[ni] + r.x * LANE;
        const dzn = z - net.zs[nj];
        if (Math.abs(dzn) < 14) z = net.zs[nj] + Math.sign(dzn || fz) * 14;
      }
      hl = DIRS[d].h;
      if (Math.hypot(x - this.pos.x, z - this.pos.z) <= A.maxRange) return { x, z, hl };
    }
    return null;
  }

  _podsTick(dt, p) {
    const A = AIR_CFG;
    const v = p.vehicle && !p.vehicle.isBoat ? p.vehicle : null;
    for (const pod of this.pods) {
      if (pod.state === 'free') continue;
      pod.t += dt;
      if (pod.state === 'drop') {
        const u = Math.min(1, pod.t / A.telegraph);
        pod.cx = pod.x + (pod.tx - pod.x) * u;
        pod.cz = pod.z + (pod.tz - pod.z) * u;
        pod.cy = pod.y + (pod.ty - pod.y) * u + 7 * u * (1 - u);
        if (pod.t >= A.telegraph) {
          pod.state = 'armed';
          pod.t = 0;
          pod.cx = pod.tx;
          pod.cz = pod.tz;
          pod.cy = pod.ty;
        }
        continue;
      }
      if (pod.t >= A.armedFor) {
        pod.state = 'free';
        continue;
      }
      if (!v) continue;
      const fx = Math.sin(pod.hl), fz = Math.cos(pod.hl);
      const strip = { x: pod.tx, z: pod.tz, ax: -fz, az: fx, hx: A.stripW / 2, hz: A.stripD / 2 };
      if (!pod.hit && v.puncturedTimer <= 0 && obbOverlap(strip, vehicleBox(v))) {
        pod.hit = true;
        const side = Math.sign((v.x - pod.tx) * -fz + (v.z - pod.tz) * fx) || 1;
        v.puncture(side * 0.35);
        this.world.emit('airPuncture');
        this.world.notify('TIRE BLOWN  -  run-flat 9 s', 'warn');
        continue;
      }
      // near-miss bookkeeping: counts as a dodge once we leave the 8 m bubble at speed without touching the strip
      const dx = v.x - pod.tx, dz = v.z - pod.tz;
      const along = Math.max(0, Math.abs(dx * -fz + dz * fx) - A.stripW / 2); // distance beyond the strip's ends
      const dist = Math.hypot(along, dx * fx + dz * fz);
      if (!pod.hit) {
        if (dist < A.dodgeRange) {
          pod.near = true;
          if (dist < pod.nearMin) {
            pod.nearMin = dist;
            pod.nearSpeed = Math.abs(v.speedF);
          }
        } else if (pod.near) {
          pod.near = false;
          if (pod.nearSpeed >= A.dodgeSpeed && this.pursuit.dodged < A.dodgeMax) {
            this.pursuit.dodged++;
            this.world.notify(`SPIKE STRIP DODGED  x${this.pursuit.dodged}`, 'info');
          }
          pod.nearMin = 1e9;
        }
      }
    }
    // orange rim sparks while a punctured car is still moving
    if (v && v.puncturedTimer > 0 && Math.abs(v.speedF) > 3) {
      const sh = Math.sin(v.h), ch = Math.cos(v.h);
      for (const s of [-1, 1]) {
        if (Math.random() > 0.7) continue;
        const lx = (s * v.type.wid) / 2, lz = -v.type.len * 0.3;
        this.sparks.emit(v.x + ch * -lx + sh * lz, v.y + 0.2, v.z - sh * -lx + ch * lz, (Math.random() - 0.5) * 3 - v.vx * 0.15, 1 + Math.random() * 2.2, (Math.random() - 0.5) * 3 - v.vz * 0.15, 0.4 + Math.random() * 0.3);
      }
    }
    this.sparks.update(dt);
    this._writePods();
  }

  _writePods() {
    const A = AIR_CFG;
    let any = false;
    const m = this._m, q = this._q, s = this._tmp, e = this._e;
    for (let i = 0; i < 3; i++) {
      const pod = this.pods[i];
      if (pod.state !== 'drop') {
        m.makeScale(0, 0, 0);
        this.podMesh.setMatrixAt(i + 3, m); // no landing marker unless the pod is in the air
      }
      if (pod.state === 'free') {
        m.makeScale(0, 0, 0);
        this.podMesh.setMatrixAt(i, m);
        continue;
      }
      any = true;
      const flash = Math.floor(this.time * (pod.state === 'drop' ? 8 : 3)) % 2;
      this._c.setRGB(flash ? 1 : 0.55, flash ? 1 : 0.55, flash ? 1 : 0.5);
      this.podMesh.setColorAt(i, this._c);
      if (pod.state === 'drop') {
        e.set(0, pod.hl + pod.t * 14, 0, 'YXZ');
        q.setFromEuler(e);
        s.set(0.5, 0.5, 0.5);
        m.compose(this._tmp2.set(pod.cx, pod.cy, pod.cz), q, s);
        // flashing footprint on the asphalt where the strip will lie (telegraph ring + strip outline), brightest just before arming
        this._c.setRGB(flash ? 1 : 0.35, flash ? 0.85 : 0.3, flash ? 0.2 : 0.3);
        this.podMesh.setColorAt(i + 3, this._c);
        e.set(0, pod.hl, 0, 'YXZ');
        const ground = new THREE.Matrix4().compose(this._tmp.set(pod.tx, pod.ty + 0.03, pod.tz), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 0.05, 1));
        this.podMesh.setMatrixAt(i + 3, ground);
      } else {
        const left = A.armedFor - pod.t;
        const k = left < 0.6 ? left / 0.6 : Math.min(1, pod.t / 0.12); // snap flat on arm, shrink at the end
        e.set(0, pod.hl, 0, 'YXZ');
        q.setFromEuler(e);
        s.set(1, Math.max(0.01, k), 1);
        m.compose(this._tmp2.set(pod.cx, pod.cy + 0.02, pod.cz), q, s);
      }
      this.podMesh.setMatrixAt(i, m);
    }
    this.podMesh.visible = any;
    this.podMesh.instanceMatrix.needsUpdate = true;
    if (this.podMesh.instanceColor) this.podMesh.instanceColor.needsUpdate = true;
    this.podCount = this.pods.filter((p) => p.state !== 'free').length;
  }

  // ---------- visuals / HUD data ----------

  _animate(dt) {
    this.rotor.rotation.y += 38 * dt;
    this.tail.rotation.x += 72 * dt;
    const on = Math.floor(this.time * 6) % 2 === 0;
    const a = this.tab.attr;
    const half = (this.tab.end - this.tab.start) / 2;
    for (let i = this.tab.start; i < this.tab.end; i++) {
      const first = i - this.tab.start < half; // port tab = red, starboard tab = blue
      const lit = first ? on : !on;
      if (first) a.setXYZ(i, lit ? 1 : 0.25, lit ? 0.25 : 0.05, lit ? 0.25 : 0.05);
      else a.setXYZ(i, lit ? 0.3 : 0.05, lit ? 0.55 : 0.1, lit ? 1 : 0.25);
    }
    a.needsUpdate = true;
  }

  _viewUpdate() {
    const A = AIR_CFG;
    const v = this.view;
    v.state = this.state;
    v.cloak = this.decoyCloak && this.active;
    v.pulse = false;
    v.glare = 0;
    switch (this.state) {
      case 'INBOUND':
        v.label = 'AIR-1 INBOUND';
        v.color = '#ffffff';
        v.fill = 0;
        break;
      case 'TRACKING':
        v.label = 'SPOTLIGHT TRACKING';
        v.color = '#bfe6ff';
        v.fill = clamp(this.lockTimer / A.lockAt, 0, 1);
        v.glare = this.losClear ? v.fill : 0;
        break;
      case 'LOCKED':
        v.label = 'VISUAL LOCK';
        v.color = '#ff4d4d';
        v.fill = 1;
        v.pulse = true;
        v.glare = 1;
        break;
      case 'SEARCHING':
        v.label = `AIR-1 SEARCHING ${Math.max(0, Math.ceil(A.searchMax - this.searchT))}s`;
        v.color = '#ffb347';
        v.fill = clamp(1 - this.searchT / A.searchMax, 0, 1);
        break;
      case 'REFUEL_RTB':
        v.label = 'AIR-1 RETURNING';
        v.color = '#c8d0dc';
        v.fill = 0;
        break;
      default:
        v.label = '';
        v.fill = 0;
    }
  }

  // Minimap data: the ground disc plus the rotor and strips, in world coordinates.
  get mapView() {
    if (!this.active) return null;
    return { x: this.pos.x, z: this.pos.z, yaw: this.yaw, disc: this.disc, locked: this.state === 'LOCKED', pods: this.pods.filter((p) => p.state !== 'free'), time: this.time };
  }
}

// ---------- ?shot=airpursuit ----------

// Deterministic hero frame: a coupe drifting down the coast road at 4 stars with Air-1 banked overhead, the searchlight pinning it, one armed strip beside it and two cruisers behind.
export function setupAirPursuitShot(world, air, hud, ui) {
  const NO_MOUSE = { dx: 0, dy: 0 };
  const still = document.createElement('style'); // freeze CSS pops/pulses so the HUD is captured in the same state on every load
  still.textContent = '*{animation:none!important;transition:none!important}';
  document.head.appendChild(still);
  const idle = { down: () => false, pressed: () => false };
  const L = world.layout;
  ui.showTitle(false);
  hud.show(true);
  const j = L.zs.length - 1;
  const i = 2;
  const lane = world.net.lanePoint(i, j, 0, 40); // east-bound lane on the beach side of the coast road
  for (const v of [...world.vehicles.list]) if (v.kind === 'parked' && Math.hypot(v.x - lane.x, v.z - lane.z) < 45) world.vehicles.remove(v);
  const h = Math.PI / 2 + 11 * DEG; // nose 11 degrees off the direction of travel: mid-drift
  const car = world.vehicles.spawn('vesper', 0xe8447a, lane.x, lane.z, h);
  car.vx = 26;
  car.vz = 0;
  car.speedF = 26 * Math.cos(11 * DEG);
  world.placeInCar(car);
  world.cash = 3850;
  world.rig.yaw = Math.PI / 2;
  world.wanted.setHeat(8.6); // four stars
  world.district = L.districtAt(car.x, car.z);
  const warm = (n) => {
    for (let k = 0; k < n; k++) world.update(1 / 60, idle, NO_MOUSE);
  };
  warm(1); // one deterministic warm-up tick, then everything is placed by hand
  world.police.clearAll();
  const P = { x: car.x, z: car.z, y: car.y };
  const F = { x: Math.sin(h), z: Math.cos(h) };
  const R = { x: -Math.cos(h), z: Math.sin(h) };
  const at = (f, r) => ({ x: P.x + F.x * f + R.x * r, z: P.z + F.z * f + R.z * r });
  // cruisers behind, civilians oncoming in the far lane, walkers on the sidewalk
  const cops = [world.police.spawnAt(i, j, 0, 25), world.police.spawnAt(i, j, 0, 17)];
  for (const [cop, f, r] of [[cops[0], -15, 1.8], [cops[1], -23, -2.2]]) {
    const q = at(f, r);
    cop.v.x = q.x;
    cop.v.z = q.z;
    cop.v.h = Math.PI / 2;
    cop.v.vx = cop.v.vz = 0;
    cop.v._syncMesh();
  }
  const T = world.traffic;
  for (const f of [-10, -32, -52]) T.spawnAt(i, j, 1, P.x + F.x * f, L.zs[j] - LANE); // west-bound lane = the far lane
  const ped = world.peds.list;
  const A_ = { i, j, sx: 1, sz: 1 }, B_ = { i: i + 1, j, sx: -1, sz: 1 };
  [[0, 0.1], [1, 0.22], [2, 0.38], [3, 0.5]].forEach(([k, t]) => world.peds.placeBetween(ped[k], A_, B_, t));
  // Air-1 and the beam
  air.stageLocked(P, F, R, h);
  world.messages.length = 0; // no stale "WANTED" toast over the picture
  hud.update(1 / 60, world);
  // camera: low, ahead and to the right of the coupe, looking back and up at the chopper
  const cam = world.camera;
  cam.fov = 54;
  cam.updateProjectionMatrix();
  cam.position.set(P.x + R.x * 9.5 + F.x * 16.5, P.y + 4.2, P.z + R.z * 9.5 + F.z * 16.5);
  cam.lookAt(P.x - R.x * 3 - F.x * 5, P.y + 8.5, P.z - R.z * 3 - F.z * 5);
  cam.updateMatrixWorld(true);
  world.env.update(0, cam, world.focusPoint); // sky dome, sun glow and sea follow the final camera (as in shots.js), so two loads render identically
}

// Hand-placed LOCKED frame (used only by the screenshot preset).
AirPursuit.prototype.stageLocked = function stageLocked(P, F, R, h) {
  const world = this.world;
  const wanted = world.wanted;
  this.pursuit.peak = 4;
  this.pursuit.lockedTotal = 3;
  this.state = 'LOCKED';
  this.stateT = 0;
  this.lockTimer = AIR_CFG.lockAt;
  this.trackedVehicleId = world.player.vehicle.id;
  this.group.visible = this.light.visible = true;
  this.pos.set(P.x - R.x * 9 - F.x * 12, P.y + 21, P.z - R.z * 9 - F.z * 12);
  this.vel.set(F.x * 20, 0, F.z * 20);
  this.yaw = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
  this.bank = -18 * DEG;
  this.pitch = 10 * DEG;
  this.group.position.copy(this.pos);
  this.group.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
  this.group.updateMatrixWorld(true);
  const g = this._gimbal(this._tmp);
  const tx = P.x + F.x * 1.2, tz = P.z + F.z * 1.2;
  this.axis.set(tx - g.x, P.y - g.y, tz - g.z).normalize();
  this.disc.x = tx;
  this.disc.z = tz;
  this.disc.gy = P.y;
  this.disc.R = (g.y - P.y) * Math.tan(AIR_CFG.cone);
  this.losClear = true;
  this._drawLight(g, this.axis);
  this._animate(0.016);
  this.rotor.rotation.y = 0.5;
  // one armed strip beside the car
  const pod = this.pods[0];
  const px = P.x - R.x * 3.8 - F.x * 3.5, pz = P.z - R.z * 3.8 - F.z * 3.5;
  Object.assign(pod, { state: 'armed', t: 2, tx: px, tz: pz, cx: px, cz: pz, cy: P.y, ty: P.y, hl: Math.PI / 2, hit: false, near: false, nearMin: 1e9, nearSpeed: 0 });
  this.time = 0.2; // fixed clock: strobes, pulses and the pod flash are identical on every load
  this._writePods();
  wanted.setAirLockFreeze(true);
  this._viewUpdate();
  this.audio.active = true;
  void h;
};
