// buggyRoundup: the Buggy Roundup job. Drive to four stray dune buggies one by one, then take each back to the shop ring.
// States: IDLE -> TO_BUGGY -> TO_SHOP (x4 buggies) -> (PAID | FAILED) -> 20s cooldown -> IDLE.
// Sites come only from world.layout anchors (xs x zs); props and rings are pooled so rounds never grow the scene.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// public constants (max run total = 4 * (220 + 80) + 100 = $1,300)
export const BUGGY = {
  PER_BUGGY: 220,
  SPEED_BONUS: 80,
  BASE_PAY: 100,
};

const BUGGIES_TOTAL = 4;
const FIRST_DELAY = 12; // seconds after load before the first round
const COOLDOWN = 20; // seconds after PAID / FAILED
const OUT_TIME_LIMIT = 20; // seconds continuously out of the car during TO_BUGGY / TO_SHOP
const SITE_R = 7; // distance to a buggy / the shop for pickup and return
const DWELL = 1.0; // seconds stopped inside the ring
const BUGGY_GAP = 120; // min distance between two buggy spots
const SHOP_GAP = 100; // min distance between the shop and any buggy spot
const BUGGY_PREFER_Z = 150; // buggy spots prefer anchors at or beyond this z (the waterfront)
const MAX_Z = 330; // anchors must stay on land (sea is z > 340)
const LEG_SPEED = 11; // m/s used to size the return timer
const LEG_BASE_TIME = 25; // seconds added to every return timer
const FORCE_AHEAD = 35; // forceBuggy: shop ring this far ahead of the car
const FORCE_LEG_TIME = 60;
const LIME = 0xc0ff33;
const GOLD = 0xffe14d;

// shared geometry / materials
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const bodyGeom = new THREE.BoxGeometry(1.8, 0.6, 3.6);
const cabGeom = new THREE.BoxGeometry(1.5, 0.9, 1.4);
const axleGeom = new THREE.BoxGeometry(2.4, 0.5, 0.6);
const bodyMat = new THREE.MeshLambertMaterial({ color: LIME, flatShading: true });
const cabMat = new THREE.MeshLambertMaterial({ color: 0x2b3a1a, flatShading: true });
const axleMat = new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true });

// pooled bobbing ground ring
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
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

// small low-poly dune buggy prop (local +Z is forward)
function buildBuggyProp() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.7;
  const cab = new THREE.Mesh(cabGeom, cabMat);
  cab.position.set(0, 1.4, -0.2);
  const front = new THREE.Mesh(axleGeom, axleMat);
  front.position.set(0, 0.4, 1.3);
  const rear = new THREE.Mesh(axleGeom, axleMat);
  rear.position.set(0, 0.4, -1.3);
  g.add(body, cab, front, rear);
  g.visible = false;
  return g;
}

export class BuggyRoundupService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < MAX_Z) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 6151 + 29) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;
    this.lastPlayer = null;

    // pooled site objects (created once, hidden until a round places them)
    this.shop = { x: 0, z: 0, marker: new Marker(scene, GOLD) };
    this.buggies = [];
    for (let i = 0; i < BUGGIES_TOTAL; i++) {
      const prop = buildBuggyProp();
      scene.add(prop);
      this.buggies.push({ x: 0, z: 0, prop });
    }
    this.limeMarker = new Marker(scene, LIME);

    this.paySoFar = 0; // returned pay + bonus earned this run
    this.buggyIndex = 0; // buggy currently being fetched / returned
    this.buggiesDone = 0;
    this.legTimeTotal = 0;
    this.legTimeLeft = 0;
    this.outTime = 0;
    this.dwellTimer = 0;
  }

  _dist(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  _groundY(x, z) {
    const L = this.world.layout;
    return (L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08;
  }

  // Farthest-point sampling of n buggy spots from `list`: >= BUGGY_GAP from each other, >= SHOP_GAP from the shop;
  // each pick is the candidate farthest from the nearest already-picked site.
  _pickBuggies(shop, list) {
    const added = [];
    while (added.length < BUGGIES_TOTAL) {
      let best = null, bestD = -1;
      for (const a of list) {
        if (a === shop || added.includes(a)) continue;
        const dShop = this._dist(a, shop);
        if (dShop < SHOP_GAP) continue;
        let dBug = Infinity;
        for (const p of added) dBug = Math.min(dBug, this._dist(a, p));
        if (dBug < BUGGY_GAP) continue;
        const d = Math.min(dShop, dBug);
        if (d > bestD) { bestD = d; best = a; }
      }
      if (!best) return null;
      added.push(best);
    }
    return added;
  }

  // shop first, then four buggy spots (waterfront preferred when >= 4 anchors qualify)
  _chooseSites() {
    if (this.anchors.length === 0) return null;
    const shop = this.rng.pick(this.anchors);
    const front = this.anchors.filter((a) => a.z >= BUGGY_PREFER_Z && a !== shop && this._dist(a, shop) >= SHOP_GAP);
    const pools = front.length >= BUGGIES_TOTAL ? [front, this.anchors] : [this.anchors];
    for (const pool of pools) {
      const spots = this._pickBuggies(shop, pool);
      if (spots) return [shop, ...spots];
    }
    return null;
  }

  _setupSites() {
    const sites = this._chooseSites();
    if (!sites) return false;
    this.shop.x = sites[0].x;
    this.shop.z = sites[0].z;
    this.shop.marker.setPos(this.shop.x, this._groundY(this.shop.x, this.shop.z), this.shop.z);
    this.buggies.forEach((b, i) => {
      b.x = sites[i + 1].x;
      b.z = sites[i + 1].z;
      b.prop.position.set(b.x, this._groundY(b.x, b.z), b.z);
      b.prop.rotation.y = (i * 1.7) % (Math.PI * 2);
    });
    return true;
  }

  // prop / ring visibility is a pure function of the state
  _syncVisuals() {
    const toBuggy = this.state === 'TO_BUGGY';
    const toShop = this.state === 'TO_SHOP';
    this.buggies.forEach((b, i) => { b.prop.visible = toBuggy && i === this.buggyIndex; });
    if (toBuggy) {
      const b = this.buggies[this.buggyIndex];
      this.limeMarker.setPos(b.x, this._groundY(b.x, b.z), b.z);
    }
    this.limeMarker.show(toBuggy);
    this.shop.marker.show(toShop);
  }

  _resetRun() {
    this.paySoFar = 0;
    this.buggyIndex = 0;
    this.buggiesDone = 0;
    this.legTimeTotal = 0;
    this.legTimeLeft = 0;
    this.outTime = 0;
    this.dwellTimer = 0;
  }

  _startRound() {
    if (!this._setupSites()) {
      this.cooldown = COOLDOWN; // no valid layout: retry after the cooldown instead of spinning
      return;
    }
    this._resetRun();
    this.state = 'TO_BUGGY';
  }

  _end(phase) {
    this.state = phase; // 'PAID' | 'FAILED'
    this.cooldown = COOLDOWN;
    this.dwellTimer = 0;
    this.outTime = 0;
  }

  // forceBuggy: staging for ?shot=buggy. carPos is the car position and heading its yaw (forward = (sin h, cos h)).
  // One buggy is already back; the shop ring sits FORCE_AHEAD metres ahead of the car with a 60 s return timer.
  forceBuggy(carPos, heading = 0) {
    if (!this._setupSites()) return; // no valid layout: leave the service untouched rather than stage on stale sites
    this._resetRun();
    this.shop.x = carPos.x + Math.sin(heading) * FORCE_AHEAD;
    this.shop.z = carPos.z + Math.cos(heading) * FORCE_AHEAD;
    this.shop.marker.setPos(this.shop.x, this._groundY(this.shop.x, this.shop.z), this.shop.z);
    this.buggiesDone = 1;
    this.buggyIndex = 1;
    this.legTimeTotal = FORCE_LEG_TIME;
    this.legTimeLeft = FORCE_LEG_TIME;
    this.state = 'TO_SHOP';
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this._syncVisuals();
  }

  // out-of-car timer shared by TO_BUGGY and TO_SHOP; returns true when the job failed
  _checkOut(dt, inCar, onEvent) {
    if (inCar) { this.outTime = 0; return false; }
    this.outTime += dt;
    if (this.outTime <= OUT_TIME_LIMIT) return false;
    const timeLeft = this.state === 'TO_SHOP' ? this.legTimeLeft : 0;
    if (onEvent) onEvent({ type: 'buggy', phase: 'failed', pay: 0, bonus: 0, timeLeft });
    this._end('FAILED');
    return true;
  }

  // the return timer is fixed here from the straight-line buggy -> shop distance and never recomputed
  _collect(onEvent) {
    if (onEvent) onEvent({ type: 'buggy', phase: 'collected', pay: 0, bonus: 0, timeLeft: 0 });
    this.legTimeTotal = this._dist(this.buggies[this.buggyIndex], this.shop) / LEG_SPEED + LEG_BASE_TIME;
    this.legTimeLeft = this.legTimeTotal;
    this.dwellTimer = 0;
    this.state = 'TO_SHOP';
  }

  _return(onEvent) {
    const bonus = this.legTimeLeft > 0 ? BUGGY.SPEED_BONUS : 0;
    this.paySoFar += BUGGY.PER_BUGGY + bonus;
    this.buggiesDone++;
    this.dwellTimer = 0;
    if (onEvent) onEvent({ type: 'buggy', phase: 'returned', pay: BUGGY.PER_BUGGY, bonus, timeLeft: this.legTimeLeft });
    if (this.buggiesDone < BUGGIES_TOTAL) {
      this.buggyIndex = this.buggiesDone;
      this.state = 'TO_BUGGY';
    } else {
      if (onEvent) onEvent({ type: 'buggy', phase: 'paid', pay: BUGGY.BASE_PAY, bonus: 0, timeLeft: this.legTimeLeft });
      this._end('PAID');
    }
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, onEvent } = ctx;
    if (!carPos || !(dt > 0)) return;
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this.time += dt;
    const stopped = !!inCar && Math.abs(carSpeed || 0) < 1;

    switch (this.state) {
      case 'IDLE':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this._startRound();
        break;

      case 'TO_BUGGY':
        if (this._checkOut(dt, inCar, onEvent)) break;
        if (stopped && this._dist(carPos, this.buggies[this.buggyIndex]) <= SITE_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= DWELL) this._collect(onEvent);
        } else {
          this.dwellTimer = 0;
        }
        break;

      case 'TO_SHOP':
        if (this._checkOut(dt, inCar, onEvent)) break;
        this.legTimeLeft = Math.max(0, this.legTimeLeft - dt); // late = no bonus, never a fail
        if (stopped && this._dist(carPos, this.shop) <= SITE_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= DWELL) this._return(onEvent);
        } else {
          this.dwellTimer = 0;
        }
        break;

      case 'PAID':
      case 'FAILED':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this.state = 'IDLE';
        break;
    }

    this._syncVisuals();
    this.shop.marker.bob(this.time);
    this.limeMarker.bob(this.time);
  }

  hudState() {
    const visible = this.state === 'TO_BUGGY' || this.state === 'TO_SHOP';
    let distanceLeft = 0;
    const t = this.targetPos();
    if (t && this.lastPlayer) {
      const d = this._dist(this.lastPlayer, t);
      distanceLeft = Number.isFinite(d) ? d : 0;
    }
    const inLeg = this.state === 'TO_SHOP';
    const timeLeft = inLeg && Number.isFinite(this.legTimeLeft) ? this.legTimeLeft : 0;
    const timeTotal = inLeg && Number.isFinite(this.legTimeTotal) ? this.legTimeTotal : 0;
    const pay = Number.isFinite(this.paySoFar) ? this.paySoFar : 0;
    return { visible, label: 'BUGGY ROUNDUP', pay, distanceLeft, timeLeft, timeTotal, buggiesDone: this.buggiesDone, buggiesTotal: BUGGIES_TOTAL };
  }

  targetPos() {
    if (this.state === 'TO_BUGGY') {
      const b = this.buggies[this.buggyIndex];
      return { x: b.x, z: b.z };
    }
    if (this.state === 'TO_SHOP') return { x: this.shop.x, z: this.shop.z };
    return null;
  }
}
