// regattaSupport: the Regatta Support job. Drive to each of four buoy sites, park, install equipment, earn money.
// States: IDLE -> TO_SITE -> (PAID | FAILED) -> 20s cooldown -> IDLE (first round after 12s).
// Sites: four layout intersections, farthest-point sampled >= 80 m apart and >= 50 m from round-start carPos.
// Props: one pooled sea‑blue ring marker + one pooled buoy prop per site, built once.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// Public constants
export const REGATTA = {
  PER_SITE: 250,
  EARLY_BONUS: 300,
  SITES_TOTAL: 4,
  EARLY_THRESHOLD: 30,
};

const SITE_R = 7;                // car must be within this of the site to install
const MIN_SITE_DIST = 80;         // minimum spacing between sites
const MIN_SITE_START_DIST = 50;   // sites must be >= 50 m from round‑start carPos
const MAX_Z = 330;                // anchors stay on land
const FIRST_DELAY = 12;
const COOLDOWN = 20;
const OUT_OF_CAR_LIMIT = 20;
const FORCE_AHEAD = 35;
const ACCENT = 0x33ccff;           // sea‑blue

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Helper: pooled ring marker (radius SITE_R)
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

// Helper: simple buoy prop (cone + base), built once per site
function buildBuoy() {
  const group = new THREE.Group();
  const baseGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 12);
  const baseMat = new THREE.MeshLambertMaterial({ color: 0x0000aa, flatShading: true });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.set(0, 0.1, 0);
  const coneGeom = new THREE.ConeGeometry(0.3, 0.8, 12);
  const coneMat = new THREE.MeshLambertMaterial({ color: 0x33ccff, flatShading: true });
  const cone = new THREE.Mesh(coneGeom, coneMat);
  cone.position.set(0, 0.9, 0);
  group.add(base, cone);
  group.visible = false;
  return group;
}

export class RegattaSupportService {
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
    this.timeLeft = 0;
    this.timeTotal = 0;
    this.sitesDone = 0;
    this.sites = null;
    this.lastSeenCarPos = null;
    this.dwellProgress = 0;
    this.bobT = 0; // deterministic bob clock (advanced by dt only)

    // pooled ring marker
    this.ringMarker = new Marker(scene, ACCENT);

    // one pooled buoy prop per site, built once
    this.buoys = [];
    for (let i = 0; i < REGATTA.SITES_TOTAL; i++) {
      const buoy = buildBuoy();
      scene.add(buoy);
      this.buoys.push(buoy);
    }
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  _groundY(x, z) { const L = this.world.layout; return finite(L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08; }

  // farthest‑point sampling over anchors; every pick is >= minDist from all earlier picks
  _extend(picked, n, minDist, carPos) {
    const added = [];
    while (added.length < n) {
      let best = null; let bestD = -1;
      for (const a of this.anchors) {
        if (picked.includes(a) || added.includes(a)) continue;
        if (carPos && this._dist(a, carPos) < MIN_SITE_START_DIST) continue;
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

  _chooseSites(carPos) {
    const pool = carPos ? this.anchors.filter(a => this._dist(a, carPos) >= MIN_SITE_START_DIST) : this.anchors;
    if (pool.length === 0) return null;
    for (let tries = 0; tries < 8; tries++) {
      const first = this.rng.pick(pool);
      const rest = this._extend([first], REGATTA.SITES_TOTAL - 1, MIN_SITE_DIST, carPos);
      if (rest.length === REGATTA.SITES_TOTAL - 1) return [first, ...rest].map(a => ({ x: a.x, z: a.z }));
    }
    return null;
  }

  _placeBuoys() {
    for (let i = 0; i < this.buoys.length; i++) {
      const s = this.sites[i];
      if (!s) continue;
      this.buoys[i].position.set(s.x, this._groundY(s.x, s.z), s.z);
    }
  }

  _syncProps() {
    const inRound = this.state === 'TO_SITE';
    for (const b of this.buoys) b.visible = inRound;
    if (inRound && this.sites && this.sites[this.sitesDone]) {
      const target = this.sites[this.sitesDone];
      this.ringMarker.setPos(target.x, this._groundY(target.x, target.z) + 0.3 + Math.sin(this.bobT * 3) * 0.15, target.z);
      this.ringMarker.show(true);
    } else {
      this.ringMarker.show(false);
    }
  }

  _hideAll() {
    this.ringMarker.show(false);
    for (const b of this.buoys) b.visible = false;
  }

  _startRound(carPos) {
    if (!carPos || !Number.isFinite(carPos.x) || !Number.isFinite(carPos.z)) return false;
    const sites = this._chooseSites(carPos);
    if (!sites) return false;
    this.sites = sites;
    this.sitesDone = 0;
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this._placeBuoys();
    // route distance sum
    let routeDist = 0;
    let prev = { x: carPos.x, z: carPos.z };
    for (const s of sites) {
      routeDist += this._dist(prev, s);
      prev = s;
    }
    this.timeTotal = this.timeLeft = routeDist / 12 + 120;
    this.state = 'TO_SITE';
    this.outTime = 0;
    this.dwellProgress = 0;
    this._syncProps();
    return true;
  }

  _emit(ctx, phase, pay, bonus, timeLeft) {
    if (ctx && typeof ctx.onEvent === 'function') {
      ctx.onEvent({ type: 'regatta', phase, pay, bonus, timeLeft: Math.max(0, finite(timeLeft)) });
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

    if (this.state === 'TO_SITE') {
      const carPos = ctx.carPos && Number.isFinite(ctx.carPos.x) && Number.isFinite(ctx.carPos.z) ? ctx.carPos : null;
      if (carPos) this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
      const inCar = !!ctx.inCar;

      // out-of-car timer
      if (inCar) this.outTime = 0; else { this.outTime += dt; if (this.outTime > OUT_OF_CAR_LIMIT) { this._fail(ctx); return; } }

      // bobbing ring follows the dt-driven clock
      this.bobT += dt;
      this._syncProps();

      // round timer counts down
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this._fail(ctx); return; }

      // dwell: car stopped, in car, within SITE_R, continuous 1.5s
      const speed = Math.abs(finite(Number(ctx.carSpeed)));
      const target = this.sites[this.sitesDone];
      if (inCar && carPos && this._dist(carPos, target) <= SITE_R && speed < 1) {
        this.dwellProgress += dt;
      } else {
        this.dwellProgress = 0;
      }

      if (this.dwellProgress >= 1.5) {
        this.sitesDone += 1;
        const pay = REGATTA.PER_SITE;
        if (this.sitesDone < REGATTA.SITES_TOTAL) {
          this._emit(ctx, 'installed', pay, 0, this.timeLeft);
          this.dwellProgress = 0;
        } else {
          const bonus = this.timeLeft >= REGATTA.EARLY_THRESHOLD ? REGATTA.EARLY_BONUS : 0;
          this._emit(ctx, 'paid', pay, bonus, this.timeLeft);
          this.state = 'PAID';
          this.cooldown = COOLDOWN;
          this._hideAll();
        }
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
    const inRound = this.state === 'TO_SITE';
    let distanceLeft = 0;
    if (inRound && this.lastSeenCarPos && this.sites && this.sites[this.sitesDone]) {
      distanceLeft = finite(this._dist(this.lastSeenCarPos, this.sites[this.sitesDone]));
    }
    return {
      visible: inRound,
      label: 'REGATTA SUPPORT',
      pay: finite(this.sitesDone * REGATTA.PER_SITE),
      distanceLeft,
      sitesDone: this.sitesDone,
      sitesTotal: REGATTA.SITES_TOTAL,
      timeLeft: inRound ? Math.ceil(this.timeLeft) : 0,
    };
  }

  targetPos() {
    return this.state === 'TO_SITE' && this.sites && this.sites[this.sitesDone] ? { x: this.sites[this.sitesDone].x, z: this.sites[this.sitesDone].z } : null;
  }

  forceRegatta(carPos, heading = 0) {
    if (!carPos || !Number.isFinite(carPos.x) || !Number.isFinite(carPos.z)) return;
    heading = finite(heading);
    // fallback to anchors if sampling fails
    const sites = this._chooseSites(carPos) || this.anchors.slice(0, REGATTA.SITES_TOTAL).map(a => ({ x: a.x, z: a.z }));
    const ahead = { x: carPos.x + Math.sin(heading) * FORCE_AHEAD, z: carPos.z + Math.cos(heading) * FORCE_AHEAD };
    sites[2] = ahead;
    this.sites = sites;
    this.sitesDone = 2;
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this.timeTotal = this.timeLeft = 60;
    this.state = 'TO_SITE';
    this.outTime = 0;
    this.dwellProgress = 0;
    this._placeBuoys();
    this._syncProps();
  }
}
