// nightMarket: the Night Market job. Drive to each of three stalls, park, wait, earn money.
// States: IDLE -> TO_SHOP -> (PAID | FAILED) -> 20s cooldown -> IDLE (first round after 12s).
// Sites: three layout intersections, farthest-point sampled >= 100 m apart and >= 60 m from round-start carPos. Props: one pooled ring marker + one pooled stall per shop, built once.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// Public constants
export const MARKET = {
  PER_SHOP: 300,
  ALL_ON_TIME_BONUS: 250,
  SHOPS_TOTAL: 3,
};

const SHOP_R = 7;            // car must be within this of the shop to deliver
const MIN_SITE_DIST = 100;   // minimum spacing between shop sites
const MIN_SHOP_START_DIST = 60; // shops must be >= 60 m from round-start carPos
const MAX_Z = 330;           // anchors stay on land
const FIRST_DELAY = 12;
const COOLDOWN = 20;
const OUT_OF_CAR_LIMIT = 20;
const FORCE_AHEAD = 35;
const ACCENT = 0xffa94d;

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Helper: pooled ring marker (radius SHOP_R)
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(SHOP_R - 0.8, SHOP_R, 40, 1, 0, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  setPos(x, y, z) { this.mesh.position.set(x, y, z); }
  show(v) { this.mesh.visible = v; }
}

// Helper: simple stall prop (box + canopy slab)
const STALL_H = 2.2;
let stallGeom = null; let stallMat = null; // shared by all stalls: one draw call each
function buildStall() {
  if (!stallGeom) {
    stallGeom = new THREE.BoxGeometry(2.4, STALL_H, 2.4);
    stallMat = new THREE.MeshLambertMaterial({ color: 0xd9822b, flatShading: true });
  }
  const m = new THREE.Mesh(stallGeom, stallMat);
  m.visible = false;
  return m;
}

export class NightMarketService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < MAX_Z) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 6151 + 29) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.outTime = 0;
    this.deliveryProgress = 0;
    this.timeLeft = 0;
    this.timeTotal = 0;
    this.shopsDone = 0;
    this.shops = null;
    this.lastSeenCarPos = null;

    // pooled ring marker
    this.ringMarker = new Marker(scene, ACCENT);

    // one pooled stall prop per shop, built once
    this.stalls = [];
    for (let i = 0; i < MARKET.SHOPS_TOTAL; i++) {
      const stall = buildStall();
      scene.add(stall);
      this.stalls.push(stall);
    }
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  _groundY(x, z) { const L = this.world.layout; return finite(L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08; }

  // farthest-point sampling over anchors; every pick is >= minDist from all earlier picks
  _extend(picked, n, minDist, carPos) {
    const added = [];
    while (added.length < n) {
      let best = null; let bestD = -1;
      for (const a of this.anchors) {
        if (picked.includes(a) || added.includes(a)) continue;
        if (carPos && this._dist(a, carPos) < MIN_SHOP_START_DIST) continue;
        let d = Infinity;
        for (const p of picked) d = Math.min(d, this._dist(a, p));
        for (const p of added) d = Math.min(d, this._dist(a, p));
        if (d < minDist) continue;
        if (d > bestD) { bestD = d; best = a; }
      }
      if (!best) break;
      added.push(best);
    }
    return added;
  }

  _chooseShops(carPos) {
    // the first shop must also be >= 60 m from the round-start car position
    const pool = carPos ? this.anchors.filter(a => this._dist(a, carPos) >= MIN_SHOP_START_DIST) : this.anchors;
    if (pool.length === 0) return null;
    for (let tries = 0; tries < 8; tries++) {
      const first = this.rng.pick(pool);
      const rest = this._extend([first], MARKET.SHOPS_TOTAL - 1, MIN_SITE_DIST, carPos);
      if (rest.length === MARKET.SHOPS_TOTAL - 1) return [first, ...rest].map(a => ({ x: a.x, z: a.z }));
    }
    return null;
  }

  _placeStalls() {
    for (let i = 0; i < this.stalls.length; i++) {
      const s = this.shops[i];
      if (!s) continue;
      this.stalls[i].position.set(s.x, this._groundY(s.x, s.z) + STALL_H / 2, s.z);
    }
  }

  _syncProps() {
    const inRound = this.state === 'TO_SHOP';
    for (const stall of this.stalls) stall.visible = inRound;
    if (inRound && this.shops && this.shops[this.shopsDone]) {
      const target = this.shops[this.shopsDone];
      this.ringMarker.setPos(target.x, this._groundY(target.x, target.z), target.z);
      this.ringMarker.show(true);
    } else {
      this.ringMarker.show(false);
    }
  }

  _hideAll() {
    this.ringMarker.show(false);
    for (const s of this.stalls) s.visible = false;
  }

  _startRound(carPos) {
    if (!carPos || !Number.isFinite(carPos.x) || !Number.isFinite(carPos.z)) return false;
    const shops = this._chooseShops(carPos);
    if (!shops) return false;
    this.shops = shops;
    this.shopsDone = 0;
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this._placeStalls();
    this.state = 'TO_SHOP';
    this._startNextShop();
    return true;
  }

  _startNextShop() {
    const target = this.shops[this.shopsDone];
    // fixed once per leg from the car position at leg start
    const legDist = finite(this._dist(this.lastSeenCarPos, target));
    this.timeTotal = this.timeLeft = legDist / 13 + 20;
    this.deliveryProgress = 0;
    this.outTime = 0;
    this._syncProps();
  }

  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') {
      ctx.onEvent({ type: 'market', phase, pay, bonus, timeLeft: Math.max(0, finite(timeLeft)) });
    }
  }

  _fail(ctx) {
    this._emit(ctx, 'failed', 0, 0, 0);
    this.state = 'FAILED';
    this.cooldown = COOLDOWN;
    this._hideAll();
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};

    if (this.state === 'IDLE') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (!this._startRound(ctx.carPos)) this.cooldown = COOLDOWN;
      }
      return;
    }

    if (this.state === 'TO_SHOP') {
      const carPos = ctx.carPos && Number.isFinite(ctx.carPos.x) && Number.isFinite(ctx.carPos.z) ? ctx.carPos : null;
      if (carPos) this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
      const inCar = !!ctx.inCar;

      // out-of-car timer
      if (inCar) this.outTime = 0; else { this.outTime += dt; if (this.outTime > OUT_OF_CAR_LIMIT) { this._fail(ctx); return; } }

      // leg timer counts down
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this._fail(ctx); return; }

      // delivery dwell: 1.0s continuous while in car, speed<1, within SHOP_R
      const speed = Math.abs(finite(Number(ctx.carSpeed)));
      const target = this.shops[this.shopsDone];
      if (inCar && carPos && this._dist(carPos, target) <= SHOP_R && speed < 1) {
        this.deliveryProgress += dt;
      } else {
        this.deliveryProgress = 0;
      }

      if (this.deliveryProgress >= 1.0) {
        this.shopsDone += 1;
        const pay = MARKET.PER_SHOP;
        if (this.shopsDone < MARKET.SHOPS_TOTAL) {
          this._emit(ctx, 'delivered', pay, 0, this.timeLeft);
          this._startNextShop();
        } else {
          const bonus = MARKET.ALL_ON_TIME_BONUS;
          this._emit(ctx, 'paid', pay, bonus, this.timeLeft);
          this.state = 'PAID';
          this.cooldown = COOLDOWN;
          this._hideAll();
        }
        this.deliveryProgress = 0;
      }
      return;
    }

    if (this.state === 'PAID' || this.state === 'FAILED') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.state = 'IDLE';
        this.cooldown = 0;
        this._hideAll();
      }
    }
  }

  hudState() {
    const inRound = this.state === 'TO_SHOP';
    let distanceLeft = 0;
    if (inRound && this.lastSeenCarPos && this.shops && this.shops[this.shopsDone]) {
      distanceLeft = finite(this._dist(this.lastSeenCarPos, this.shops[this.shopsDone]));
    }
    return {
      visible: inRound,
      label: 'NIGHT MARKET',
      pay: this.shopsDone * MARKET.PER_SHOP,
      distanceLeft,
      shopsDone: this.shopsDone,
      shopsTotal: MARKET.SHOPS_TOTAL,
      timeLeft: inRound ? Math.ceil(this.timeLeft) : 0,
    };
  }

  targetPos() {
    return this.state === 'TO_SHOP' && this.shops && this.shops[this.shopsDone] ? { x: this.shops[this.shopsDone].x, z: this.shops[this.shopsDone].z } : null;
  }

  forceMarket(carPos, heading = 0) {
    if (!carPos || !Number.isFinite(carPos.x) || !Number.isFinite(carPos.z)) return;
    heading = finite(heading);
    // fall back to the first anchors if no spaced triple exists, so the preset always works
    const shops = this._chooseShops(carPos) || this.anchors.slice(0, MARKET.SHOPS_TOTAL).map(a => ({ x: a.x, z: a.z }));
    while (shops.length < MARKET.SHOPS_TOTAL) shops.push({ x: carPos.x, z: carPos.z });
    // replace second shop with point ahead of car
    const ahead = { x: carPos.x + Math.sin(heading) * FORCE_AHEAD, z: carPos.z + Math.cos(heading) * FORCE_AHEAD };
    shops[1] = ahead;
    this.shops = shops;
    this.shopsDone = 1;
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this.timeTotal = this.timeLeft = 45;
    this.deliveryProgress = 0;
    this.outTime = 0;
    this.state = 'TO_SHOP';
    this._placeStalls();
    this._syncProps();
  }
}
