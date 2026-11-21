// fireWatch: the Costa Fire Watch job. Drive to each of four blazes, park beside it and douse it, earn money.
// States: IDLE -> FIGHTING -> (PAID | FAILED) -> 20s cooldown -> IDLE (first round after 12s).
// Sites: four layout intersections, farthest-point sampled >= 100 m apart. Props: one pooled ring + one pooled flame per site, built once.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// Public constants
export const FIRE = {
  PER_FIRE: 250,
  ALL_OUT_BONUS: 300,
  CLEAN_BONUS: 250,
  FIRES_TOTAL: 4,
  DOUSE_TIME: 4.0,
};

const SITE_R = 7;             // car must be within this of the fire to douse
const MIN_SITE_DIST = 100;    // minimum spacing between fire sites
const MAX_Z = 330;            // anchors stay on land
const FIRST_DELAY = 12;
const COOLDOWN = 20;
const OUT_OF_CAR_LIMIT = 20;
const FORCE_AHEAD = 35;
const ACCENT = 0xff5522;

// Helper: pooled red-orange ring marker (radius SITE_R)
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(SITE_R - 0.8, SITE_R, 40, 1, 0, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  setPos(x, y, z) { this.mesh.position.set(x, y, z); }
  show(v) { this.mesh.visible = v; }
}

// Helper: simple flame prop (two cones + smoke slab), built once per site
function buildFlame() {
  const g = new THREE.Group();
  const coneGeom = new THREE.ConeGeometry(0.5, 1.5, 12);
  const coneMat = new THREE.MeshLambertMaterial({ color: ACCENT, emissive: ACCENT, flatShading: true });
  const cone1 = new THREE.Mesh(coneGeom, coneMat);
  const cone2 = new THREE.Mesh(coneGeom, coneMat);
  cone1.position.set(0, 0.75, 0);
  cone2.position.set(0, 1.75, 0);
  g.add(cone1, cone2);
  const boxGeom = new THREE.BoxGeometry(1.0, 0.3, 1.0);
  const boxMat = new THREE.MeshLambertMaterial({ color: 0x222222, transparent: true, opacity: 0.3 });
  const smoke = new THREE.Mesh(boxGeom, boxMat);
  smoke.position.set(0, 0.15, 0);
  g.add(smoke);
  g.visible = false;
  return g;
}

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

export class FireWatchService {
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
    this.douseProgress = 0;
    this.fireElapsed = 0;
    this.timeLeft = 0;
    this.timeTotal = 0;
    this.firesDone = 0;
    this.runDamage = 0;
    this.totalPay = 0;
    this.fireSites = [];
    this.currentSite = null;
    this.lastSeenCarPos = null;

    // pooled ring marker
    this.ringMarker = new Marker(scene, ACCENT);

    // one pooled flame prop per site, built once
    this.flames = [];
    for (let i = 0; i < FIRE.FIRES_TOTAL; i++) {
      const flame = buildFlame();
      scene.add(flame);
      this.flames.push(flame);
    }
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  _groundY(x, z) { const L = this.world.layout; return finite(L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08; }

  // farthest-point sampling over anchors; every pick is >= minDist from all earlier picks
  _extend(picked, n, minDist) {
    const added = [];
    while (added.length < n) {
      let best = null; let bestD = -1;
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
    const rest = this._extend([first], FIRE.FIRES_TOTAL - 1, MIN_SITE_DIST);
    if (rest.length === FIRE.FIRES_TOTAL - 1) return [first, ...rest].map(a => ({ x: a.x, z: a.z }));
    return null;
  }

  _placeFlames() {
    for (let i = 0; i < this.flames.length; i++) {
      const s = this.fireSites[i];
      if (!s) continue;
      this.flames[i].position.set(s.x, this._groundY(s.x, s.z), s.z);
    }
  }

  // only the current (undoused) site's flame is shown; doused ones are hidden
  _syncProps() {
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      f.visible = this.state === 'FIGHTING' && i === this.firesDone;
      if (!f.visible) f.scale.set(1, 1, 1);
    }
    if (this.state === 'FIGHTING' && this.currentSite) {
      this.ringMarker.setPos(this.currentSite.x, this._groundY(this.currentSite.x, this.currentSite.z), this.currentSite.z);
      this.ringMarker.show(true);
    } else {
      this.ringMarker.show(false);
    }
  }

  _hideAll() {
    this.ringMarker.show(false);
    for (const f of this.flames) f.visible = false;
  }

  _startRound(carPos) {
    const sites = this._chooseSites();
    if (!sites) return false;
    this.fireSites = sites;
    this.firesDone = 0;
    this.runDamage = 0;
    this.totalPay = 0;
    this.outTime = 0;
    this.lastSeenCarPos = carPos ? { x: carPos.x, z: carPos.z } : null;
    this._placeFlames();
    this.state = 'FIGHTING';
    this._startNextFire();
    return true;
  }

  // makes fireSites[firesDone] the target and fixes its deadline exactly once
  _startNextFire() {
    this.currentSite = this.fireSites[this.firesDone];
    const prevPos = this.firesDone === 0
      ? (this.lastSeenCarPos || this.currentSite)
      : this.fireSites[this.firesDone - 1];
    const dist = finite(this._dist(prevPos, this.currentSite));
    this.timeTotal = this.timeLeft = Math.max(20, dist / 11 + 45 - 5 * this.firesDone);
    this.fireElapsed = 0;
    this.douseProgress = 0;
    this._syncProps();
  }

  // every payload has exactly these five fields
  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') {
      ctx.onEvent({ type: 'fire', phase, pay, bonus, timeLeft: Math.max(0, finite(timeLeft)) });
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

    if (this.state === 'FIGHTING') {
      const carPos = ctx.carPos && Number.isFinite(ctx.carPos.x) && Number.isFinite(ctx.carPos.z) ? ctx.carPos : null;
      if (carPos) this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
      const inCar = !!ctx.inCar;

      // out-of-car timer: continuous, resets on re-entry
      if (inCar) {
        this.outTime = 0;
      } else {
        this.outTime += dt;
        if (this.outTime > OUT_OF_CAR_LIMIT) { this._fail(ctx); return; }
      }

      // per-fire deadline (counts down only while FIGHTING)
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this._fail(ctx); return; }

      // damage bookkeeping (before any payout check this frame)
      const dmg = Number(ctx.carDamageDelta);
      if (Number.isFinite(dmg) && dmg > 0) this.runDamage += dmg;

      // douse: only while in car, close to the fire and (nearly) stopped; pauses otherwise, never resets
      const speed = Math.abs(finite(Number(ctx.carSpeed)));
      if (inCar && carPos && this._dist(carPos, this.currentSite) <= SITE_R && speed < 1) {
        this.douseProgress += dt;
      }

      this.fireElapsed += dt;
      const flame = this.flames[this.firesDone];
      if (flame) {
        const s = 1 + Math.min(1.5, this.fireElapsed * 0.02);
        flame.scale.set(s, s, s);
      }

      if (this.douseProgress >= FIRE.DOUSE_TIME) {
        this.firesDone += 1;
        this.totalPay += FIRE.PER_FIRE;
        this._emit(ctx, 'doused', FIRE.PER_FIRE, 0, this.timeLeft);
        if (this.firesDone >= FIRE.FIRES_TOTAL) {
          const bonus = FIRE.ALL_OUT_BONUS + (this.runDamage <= 0 ? FIRE.CLEAN_BONUS : 0);
          this._emit(ctx, 'paid', 0, bonus, this.timeLeft);
          this.state = 'PAID';
          this.cooldown = COOLDOWN;
          this._hideAll();
        } else {
          this._startNextFire();
        }
      }
      return;
    }

    // PAID / FAILED cooldown, then back to IDLE (the next round starts from IDLE)
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
    const fighting = this.state === 'FIGHTING';
    let distanceLeft = 0;
    if (fighting && this.currentSite && this.lastSeenCarPos) {
      distanceLeft = finite(this._dist(this.lastSeenCarPos, this.currentSite));
    }
    const frac = fighting ? finite(this.douseProgress / FIRE.DOUSE_TIME) : 0;
    return {
      visible: fighting,
      label: 'FIRE WATCH',
      pay: finite(this.totalPay),
      distanceLeft,
      timeLeft: Math.max(0, finite(this.timeLeft)),
      timeTotal: Math.max(0, finite(this.timeTotal)),
      firesDone: this.firesDone,
      firesTotal: FIRE.FIRES_TOTAL,
      douseFrac: Math.min(1, Math.max(0, frac)),
    };
  }

  targetPos() {
    return this.state === 'FIGHTING' && this.currentSite ? { x: this.currentSite.x, z: this.currentSite.z } : null;
  }

  // staging: fire #2 (firesDone = 1) burns ~35 m ahead of the car along heading; forward = (sin h, cos h)
  forceFire(carPos, heading = 0) {
    const sites = this._chooseSites();
    if (!sites) return;
    sites[1] = { x: carPos.x + Math.sin(heading) * FORCE_AHEAD, z: carPos.z + Math.cos(heading) * FORCE_AHEAD };
    this.fireSites = sites;
    this.firesDone = 1;
    this.totalPay = FIRE.PER_FIRE;
    this.runDamage = 0;
    this.outTime = 0;
    this.cooldown = 0;
    this.douseProgress = 2.0;
    this.fireElapsed = 0;
    this.timeTotal = this.timeLeft = 60;
    this.currentSite = sites[1];
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this.state = 'FIGHTING';
    this._placeFlames();
    this._syncProps();
  }
}
