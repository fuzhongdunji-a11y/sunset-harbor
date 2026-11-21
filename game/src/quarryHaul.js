// quarryHaul: the Quarry Haul job. Drive to a quarry, load crates, haul to a site, unload, earn money.
// States: IDLE -\u003e HAULING (phases load/haul) -\u003e PAID/FAILED -\u003e 20s cooldown -\u003e IDLE.
// Sites derived from world.layout anchors; quarry and site at least 150m apart.
// Props: pooled amber ring and crate props; no per-round creation.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// public constants
export const QUARRY = {
  BASE_PAY: 300,
  CLEAN_BONUS: 250,
  TRIPS_TOTAL: 3,
  LOAD_TIME: 2.0,
  UNLOAD_TIME: 1.0,
  SITE_R: 7, // distance to a site for loading/unloading
  OUT_OF_CAR_LIMIT: 20,
  COOLDOWN: 20,
  FORCE_AHEAD: 35,
  CRITERION_MIN_DIST: 150,
  MAX_Z: 330,
  FIRST_DELAY: 12,
};

const {
  BASE_PAY,
  CLEAN_BONUS,
  TRIPS_TOTAL,
  LOAD_TIME,
  UNLOAD_TIME,
  SITE_R,
  OUT_OF_CAR_LIMIT,
  COOLDOWN,
  FORCE_AHEAD,
  CRITERION_MIN_DIST,
  MAX_Z,
  FIRST_DELAY,
} = QUARRY;

// pooled amber ring marker
class Marker {
  constructor(scene, color) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.baseY = 0;
    scene.add(this.mesh);
  }
  setPos(x, y, z) { this.baseY = y; this.mesh.position.set(x, y, z); }
  show(v) { this.mesh.visible = v; }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
}

// simple crate prop (local +Z forward)
function buildCrateProp() {
  const g = new THREE.Group();
  const geom = new THREE.BoxGeometry(1.0, 0.5, 1.0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffb020, flatShading: true });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = 0.25;
  g.add(mesh);
  g.visible = false;
  return g;
}

export class QuarryHaulService {
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
    this.loadTimer = 0;
    this.unloadTimer = 0;
    this.cargoFrac = 0;
    this.runDamage = 0;
    this.tripsDone = 0;
    this.totalPay = 0;
    this.phase = null;
    this.lastSeenCarPos = null;

    // pooled props
    this.crate = buildCrateProp();
    scene.add(this.crate);
    this.ringMarker = new Marker(scene, 0xffb020); // amber

    this.quarry = { x: 0, z: 0, marker: this.ringMarker };
    this.site = { x: 0, z: 0 };
  }

  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  _groundY(x, z) { const L = this.world.layout; return (L.groundHeightAt ? L.groundHeightAt(x, z) : 0) + 0.08; }

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
    const rest = this._extend([first], 1, CRITERION_MIN_DIST);
    if (rest.length === 1) return [first, ...rest].map(a => ({ x: a.x, z: a.z }));
    return null;
  }

  _setupRound() {
    const sites = this._chooseSites();
    if (!sites) return false;
    this.quarry.x = sites[0].x; this.quarry.z = sites[0].z;
    this.site.x = sites[1].x; this.site.z = sites[1].z;
    this.loadTimer = 0;
    this.unloadTimer = 0;
    this.cargoFrac = 0;
    this.runDamage = 0;
    this.outTime = 0;
    this.tripsDone = 0;
    this.totalPay = 0;
    this.phase = 'load';
    this._syncProps();
    return true;
  }

  // Move the pooled ring + crate onto the current target (quarry while loading, site while hauling).
  _syncProps() {
    const t = this.phase === 'haul' ? this.site : this.quarry;
    const y = this._groundY(t.x, t.z);
    this.ringMarker.setPos(t.x, y, t.z);
    this.ringMarker.show(true);
    this.crate.position.set(t.x, y, t.z);
    this.crate.visible = true;
  }

  _emit(ctx, phase, pay, bonus, timeLeft = 0) {
    if (ctx && typeof ctx.onEvent === 'function') ctx.onEvent({ type: 'quarry', phase, pay, bonus, timeLeft });
  }

  _fail(ctx) {
    this._emit(ctx, 'failed', 0, 0, 0);
    this.state = 'FAILED';
    this.cooldown = COOLDOWN;
    this.ringMarker.show(false);
    this.crate.visible = false;
  }

  _endPaid(ctx) {
    const bonus = this.runDamage <= 0 ? CLEAN_BONUS : 0;
    this._emit(ctx, 'paid', 0, bonus, 0);
    this.state = 'PAID';
    this.cooldown = COOLDOWN;
    this.ringMarker.show(false);
    this.crate.visible = false;
  }

  forceQuarry(carPos, heading = 0) {
    // the site (current haul target) is ~35 m ahead; the quarry sits behind the car, >=150 m from the site
    const sx = Math.sin(heading), sz = Math.cos(heading);
    this.site.x = carPos.x + sx * FORCE_AHEAD;
    this.site.z = carPos.z + sz * FORCE_AHEAD;
    this.quarry.x = this.site.x - sx * (CRITERION_MIN_DIST + 5);
    this.quarry.z = this.site.z - sz * (CRITERION_MIN_DIST + 5);
    this.state = 'HAULING';
    this.phase = 'haul';
    this.cargoFrac = 0.8;
    this.tripsDone = 1;
    this.totalPay = 0;
    this.runDamage = 0;
    this.loadTimer = 0;
    this.unloadTimer = 0;
    this.cooldown = 0;
    this.outTime = 0;
    this.lastSeenCarPos = { x: carPos.x, z: carPos.z };
    this._syncProps();
  }

  update(dt, ctx) {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    ctx = ctx || {};
    if (this.state === 'IDLE') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (this._setupRound()) {
          this.state = 'HAULING';
        } else {
          this.cooldown = COOLDOWN;
        }
      }
      return;
    }

    if (this.state === 'HAULING') {
      const inCar = ctx.inCar ?? false;
      if (!inCar) {
        this.outTime += dt;
        if (this.outTime > OUT_OF_CAR_LIMIT) {
          this._fail(ctx);
          return;
        }
      } else {
        this.outTime = 0;
      }

      const carPos = ctx.carPos;
      if (!carPos) return;
      this.lastSeenCarPos = carPos;

      const rawSpeed = Number(ctx.carSpeed);
      const speed = Number.isFinite(rawSpeed) ? Math.abs(rawSpeed) : 0;
      const rawDmg = Number(ctx.carDamageDelta);
      const damage = Number.isFinite(rawDmg) && rawDmg > 0 ? rawDmg : 0;
      this.runDamage += damage; // clean-bonus bookkeeping: counted in both phases

      if (this.phase === 'load') {
        const dist = this._dist(carPos, this.quarry);
        if (dist <= SITE_R && inCar && speed < 1) {
          this.loadTimer += dt;
          if (this.loadTimer >= LOAD_TIME) {
            this.cargoFrac = 1;
            this.phase = 'haul';
            this.loadTimer = 0;
            this.unloadTimer = 0;
            this._syncProps();
            this._emit(ctx, 'loaded', 0, 0, 0);
          }
        }
      } else if (this.phase === 'haul') {
        const dist = this._dist(carPos, this.site);
        // cargo is lost only while hauling: damage / 200 of the load, clamped to 0..1
        this.cargoFrac = Math.min(1, Math.max(0, this.cargoFrac - damage / 200));
        if (dist <= SITE_R && inCar && speed < 1) {
          this.unloadTimer += dt;
          if (this.unloadTimer >= UNLOAD_TIME) {
            const tripPay = Math.floor(BASE_PAY * this.cargoFrac);
            this.totalPay += tripPay;
            this.tripsDone += 1;
            this._emit(ctx, 'trip', tripPay, 0, 0);
            this.cargoFrac = 0;
            this.loadTimer = 0;
            this.unloadTimer = 0;
            if (this.tripsDone >= TRIPS_TOTAL) {
              this._endPaid(ctx);
            } else {
              this.phase = 'load';
              this._syncProps();
            }
          }
        }
      }
    } else if (this.state === 'FAILED' || this.state === 'PAID') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.state = 'IDLE';
        this.cooldown = 0;
        this.ringMarker.show(false);
        this.crate.visible = false;
      }
    }
  }

  hudState() {
    let distanceLeft = 0;
    if (this.state === 'HAULING' && this.lastSeenCarPos) {
      const target = this.targetPos();
      if (target) distanceLeft = this._dist(this.lastSeenCarPos, target);
    }
    if (!Number.isFinite(distanceLeft)) distanceLeft = 0;
    const cargoFrac = this.phase === 'load' || !Number.isFinite(this.cargoFrac) ? 0 : this.cargoFrac;
    return {
      visible: this.state === 'HAULING',
      label: 'QUARRY HAUL',
      pay: this.totalPay,
      distanceLeft,
      timeLeft: 0,
      timeTotal: 0,
      tripsDone: this.tripsDone,
      tripsTotal: TRIPS_TOTAL,
      cargoFrac,
    };
  }

  targetPos() {
    if (this.state === 'HAULING') {
      if (this.phase === 'haul') return this.site;
      if (this.phase === 'load') return this.quarry;
    }
    return null;
  }
}
