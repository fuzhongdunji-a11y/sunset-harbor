// customs: Solaris Customs, the drive-in tuning garage. Lot placement (findCustomsLot), the garage meshes, the CustomsState machine
// (IDLE_OPEN -> PULLING_IN -> IN_BAY_MENU -> SPRAY_SEQUENCE -> EXITING_BAY -> COOLDOWN), Hot Respray heat-wipe, the Export Board and the Recall Signature Ride pad.
// Prices, stats and payout maths live in customsCatalog.js; geometry in customsModel.js.
import * as THREE from '../vendor/three.module.min.js';
import { WORLD } from './config.js';
import { makeRng } from './rng.js';
import { buildCarModel, PAINTS } from './vehicleModels.js';
import { angleLerp } from './player.js';
import * as M from './customsModel.js';
import * as C from './customsCatalog.js';

const { BAY, PAD, RECALL, SLATE } = M;
const PARCEL = { x0: -15.5, x1: 4.5, z0: -14, z1: 4.5 }; // lot-local rectangle that must be clear
const HOME = { x: -84, z: 62 };
const CATS = ['QUICK SERVICE', 'SUNSET PAINT', 'RIM & TRIM KIT', 'ENGINE & TURBO', 'REINFORCED CHASSIS', 'NITROUS PURGE'];
const ORBIT = { radius: 3.4, height: 2.0, speed: 0.28 };
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const fmt = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// ---- lot placement ----------------------------------------------------------------------------------------------------
const frameOf = (ax, az, fx, fz) => { const h = Math.atan2(fx, fz); return { ax, az, h, fx, fz, lx: Math.cos(h), lz: -Math.sin(h) }; };
export const toWorld = (L, x, z) => [L.ax + x * L.lx + z * L.fx, L.az + x * L.lz + z * L.fz];
export const toLocal = (L, x, z) => { const dx = x - L.ax, dz = z - L.az; return [dx * L.lx + dz * L.lz, dx * L.fx + dz * L.fz]; };
function worldRect(L, r) {
  const a = toWorld(L, r[0], r[1]), b = toWorld(L, r[2], r[3]);
  return { x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]) };
}
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

// Pick the parcel nearest (-84, 62) on a block edge (building line facing a street) within 140 m of the origin, clear the buildings and street props on it.
// Mutates the layout (call before buildCity). Deterministic: ties are broken with the SOLR-seeded rng.
export function findCustomsLot(layout) {
  const rng = makeRng(C.CUSTOMS_SEED);
  const half = WORLD.blockSize / 2 - WORLD.sidewalk;
  let best = null;
  for (const blk of layout.blocks) {
    if (blk.park) continue;
    for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let t = -17.5; t <= 17.5; t += 5) {
        const lx = Math.cos(Math.atan2(fx, fz)), lz = -Math.sin(Math.atan2(fx, fz));
        const ax = blk.cx + fx * half + lx * (t + 5.5), az = blk.cz + fz * half + lz * (t + 5.5);
        if (Math.hypot(ax, az) > 140 || az > 240 || Math.hypot(ax - layout.start.x, az - layout.start.z) < 45) continue;
        const L = frameOf(ax, az, fx, fz);
        const rect = worldRect(L, [PARCEL.x0, PARCEL.z0, PARCEL.x1, PARCEL.z1]);
        let area = 0;
        for (const b of layout.buildings) if (overlap(rect, b)) area += (b.x1 - b.x0) * (b.z1 - b.z0);
        const score = Math.hypot(ax - HOME.x, az - HOME.z) + 0.02 * area + 0.001 * rng();
        if (!best || score < best.score) best = { score, L, rect, blk };
      }
    }
  }
  const L = best.L;
  const gone = layout.buildings.filter((b) => overlap(best.rect, b));
  const strip = (arr, pred) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1); };
  const inRegion = (o, x0, z0, x1, z1) => { const [px, pz] = toLocal(L, o.x, o.z); return px > x0 && px < x1 && pz > z0 && pz < z1; };
  strip(layout.buildings, (b) => gone.includes(b));
  strip(layout.colliders, (c) => (c.type === 'aabb' && gone.some((b) => b.x0 === c.x0 && b.z0 === c.z0 && b.x1 === c.x1 && b.z1 === c.z1)) || (c.type === 'circle' && inRegion(c, -17, -15, 6.5, 6)));
  for (const k of ['palms', 'lamps', 'umbrellas', 'benches']) strip(layout[k], (o) => inRegion(o, -17, -15, 6.5, 6));
  strip(layout.slots, (s) => inRegion(s, -18, 2, 8, 14)); // no parked cars across the garage mouth
  return { L, y: layout.groundHeightAt(L.ax, L.az), removed: gone.length, block: { i: best.blk.i, j: best.blk.j } };
}

// ---- the system -------------------------------------------------------------------------------------------------------
export class SolarisCustoms {
  constructor(world, scene, lot) {
    this.world = world;
    this.L = lot.L;
    this.y = lot.y;
    this.block = lot.block; // grid cell the garage sits in (shot staging uses it to find the street and sidewalk corners)
    this.rng = makeRng(C.CUSTOMS_SEED + 1);
    this.state = 'IDLE_OPEN';
    this.t = 0;
    this.closed = 0; // shutter 0 = open .. 1 = down
    this.camW = 0;
    this.cool = 0; // door debounce after leaving
    this.heatCd = 0; // Hot Respray cooldown
    this.recheck = 0;
    this.armed = true;
    this.recallCd = 0;
    this.cat = 0;
    this.opt = [0, 0, 0, 0, 0, 0];
    this.cur = C.emptySpec();
    this.car = null;
    this.spray = null;
    this.visitPaid = false;
    this.build = null; // Personal Signature Slot
    this.exportCount = 0;
    this.firstUsed = false;
    this.warn = null;
    this.banner = null;
    this.matchT = 0;
    this.lastVehicle = null;
    this.ex = null; // delivery in progress
    this.waitT = 0; // restock countdown after a 6/6 set
    this.recallCar = null;
    this.prompt = '';
    this.time = 0;
    this._previewKey = '';
    this.shotMist = 0;
    this._buildMeshes(scene);
    this._board();
  }

  // ---- meshes and colliders
  _buildMeshes(scene) {
    const L = this.L;
    this.group = new THREE.Group();
    this.group.position.set(L.ax, this.y, L.az);
    this.group.rotation.y = L.h;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const stat = new THREE.Mesh(M.buildStaticGeometry(), mat);
    stat.castShadow = true;
    stat.receiveShadow = true;
    this.shutter = new THREE.Mesh(M.buildShutterGeometry(), mat);
    this.shutter.position.set(0, BAY.doorH, 0);
    this.glow = M.buildGlow();
    this.glowMesh = new THREE.Mesh(this.glow.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 4;
    this.mini = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.mini.scale.setScalar(0.38);
    this.mini.position.set(SLATE.x, SLATE.top, SLATE.z);
    this.group.add(stat, this.shutter, this.glowMesh, this.mini);
    scene.add(this.group);
    for (const r of M.COLLIDERS) world_insert(this.world.collision, worldRect(L, r), r[4]);
    this.shutterCol = world_insert(this.world.collision, worldRect(L, M.SHUTTER_COLLIDER), M.SHUTTER_COLLIDER[4]);
    this.shutterCol.off = true;
    this.glow.setColor('flash', 0, 0, 0);
    this.glow.setColor('strobe', 0, 0, 0);
    this._shutterApply();
  }

  _shutterApply() {
    this.shutter.scale.y = Math.max(0.02, this.closed);
    if (this.shutterCol) this.shutterCol.off = this.closed < 0.5;
  }

  get anchor() { return { x: this.L.ax, z: this.L.az }; }
  get bayCenter() { const [x, z] = toWorld(this.L, 0, BAY.center); return { x, z }; }
  get exportCenter() { const [x, z] = toWorld(this.L, PAD.x, PAD.z); return { x, z }; }
  get locked() { return this.state !== 'IDLE_OPEN' && this.state !== 'COOLDOWN'; }
  get sealed() { return this.locked; }
  get hasCameraOverride() { return this.camW > 0.001; }
  get panelOpen() { return this.state === 'IN_BAY_MENU' || this.state === 'SPRAY_SEQUENCE'; }
  get activeType() { return this.waitT > 0 ? null : this.board.order[this.board.idx]; }
  get activeSwatch() { return this.board.swatches[this.board.idx]; }
  get heatReady() { return this.heatCd <= 0; }

  // ---- Export Board
  _board() {
    const n = this.exportCount, cycle = Math.floor(n / 6);
    const b = C.exportCycle(cycle);
    this.board = { cycle, idx: n % 6, order: b.order, swatches: b.swatches };
    this._miniCar();
    this._pips();
  }

  _miniCar() {
    const type = this.board.order[this.board.idx];
    const m = buildCarModel(type, C.SWATCHES[this.board.swatches[this.board.idx]].hex);
    this.mini.geometry.dispose();
    this.mini.geometry = m.chassis.children[0].geometry;
  }

  _pips() {
    const lit = this.waitT > 0 ? 6 : this.board.idx;
    for (let i = 0; i < 6; i++) {
      if (i < lit) this.glow.setColor(`pip${i}`, 0.1, 2.2, 1.8);
      else if (i === lit) this.glow.setColor(`pip${i}`, 2.3, 1.6, 0.2);
      else this.glow.setColor(`pip${i}`, 0.12, 0.17, 0.25);
    }
  }

  get slateLabel() {
    if (this.waitT > 0) return `EXPORT BOARD  RESTOCKING ${Math.floor(this.waitT / 60)}:${String(Math.ceil(this.waitT % 60)).padStart(2, '0')}`;
    const t = this.activeType;
    return `EXPORT BOARD ${this.board.idx + 1}/6  ${C.EXPORT_NAMES[t]}  SWATCH ${C.SWATCHES[this.activeSwatch].name.toUpperCase()}  ${fmt(C.BASE_VALUE[t])}+`;
  }

  // ---- gates
  _copDistance() {
    const w = this.world, p = w.player;
    let d = w.police.nearest;
    if (w.air?.active) d = Math.min(d, Math.hypot(w.air.pos.x - p.px, w.air.pos.z - p.pz));
    return d;
  }

  _toast(text, kind = 'warn', buzz = true) {
    this.world.notify(text, kind);
    if (buzz) this.world.emit('custBuzz');
  }

  // Called every frame with the real input, before the simulation step.
  update(dt, input) {
    const w = this.world, p = w.player;
    this.time += dt;
    this.cool = Math.max(0, this.cool - dt);
    this.heatCd = Math.max(0, this.heatCd - dt);
    this.recallCd = Math.max(0, this.recallCd - dt);
    this.recheck = Math.max(0, this.recheck - dt);
    if (this.warn) this.warn.t -= dt;
    if (this.warn && this.warn.t <= 0) this.warn = null;
    if (this.banner) this.banner.t -= dt;
    if (this.banner && this.banner.t <= 0) this.banner = null;
    this.matchT = Math.max(0, this.matchT - dt);
    if (this.waitT > 0) {
      this.waitT -= dt;
      if (this.waitT <= 0) { this.waitT = 0; this._board(); }
      else if (Math.floor(this.waitT * 2) !== Math.floor((this.waitT + dt) * 2)) this._pips();
    }
    this.mini.rotation.y += dt * 0.9;
    this.prompt = '';
    if (this.locked && (w.fx || p.vehicle !== this.car)) this._abort();

    if (this.state === 'IDLE_OPEN' || this.state === 'COOLDOWN') {
      if (this.state === 'COOLDOWN' && this.cool <= 0) this.state = 'IDLE_OPEN';
      this._gate(dt);
    } else if (this.state === 'PULLING_IN') this._pulling(dt);
    else if (this.state === 'IN_BAY_MENU') this._menu(input, dt);
    else if (this.state === 'SPRAY_SEQUENCE') this._sprayStep(dt);
    else if (this.state === 'EXITING_BAY') this._exiting(dt);

    if (!this.locked) {
      this._exportLoop(dt, input);
      this._recall(input);
      this._matchWatch();
    }
    this._shutterAnim(dt);
    this._fx(dt);
  }

  _gate(dt) {
    const w = this.world, p = w.player, v = p.vehicle;
    if (!v || v.isBoat || w.fx || v.locked) return;
    const [lx, lz] = toLocal(this.L, v.x, v.z);
    const near = Math.abs(lx) < 6 && lz > -1 && lz < 16;
    const stars = w.wanted.stars;
    let reason = null;
    if (stars >= 5) reason = 'LOCKDOWN - TOO HOT: 5 STARS';
    else if (stars >= 1 && this._copDistance() < C.POLICE_GATE) reason = `LOSE LINE OF SIGHT! COPS ${Math.round(this._copDistance())}m AWAY (NEED ${C.POLICE_GATE}m)`;
    this.warn = near && reason ? { text: reason, t: 0.3, kind: 'warn' } : this.warn;
    const inTrigger = Math.abs(lx) <= 2.6 && lz >= -9.25 && lz <= -0.75;
    if (!inTrigger && (lz > 1 || Math.abs(lx) > 3.4)) this.armed = true; // a refused car must leave the mouth before the bay will take it (no trap)
    if (!inTrigger || this.state === 'COOLDOWN') return;
    const speed = Math.abs(v.speedF);
    if (this.armed === false) {
      if (v.vx * this.L.fx + v.vz * this.L.fz < 0) { // still rolling in: scrub speed before the back wall; reversing out is free
        const k = Math.exp(-4.5 * dt);
        v.vx *= k; v.vz *= k;
      }
      return;
    }
    if (reason || speed > C.ENTRY_MAX_SPEED) {
      this.armed = false;
      if (this.recheck <= 0) {
        this.recheck = 1.5;
        this.warn = { text: reason ?? 'SLOW DOWN TO ENTER BAY (< 58 KM/H)', t: 2.0, kind: 'warn' };
        this.world.emit('custBuzz');
      }
      if (speed > C.ENTRY_MAX_SPEED && !reason) {
        // the open bay is not a trap but it is a dead end: the car scrubs speed before the back wall
        const k = Math.exp(-4.5 * dt);
        v.vx *= k; v.vz *= k;
      }
      return;
    }
    this._beginEntry(v);
  }

  _beginEntry(v) {
    this.car = v;
    this.state = 'PULLING_IN';
    this.t = 0;
    v.frozen = true;
    v.input.throttle = 0;
    v.input.hand = false;
    this.from = { x: v.x, z: v.z, h: v.h };
    this.warn = null;
    this.cur = v.custom ? { paint: v.custom.paint, rim: v.custom.rim, engine: v.custom.engine, chassis: v.custom.chassis, n2o: v.custom.n2o } : C.emptySpec();
    this.visitPaid = false;
    this.world.emit('custShutterClose');
  }

  _faceH() { return this.L.h; }

  pin() {
    const v = this.car;
    if (!v || !(this.state === 'PULLING_IN' || this.state === 'IN_BAY_MENU' || this.state === 'SPRAY_SEQUENCE')) return;
    if (this.state === 'PULLING_IN') {
      const s = smooth(this.t / 0.65), c = this.bayCenter;
      v.x = this.from.x + (c.x - this.from.x) * s;
      v.z = this.from.z + (c.z - this.from.z) * s;
      v.h = angleLerp(this.from.h, this._faceH(), s);
    } else {
      const c = this.bayCenter;
      v.x = c.x; v.z = c.z; v.h = this._faceH();
    }
    v.vx = v.vz = v.speedF = 0;
    v.pitch = v.roll = 0;
    v._syncMesh();
  }

  _pulling(dt) {
    this.t += dt;
    this.pin();
    if (this.t >= 0.65) {
      this.state = 'IN_BAY_MENU';
      this.cat = 0;
      const rim = this.cur.rim;
      this.opt = [0, this._freshSwatch(), rim, Math.min(this.cur.engine, 2), Math.min(this.cur.chassis, 1), Math.min(this.cur.n2o, 1)];
      this.world.police.sealed = true;
    }
  }

  _freshSwatch() {
    let i;
    do i = this.rng.int(0, C.SWATCHES.length - 1); while (i === this.cur.paint);
    return i;
  }

  // ---- menu
  _quick() {
    const o = [{ id: 'service' }];
    if (this._differsFromBuild()) o.push({ id: 'fit' });
    return o;
  }

  _differsFromBuild() {
    const b = this.build, c = this.cur;
    return !!b && (b.rim !== c.rim || b.engine !== c.engine || b.chassis !== c.chassis || b.n2o !== c.n2o) && (b.engine + b.chassis + b.n2o + b.rim) > 0;
  }

  _count(cat) { return [this._quick().length, 8, 4, 3, 2, 2][cat]; }

  _menu(input, dt) {
    const up = input.pressed('KeyW', 'ArrowUp'), dn = input.pressed('KeyS', 'ArrowDown');
    if (up) this.cat = (this.cat + 5) % 6;
    if (dn) this.cat = (this.cat + 1) % 6;
    const n = this._count(this.cat);
    if (this.opt[this.cat] >= n) this.opt[this.cat] = 0;
    const l = input.pressed('KeyA', 'ArrowLeft'), r = input.pressed('KeyD', 'ArrowRight');
    if (l) this.opt[this.cat] = (this.opt[this.cat] + n - 1) % n;
    if (r) this.opt[this.cat] = (this.opt[this.cat] + 1) % n;
    if (up || dn || l || r) this.world.emit('custTick');
    this._preview();
    if (input.pressed('KeyR')) { this.cat = 0; this.opt[0] = 0; this._buy(); }
    else if (input.pressed('KeyE', 'Enter')) this._buy();
    else if (input.pressed('KeyQ', 'Backspace')) this._leave();
    this.pin();
  }

  _preview() {
    const c = this.cur, s = { ...c };
    if (this.cat === 1) s.paint = this.opt[1];
    if (this.cat === 2) s.rim = this.opt[2];
    const key = `${s.paint},${s.rim},${s.engine},${s.chassis},${s.n2o}`;
    if (key !== this._previewKey) {
      this._previewKey = key;
      this.car.applyCustom(s);
    }
  }

  _restoreCar() {
    this._previewKey = '';
    if (this.car) this.car.applyCustom(this.cur);
  }

  _pay(cost) {
    const w = this.world;
    if (cost > w.cash) { this._toast('NOT ENOUGH CASH', 'warn'); return false; }
    w.cash -= cost;
    w.saveRequested = true;
    return true;
  }

  _commit() {
    const c = this.cur;
    this.build = { type: this.car.typeKey, paint: c.paint, rim: c.rim, engine: c.engine, chassis: c.chassis, n2o: c.n2o };
    this._restoreCar();
    this.world.saveRequested = true;
  }

  optInfo(cat, i) {
    const c = this.cur;
    if (cat === 1) return { name: C.SWATCHES[i].name, price: C.PAINT_PRICE, owned: c.paint === i, hex: C.SWATCHES[i].hex };
    if (cat === 2) return { name: C.RIMS[i].name, price: C.RIMS[i].price, owned: c.rim === i, hex: C.RIMS[i].hex };
    const T = [null, null, null, C.ENGINE_TIERS, C.CHASSIS_TIERS, C.N2O_TIERS][cat];
    if (T) return { name: T[i].name, price: T[i].price, owned: [0, 0, 0, c.engine, c.chassis, c.n2o][cat] >= i + 1 };
    return null;
  }

  quickInfo(i) {
    const stars = this.world.wanted.stars, o = this._quick()[i] ?? this._quick()[0];
    if (o.id === 'fit') return { name: 'Fit Signature Tuning', price: C.FIT_FEE, locked: 0 };
    if (stars === 0) return { name: 'Repair & Clean Coat', price: this.visitPaid ? 0 : C.repairCost(), locked: 0 };
    return { name: `Hot Respray (${stars}★)`, price: this.firstUsed ? C.hotRespray(stars) : 0, locked: this.heatCd, free: !this.firstUsed };
  }

  _buy() {
    const w = this.world, car = this.car, cat = this.cat, i = this.opt[cat];
    if (cat === 0) {
      const q = this.quickInfo(i), o = this._quick()[i] ?? this._quick()[0];
      if (o.id === 'fit') {
        if (!this._pay(q.price)) return;
        const b = this.build;
        Object.assign(this.cur, { rim: b.rim, engine: b.engine, chassis: b.chassis, n2o: b.n2o });
        this._commit();
        w.emit('custWrench');
        w.notify('SIGNATURE TUNING FITTED', 'mission');
        return;
      }
      const stars = w.wanted.stars;
      if (stars === 0) {
        if (car.health >= 99.5) return this._toast('HULL ALREADY PERFECT', 'info', false);
        if (!this._pay(q.price)) return;
        this._startSpray(2.8, { repair: true });
      } else {
        if (this.heatCd > 0) return this._toast(`HEAT-WIPE COOLING DOWN (${Math.ceil(this.heatCd)}s)`, 'warn');
        if (!this._pay(q.price)) return;
        this.firstUsed = true;
        this._startSpray(3.5, { repair: true, hot: stars, paint: this.opt[1] });
      }
    } else if (cat === 1) {
      if (this.cur.paint === i) return this._toast('ALREADY PAINTED THAT COLOUR', 'info', false);
      if (!this._pay(C.PAINT_PRICE)) return;
      this.visitPaid = true;
      this._startSpray(2.8, { repair: true, paint: i });
    } else if (cat === 2) {
      if (this.cur.rim === i) return this._toast('THOSE RIMS ARE ALREADY FITTED', 'info', false);
      if (!this._pay(C.RIMS[i].price)) return;
      this.cur.rim = i;
      this._commit();
      w.emit('custWrench');
      w.notify(`${C.RIMS[i].name.toUpperCase()} FITTED${i > 0 ? ' + GT AERO KIT' : ''}`, 'mission');
    } else {
      const key = ['', '', '', 'engine', 'chassis', 'n2o'][cat], T = [null, null, null, C.ENGINE_TIERS, C.CHASSIS_TIERS, C.N2O_TIERS][cat];
      if (this.cur[key] >= i + 1) return this._toast('ALREADY INSTALLED', 'info', false);
      if (!this._pay(T[i].price)) return;
      this.cur[key] = i + 1;
      this._commit();
      w.emit('custWrench');
      w.notify(`${T[i].name.toUpperCase()} INSTALLED`, 'mission');
    }
  }

  // ---- spray
  _startSpray(dur, job) {
    this.state = 'SPRAY_SEQUENCE';
    this.spray = { t: 0, dur, ...job, swapped: false };
    this._restoreCar();
    this.world.emit('custSpray');
  }

  _sprayStep(dt) {
    const s = this.spray, car = this.car;
    s.t += dt;
    if (!s.swapped && s.t >= 1.4) {
      s.swapped = true;
      if (s.paint !== undefined) { this.cur.paint = s.paint; car.swatch = s.paint; }
      if (s.repair) car.health = 100;
      car.wrecked = false;
      this._commit();
    }
    if (s.t >= s.dur) {
      this.spray = null;
      if (s.hot) {
        const w = this.world;
        w.wanted.clear();
        this.heatCd = C.HEAT_WIPE_COOLDOWN;
        this.banner = { text: `CLEARED! SOLARIS HOT RESPRAY (-${s.hot}★)`, t: 4 };
        w.emit('custChime');
        w.emit('escaped');
        this._leave();
      } else {
        this.state = 'IN_BAY_MENU';
        this.world.emit('custChime');
      }
    }
    this.pin();
  }

  // ---- leaving
  _leave() {
    this._restoreCar();
    this.state = 'EXITING_BAY';
    this.t = 0;
    this.world.emit('custShutterOpen');
  }

  _exiting(dt) {
    const v = this.car;
    this.t += dt;
    const f = this.L;
    v.x += f.fx * 6 * dt;
    v.z += f.fz * 6 * dt;
    v.h = this._faceH();
    v.vx = f.fx * 6; v.vz = f.fz * 6; v.speedF = 6;
    v._syncMesh();
    if (this.t >= 0.8) {
      v.frozen = false;
      this.world.police.sealed = false;
      this.state = 'COOLDOWN';
      this.cool = 4.0;
      this.car = null;
    }
  }

  _abort() {
    if (this.car) this.car.frozen = false;
    this.car = null;
    this.spray = null;
    this.world.police.sealed = false;
    this.state = 'IDLE_OPEN';
    this.closed = 0;
    this.camW = 0;
  }

  // ---- shutter, glow, camera
  _shutterAnim(dt) {
    let target = 0, rate = 1 / 0.55;
    if (this.state === 'PULLING_IN') { target = 1; rate = 1 / 0.65; }
    else if (this.state === 'IN_BAY_MENU' || this.state === 'SPRAY_SEQUENCE') target = 1;
    else if (this.state === 'EXITING_BAY') target = 0;
    else if (this.world.wanted.stars >= 5 && Math.hypot(this.world.player.px - this.L.ax, this.world.player.pz - this.L.az) < 90) target = 0.5;
    if (this.shotClosed !== undefined) { this.closed = this.shotClosed; target = this.shotClosed; }
    this.closed += Math.max(-rate * dt, Math.min(rate * dt, target - this.closed));
    this._shutterApply();
    const camTarget = this.state === 'EXITING_BAY' ? 0 : this.locked ? 1 : 0;
    const crate = this.state === 'EXITING_BAY' ? 1 / 0.8 : 1 / 0.65;
    this.camW += Math.max(-crate * dt, Math.min(crate * dt, camTarget - this.camW));
  }

  _fx(dt) {
    const g = this.glow, w = this.world, t = this.time;
    // lockdown strobe / cops-too-close hazard above the shutter
    const stars = w.wanted.stars, p = w.player;
    const nearGarage = Math.hypot(p.px - this.L.ax, p.pz - this.L.az) < 90;
    let sr = 0, sg = 0, sb = 0, s2r = 0, s2g = 0, s2b = 0;
    if (nearGarage && stars >= 5) {
      const on = Math.floor(t * 6) % 2 === 0;
      if (on) { sr = 2.6; sg = 0.1; } else { s2r = 2.6; s2g = 0.1; }
    } else if (nearGarage && stars >= 1 && this._copDistance() < C.POLICE_GATE) {
      const a = 0.5 + 0.5 * Math.sin(t * 9);
      sr = 2.4 * a; sg = 1.3 * a; s2r = 2.4 * (1 - a); s2g = 1.3 * (1 - a);
    }
    const strobe = g.parts.strobe;
    for (let i = 0; i < strobe.count; i++) {
      const second = i >= strobe.count / 2;
      g.geo.attributes.color.setXYZ(strobe.start + i, second ? s2r : sr, second ? s2g : sg, second ? s2b : sb);
    }
    g.geo.attributes.color.needsUpdate = true;
    // export flash
    if (this.ex) g.setColor('flash', ...(this.ex.t < 0.9 ? [0, 0, 0] : [1.8 * (1 - (this.ex.t - 0.9) / 0.5), 1.6 * (1 - (this.ex.t - 0.9) / 0.5), 1.0 * (1 - (this.ex.t - 0.9) / 0.5)]));
    else if (this._flashOn) { g.setColor('flash', 0, 0, 0); this._flashOn = false; }
    if (this.ex) this._flashOn = true;
    // recall bollard cap: teal when ready
    const ready = this.build && this.recallCd <= 0;
    if (ready !== this._recallReady) { this._recallReady = ready; if (ready) g.setColor('recallCap', 0, 2.3, 1.95); else g.setColor('recallCap', 0.25, 0.15, 0.15); }
    // spray mist
    const s = this.spray;
    const k = this.shotMist || (s ? smooth(Math.min(s.t / 0.3, (s.dur - s.t) / 0.3, 1)) : 0);
    const bc = this.bayCenter, c = BAY.center;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1, osc = (s ? Math.sin(s.t * Math.PI * 2 * 1.8) : Math.sin(t * 6)) * 1.6;
      const ac = i === 0 ? [0.0, 1.5, 1.3] : [1.7, 0.5, 0.4], rc = [ac[0] * 0.12, ac[1] * 0.12, ac[2] * 0.12];
      g.cone(`mist${i}`, g.SEG, side * 3.9, 1.3, c + osc, -side, -0.12, 0, 3.0 * k, 1.1 * k, ac, rc);
    }
    // nitrous flames behind the player's car
    const v = p.vehicle, cu = v?.custom;
    const burn = !!cu && cu.isBoosting && !v.frozen;
    for (let i = 0; i < 2; i++) {
      if (!burn && !this.shotFlame) { g.cone(`flame${i}`, g.FSEG, 0, 0, 0, 0, 0, 1, 0, 0, [0, 0, 0], [0, 0, 0]); continue; }
      const fv = v ?? this.shotFlame;
      const sh = Math.sin(fv.h), ch = Math.cos(fv.h), hl = fv.type.len / 2, off = (i ? 1 : -1) * fv.type.wid * 0.27;
      const [lx, lz] = toLocal(this.L, fv.x - sh * (hl + 0.05) + ch * off, fv.z - ch * (hl + 0.05) - sh * off);
      // direction in lot space: the car's backward vector (-sin h, -cos h) in world -> lot axes
      const bx = -sh * this.L.lx + -ch * this.L.lz, bz = -sh * this.L.fx + -ch * this.L.fz;
      const jitter = 1 + 0.25 * Math.sin(t * 2 * Math.PI * (14 + 8 * i)) + 0.12 * Math.sin(t * 131 + i);
      g.cone(`flame${i}`, g.FSEG, lx + bx * 2.8 * jitter, 0.42, lz + bz * 2.8 * jitter, -bx, 0, -bz, 2.8 * jitter, 0.3, [0.0, 0.5, 2.6], [0.4, 1.9, 2.8]);
    }
  }

  // Orbit camera inside the bay, blended over the chase rig by camW.
  blendCamera(camera, rig) {
    if (this.camW <= 0.001 || !this.car) return;
    const c = this.bayCenter, a = this.time * ORBIT.speed;
    const lim = 3.3, ox = Math.max(-lim, Math.min(lim, Math.cos(a) * ORBIT.radius)), oz = Math.max(-lim, Math.min(lim, Math.sin(a) * ORBIT.radius));
    const [wx, wz] = toWorld(this.L, ox, BAY.center + oz);
    const w = smooth(this.camW), look = new THREE.Vector3(c.x, this.y + 0.85, c.z);
    const pos = new THREE.Vector3(wx, this.y + ORBIT.height, wz);
    camera.position.lerp(pos, w);
    const tgt = rig.target.clone().lerp(look, w);
    camera.lookAt(tgt);
    if (w > 0.5 && Math.abs(camera.fov - 64) > 0.05) { camera.fov += (64 - camera.fov) * w; camera.updateProjectionMatrix(); }
  }

  // ---- export loop
  _inPad(v) {
    const [lx, lz] = toLocal(this.L, v.x, v.z);
    return Math.abs(lx - PAD.x) <= PAD.w / 2 && Math.abs(lz - PAD.z) <= PAD.d / 2;
  }

  _exportLoop(dt, input) {
    const w = this.world, p = w.player, v = p.vehicle;
    if (this.ex) {
      this.ex.t += dt;
      if (this.ex.t >= 1.4) {
        w.vehicles.remove(this.ex.v);
        this.ex = null;
      }
      return;
    }
    if (!v || v.isBoat || v.locked || w.fx || !this._inPad(v)) return;
    if (this.waitT > 0) { this.prompt = `EXPORT BOARD RESTOCKING ${Math.ceil(this.waitT)}s`; return; }
    const type = this.activeType;
    if (v.typeKey !== type) { this.prompt = `EXPORT WANTED: ${C.EXPORT_NAMES[type]} (CURRENT: ${(C.EXPORT_NAMES[v.typeKey] ?? v.type.name).toUpperCase()})`; return; }
    if (w.wanted.stars >= 2) { this.prompt = 'EXPORT BLOCKED: TOO HOT (1 STAR OR LESS)'; return; }
    if (Math.abs(v.speedF) >= 2.0) { this.prompt = 'STOP ON THE PAD TO EXPORT'; return; }
    const pay = C.exportPayout(type, v.health, 100, v.swatch === this.activeSwatch);
    this.prompt = `[E] EXPORT VEHICLE FOR ${fmt(pay.total)}`;
    if (input.pressed('KeyE')) this._deliver(v, pay);
  }

  _deliver(v, pay) {
    const w = this.world, p = w.player;
    let ox = PAD.x, oz = PAD.z + PAD.d / 2 + 2.2;
    let [x, z] = toWorld(this.L, ox, oz);
    if (!w.collision.isFree(x, z, 0.5)) { [x, z] = toWorld(this.L, ox + 3, oz); }
    w.placeOnFoot(v);
    v.frozen = true;
    v.locked = true;
    p.x = x; p.z = z; p.y = w.layout.groundHeightAt(x, z);
    p.heading = this.L.h;
    w.rig.yaw = this.L.h + Math.PI;
    this.ex = { t: 0, v };
    w.cash += pay.total;
    if (w.wanted.stars === 1) w.wanted.clear();
    const lines = [`EXPORT COMPLETE  +${fmt(pay.total)}`];
    if (pay.pristine || pay.swatch) lines.push(`${pay.pristine ? `PRISTINE +${fmt(pay.pristine)}  ` : ''}${pay.swatch ? `SWATCH MATCH +${fmt(pay.swatch)}` : ''}`.trim());
    for (const l of lines) w.notify(l, 'mission');
    w.emit('custExport');
    this.exportCount++;
    if (this.board.idx === 5) {
      w.cash += C.SET_BONUS;
      w.notify(`COMPLETE SET 6/6  +${fmt(C.SET_BONUS)}`, 'mission');
      this.waitT = C.RESTOCK_TIME;
      this._pips();
      this.board.idx = 0; // the next cycle's list appears when the restock ends
      this.board.cycle++;
      const b = C.exportCycle(this.board.cycle);
      this.board.order = b.order; this.board.swatches = b.swatches;
      this._miniCar();
    } else {
      this.board.idx++;
      this._miniCar();
      this._pips();
    }
    w.saveRequested = true;
  }

  _matchWatch() {
    const v = this.world.player.vehicle;
    if (v === this.lastVehicle) return;
    this.lastVehicle = v;
    if (v && !v.isBoat && this.activeType && v.typeKey === this.activeType) {
      this.matchT = 4.5;
      this.world.emit('custChime');
    }
  }

  get match() {
    const v = this.world.player.vehicle;
    return !!v && !v.isBoat && !!this.activeType && v.typeKey === this.activeType;
  }

  // ---- recall pad
  _recall(input) {
    const w = this.world, p = w.player;
    if (p.inCar || !this.build || w.fx) return;
    const [lx, lz] = toLocal(this.L, p.x, p.z);
    if (Math.hypot(lx - RECALL.x, lz - RECALL.z) > 4.2) return;
    if (this.recallCd > 0) { this.prompt = `RECALL READY IN ${Math.ceil(this.recallCd)}s`; return; }
    this.prompt = '[E] Recall Signature Ride';
    if (!input.pressed('KeyE')) return;
    const b = this.build, [x, z] = toWorld(this.L, RECALL.x, RECALL.z);
    if (this.recallCar && w.vehicles.list.includes(this.recallCar) && !this.recallCar.driver) w.vehicles.remove(this.recallCar);
    for (const o of [...w.vehicles.list]) if (!o.driver && o.kind === 'parked' && Math.hypot(o.x - x, o.z - z) < 3.5) w.vehicles.remove(o);
    const car = w.vehicles.spawn(b.type, b.paint >= 0 ? C.SWATCHES[b.paint].hex : PAINTS[0], x, z, this.L.h);
    car.owned = true;
    car.stolen = true;
    car.applyCustom(b, false);
    if (b.paint >= 0) car.swatch = b.paint;
    this.recallCar = car;
    this.recallCd = C.RECALL_COOLDOWN;
    w.emit('custWrench');
    w.notify('SIGNATURE RIDE DELIVERED', 'mission');
  }

  // ---- views for HUD / minimap / save
  get mapView() {
    const w = this.world, stars = w.wanted.stars;
    return { x: this.L.ax, z: this.L.az, ring: stars >= 1 && stars <= 4 && this.heatCd <= 0, ex: this.activeType ? this.exportCenter : null, match: this.match };
  }

  menuView() {
    const car = this.car, c = this.cur, w = this.world;
    const rows = CATS.map((name, cat) => {
      const i = this.opt[cat];
      let value, tag, kind = 'price';
      if (cat === 0) {
        const q = this.quickInfo(i);
        value = q.name;
        if (q.locked > 0) { tag = `LOCKED (CD ${Math.ceil(q.locked)}s)`; kind = 'locked'; } else tag = q.free ? 'FREE' : fmt(q.price);
      } else if (cat === 1 || cat === 2) {
        const o = this.optInfo(cat, cat === this.cat ? i : (cat === 1 ? Math.max(0, c.paint) : c.rim));
        value = cat === 1 && c.paint < 0 && cat !== this.cat ? 'Factory paint' : o.name;
        if (o.owned) { tag = cat === 1 ? 'APPLIED' : 'OWNED'; kind = 'owned'; } else tag = fmt(o.price);
      } else {
        const cur = [0, 0, 0, c.engine, c.chassis, c.n2o][cat], T = [null, null, null, C.ENGINE_TIERS, C.CHASSIS_TIERS, C.N2O_TIERS][cat];
        const idx = cat === this.cat ? i : Math.max(0, cur - 1);
        const o = this.optInfo(cat, idx);
        value = cur === 0 && cat !== this.cat ? 'Stock' : T[idx].name;
        if (o.owned) { tag = 'OWNED'; kind = 'owned'; } else tag = fmt(o.price);
      }
      return { name, value, tag, kind, active: cat === this.cat, swatch: cat === 1 ? C.SWATCHES[this.cat === 1 ? i : Math.max(0, c.paint)].hex : cat === 2 ? C.RIMS[this.cat === 2 ? i : c.rim].hex : null };
    });
    const base = car.type.maxSpeed, hov = this.cat === 3 ? this.opt[3] + 1 : c.engine;
    const stars = w.wanted.stars;
    const chassis = c.chassis > 0 ? C.CHASSIS_TIERS[c.chassis - 1] : null;
    return {
      rows, cash: w.cash, stars, cd: this.heatCd, hotCost: stars > 0 ? (this.firstUsed ? C.hotRespray(stars) : 0) : 0, spraying: !!this.spray,
      top: Math.round(base * 3.6), topNow: Math.round(C.tunedTop(base, c.engine) * 3.6), topPrev: Math.round(C.tunedTop(base, Math.max(hov, c.engine)) * 3.6), topMax: Math.round(Math.max(base, C.SPEED_CAP) * 3.6),
      accel: Math.round(C.accelBonus(c.engine) * 100), n2o: c.n2o > 0 ? C.N2O_TIERS[c.n2o - 1].short : 'NONE', armor: chassis ? `${C.CHASSIS_TIERS[c.chassis - 1].name.includes('Kevlar') ? 'KEVLAR' : 'BRACE'} ×${chassis.dmg.toFixed(2)}` : 'STOCK',
    };
  }

  tuningLabel(v) {
    const c = v?.custom;
    if (!c || (c.engine + c.chassis + c.n2o) === 0) return '';
    const parts = [];
    if (c.engine) parts.push(c.engine === 3 ? 'STAGE 3 SOLARIS SPEC' : `STAGE ${c.engine}`);
    if (c.n2o) parts.push(C.N2O_TIERS[c.n2o - 1].short);
    if (c.chassis) parts.push(`${c.chassis === 2 ? 'KEVLAR' : 'BRACE'} ×${C.CHASSIS_TIERS[c.chassis - 1].dmg.toFixed(2)}`);
    return parts.join(' • ');
  }

  serialize() { return { build: this.build, exportCount: this.exportCount, firstResprayUsed: this.firstUsed }; }
  getSaveData() { return this.serialize(); }

  restore(data) {
    const d = C.sanitizeCustoms(data);
    this.build = d.build;
    this.exportCount = d.exportCount;
    this.firstUsed = d.firstResprayUsed;
    this.waitT = 0;
    this._board();
  }
  loadSaveData(data) { this.restore(data); }
}

function world_insert(collision, r, h) {
  const c = { type: 'aabb', x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, h };
  collision._insert(c);
  return c;
}
