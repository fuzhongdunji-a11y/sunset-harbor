// iceCreamTruck: the Ice Cream Truck job. Drive through 5 stops in order, sell ice cream while stopped in the stop's ring.
// States: IDLE -> SELLING -> (PAID | FAILED) -> 20s cooldown -> IDLE. First round after 12 s delay.
// Sites from world.layout anchors with z < 330, farthest-point sampled, at least 100 m apart.
// Ring: pink ring 0xff7ab6, radius 7 m, bobbing. Two simple pooled customer figures (box + head) standing beside the current stop.
// Selling: progress advances only while inCar, within 7 m of stop, |carSpeed| < 1. Stop completes when progress >= 3.0.
// Leg par: straight-line distance from leg start to stop /11 + 25, fixed per leg. Fast bonus if legElapsed <= legPar.
// Failure: out of car >20 s.
// Events: {type:'icecream', phase:'stop'|'paid'|'failed', pay, bonus, timeLeft}
// hudState(): {visible, label:'ICE CREAM', pay, distanceLeft, timeLeft, timeTotal, stopsDone, stopsTotal, sellProgress}
// targetPos(): current stop during SELLING, else null.
// forceIceCream(carPos, heading=0): stage round: stops chosen normally, first ring 35 m ahead, stopsDone=1, sellProgress=1.5, legPar=60, legElapsed=0.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

export const ICECREAM = {
  PER_STOP: 200,
  FAST_BONUS: 80,
  BASE_PAY: 100,
  STOPS_TOTAL: 5,
  SELL_TIME: 3.0,
};

const PASS_RADIUS = 7; // stop ring radius
const MIN_GAP = 100; // min spacing between stops
const OUT_OF_CAR_LIMIT = 20;
const COOLDOWN = 20;
const FIRST_DELAY = 12;
const MARKER_COLOR = 0xff7ab6;
const CUSTOMER_GEOM = new THREE.BoxGeometry(0.5, 1.7, 0.4);
const HEAD_GEOM = new THREE.BoxGeometry(0.34, 0.34, 0.34);
const HEAD_COLOR = 0xf0c9a0;
const BODY_COLOR = 0x3355ff;

// Simple ring marker that bobs.
class RingMarker {
  constructor(scene) {
    const geom = new THREE.RingGeometry(6.5, 7, 32, 1, 0, Math.PI * 2);
    const mat = new THREE.MeshBasicMaterial({ color: MARKER_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.baseY = 0;
    scene.add(this.mesh);
  }
  setPos(x, y, z) {
    this.baseY = y;
    this.mesh.position.set(x, y, z);
  }
  show(v) { this.mesh.visible = v; }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
}

// Simple static customer figure.
class Customer {
  constructor(scene) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(CUSTOMER_GEOM, new THREE.MeshLambertMaterial({ color: BODY_COLOR }));
    body.position.y = 0.85;
    const head = new THREE.Mesh(HEAD_GEOM, new THREE.MeshLambertMaterial({ color: HEAD_COLOR }));
    head.position.y = 1.9;
    group.add(body, head);
    group.visible = false;
    scene.add(group);
    this.group = group;
  }
  setPos(x, y, z, heading) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = heading;
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }
}

export class IceCreamTruckService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < 330) this.anchors.push({ x, z });
    this.rng = makeRng((L.seed || 1) * 6131 + 23);
    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.stopsDone = 0;
    this.stopsTotal = ICECREAM.STOPS_TOTAL;
    this.sellProgress = 0;
    this.legElapsed = 0;
    this.legPar = 0;
    this.lastStopPos = null; // start of current leg
    this.currentStop = null;
    this.stops = [];
    this.outTime = 0;
    this.lastCarPos = null;
    this.ring = new RingMarker(scene);
    this.customer1 = new Customer(scene);
    this.customer2 = new Customer(scene);
    this.fastStops = 0;
    this.ringTime = 0;
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  _extend(picked, n, minDist) {
    const added = [];
    while (added.length < n) {
      let best = null;
      let bestD = -1;
      for (const a of this.anchors) {
        if (picked.includes(a) || added.includes(a)) continue;
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

  _chooseSites() {
    if (this.anchors.length === 0) return null;
    const first = this.rng.pick(this.anchors);
    const rest = this._extend([first], this.stopsTotal - 1, MIN_GAP);
    if (rest.length === this.stopsTotal - 1) return [first, ...rest].map(a => ({ x: a.x, z: a.z }));
    return null;
  }

  _calcLegPar(nextStop) {
    const start = this.lastStopPos || this.currentStop; // for first leg, use current stop if no start
    if (!start || !nextStop) return 25; // fallback
    const dist = this._dist(start, nextStop);
    return dist / 11 + 25;
  }

  _resetRound(carPos) {
    this.stopsDone = 0;
    this.sellProgress = 0;
    this.legElapsed = 0;
    this.outTime = 0;
    this.lastStopPos = finiteXZ(carPos) ? { x: carPos.x, z: carPos.z } : (this.lastCarPos || null);
    this.currentStop = this.stops[0];
    this.legPar = this._calcLegPar(this.currentStop);
    this.ring.setPos(this.currentStop.x, 0, this.currentStop.z);
    this.ringTime = 0;
    this._syncVisuals();
  }

  _end(phase) {
    this.state = phase;
    this.cooldown = COOLDOWN;
    this._syncVisuals();
  }

  _syncVisuals() {
    const vis = this.state === 'SELLING';
    this.ring.show(vis);
    this.customer1.hide();
    this.customer2.hide();
  }

  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') ctx.onEvent({ type: 'icecream', phase, pay, bonus, timeLeft });
  }

  _fail(ctx) {
    const timeLeft = Math.max(0, this.legPar - this.legElapsed);
    this._emit(ctx, 'failed', 0, 0, timeLeft);
    this._end('FAILED');
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};
    if (this.state === 'IDLE') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        const sites = this._chooseSites();
        if (sites) {
          this.stops = sites;
          this.state = 'SELLING';
          this._resetRound(ctx.carPos);
        } else {
          this.cooldown = COOLDOWN; // retry after cooldown
        }
      }
      return;
    }

    if (this.state !== 'SELLING') {
      // PAID or FAILED
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.state = 'IDLE';
      return;
    }

    // SELLING state
    this.ringTime += dt;
    this.ring.bob(this.ringTime);

    const inCar = !!ctx.inCar;
    if (finiteXZ(ctx.carPos) && inCar) this.lastCarPos = { x: ctx.carPos.x, z: ctx.carPos.z };
    this.legElapsed += dt; // leg clock runs the whole leg

    // Out-of-car timer
    if (inCar) this.outTime = 0; else this.outTime += dt;
    if (this.outTime > OUT_OF_CAR_LIMIT) {
      this._fail(ctx);
      return;
    }

    // Selling progress
    const cond = inCar && finiteXZ(ctx.carPos) && this._dist(ctx.carPos, this.currentStop) <= PASS_RADIUS && Math.abs(ctx.carSpeed) < 1;
    if (cond) this.sellProgress += dt;

    if (this.sellProgress >= ICECREAM.SELL_TIME) {
      // stop complete
      this.stopsDone += 1;
      const bonus = this.legElapsed <= this.legPar ? ICECREAM.FAST_BONUS : 0;
      const timeLeft = Math.max(0, this.legPar - this.legElapsed);
      this._emit(ctx, 'stop', ICECREAM.PER_STOP, bonus, timeLeft);
      this.sellProgress = 0;
      this.legElapsed = 0;

      if (this.stopsDone >= this.stopsTotal) {
        // paid
        this._emit(ctx, 'paid', ICECREAM.BASE_PAY, 0, 0);
        this._end('PAID');
        return;
      }

      // new leg starts
      this.lastStopPos = this.currentStop;
      this.currentStop = this.stops[this.stopsDone];
      this.ring.setPos(this.currentStop.x, 0, this.currentStop.z);
      this.legPar = this._calcLegPar(this.currentStop);
    }

    // Position customers beside stop when in SELLING
    if (this.currentStop) {
      const offset = 2; // meters from stop
      const leftX = this.currentStop.x + offset;
      const rightX = this.currentStop.x - offset;
      const y = 0.1;
      const heading = Math.PI / 2;
      this.customer1.setPos(leftX, y, this.currentStop.z, heading);
      this.customer2.setPos(rightX, y, this.currentStop.z, -heading);
    }
  }

  hudState() {
    const target = this.targetPos();
    let dist = 0;
    if (target && finiteXZ(this.lastCarPos)) dist = this._dist(this.lastCarPos, target);
    if (!Number.isFinite(dist)) dist = 0;
    const timeLeft = Math.max(0, this.legPar - this.legElapsed);
    const timeTotal = this.legPar;
    const sellProg = ICECREAM.SELL_TIME > 0 ? Math.min(1, this.sellProgress / ICECREAM.SELL_TIME) : 0;
    return {
      visible: this.state === 'SELLING',
      label: 'ICE CREAM',
      pay: ICECREAM.PER_STOP * this.stopsDone + ICECREAM.FAST_BONUS * Math.max(0, this.stopsDone - 1),
      distanceLeft: dist,
      timeLeft,
      timeTotal,
      stopsDone: this.stopsDone,
      stopsTotal: this.stopsTotal,
      sellProgress: sellProg,
    };
  }

  targetPos() {
    return this.state === 'SELLING' && this.currentStop ? this.currentStop : null;
  }

  forceIceCream(carPos, heading = 0) {
    if (!finiteXZ(carPos)) return false;
    const sites = this._chooseSites() || [];
    if (sites.length < this.stopsTotal) return false;
    // stop #2 (index 1, since stopsDone=1) 35m ahead
    sites[1] = { x: carPos.x + Math.sin(heading) * 35, z: carPos.z + Math.cos(heading) * 35 };
    this.stops = sites;
    this.state = 'SELLING';
    this.cooldown = 0;
    this.stopsDone = 1;
    this.sellProgress = 1.5;
    this.legPar = 60;
    this.legElapsed = 0;
    this.outTime = 0;
    this.lastCarPos = { x: carPos.x, z: carPos.z };
    this.lastStopPos = { x: carPos.x, z: carPos.z };
    this.currentStop = this.stops[1];
    this.ring.setPos(this.currentStop.x, 0, this.currentStop.z);
    this.ringTime = 0;
    this._syncVisuals();
    return true;
  }
}

function finiteXZ(p) { return !!p && Number.isFinite(p.x) && Number.isFinite(p.z); }
