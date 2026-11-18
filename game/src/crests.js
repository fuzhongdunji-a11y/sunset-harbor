// crests: the 50 "Costa Sun-Crests" - golden medallions hidden around the city (25), the beach (10) and the harbor (15).
// Owns placement, the two instanced meshes, pickup, the district tally, milestone rewards/perks and the save format (ids of collected crests).
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';
import { WORLD } from './config.js';
import { MILESTONE_EVADE_SCALE } from './wanted.js';

export const CREST_TOTAL = 50;
export const CREST_CASH = 250;
export const QUOTA = { city: 25, beach: 10, harbor: 15 };
export const GROUP_NAME = { city: 'City', beach: 'Beach', harbor: 'Harbor' };
// minimum gap to every other crest; the open design says 110 m, which cannot hold 50 crests in this map, so it is scaled per area (and relaxed if a sampler gets stuck)
const SPACING = { city: 85, beach: 55, harbor: 26 };
export const MILESTONES = [
  { at: 10, cash: 2500, perk: 'SPRINT +15%' },
  { at: 20, cash: 5000, perk: 'CAR DURABILITY +25%' },
  { at: 30, cash: 8000, perk: 'WANTED DECAY -20%' },
  { at: 40, cash: 12000, perk: 'RADAR RANGE x2 + DUNE HOPPER at the beach lot' },
  { at: 50, cash: 25000, perk: 'SERENA SOLARI GT at the marina lot' },
];
const NEAR_RADIUS = 35;
const NEAR_RADIUS_BOOSTED = 70;
const HOVER = 1.1; // medallion centre above ground (1.0 m hover + half the 1.2 m disc is drawn below)
const SPIN = (45 * Math.PI) / 180; // 45 degrees per second

export function nextMilestone(n) {
  return MILESTONES.find((m) => m.at > n) ?? null;
}

export class Crests {
  constructor(scene, layout, collision, seed = 1) {
    this.layout = layout;
    this.collision = collision;
    this.list = this._place(seed);
    this.got = new Set();
    this.near = []; // crests inside the radar radius this frame (for the minimap)
    this.radius = NEAR_RADIUS;
    this.time = 0;
    this.spawned = { 40: false, 50: false };

    const n = this.list.length;
    const disc = new THREE.CylinderGeometry(0.6, 0.6, 0.25, 8).rotateX(Math.PI / 2);
    this.discs = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xff9d14 }), n);
    const glow = new THREE.BoxGeometry(1.9, 2.8, 1.9);
    this.glows = new THREE.InstancedMesh(glow, new THREE.MeshBasicMaterial({ color: 0xffb42e, transparent: true, opacity: 0.26, depthWrite: false }), n);
    for (const m of [this.discs, this.glows]) {
      m.frustumCulled = false; // matrices change every frame; the auto bounding sphere would go stale
      scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._writeMatrices();
  }

  // Deterministic placement. Samplers propose points; a point must stand on free ground (never on a road lane) and keep its distance to the others.
  _place(seed) {
    const L = this.layout, col = this.collision;
    const rng = makeRng(seed * 271 + 5);
    const out = [];
    const W = WORLD.road / 2 + 1.2;
    const onRoad = (x, z) => L.xs.some((rx) => Math.abs(x - rx) < W) || L.zs.some((rz) => Math.abs(z - rz) < W);
    const fill = (group, count, sampler, spacing) => {
      let have = 0, tries = 0;
      while (have < count && tries < 6000) {
        tries++;
        if (tries % 500 === 0) spacing = Math.max(18, spacing * 0.9); // stuck: loosen the gap a little
        const p = sampler();
        if (!p || !col.isFree(p.x, p.z, 1.2) || (group === 'city' && onRoad(p.x, p.z))) continue;
        if (out.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < spacing)) continue;
        out.push({ id: out.length, group, x: p.x, z: p.z, y: L.groundHeightAt(p.x, p.z), flag: false });
        have++;
      }
      return have;
    };
    const parks = L.blocks.filter((b) => b.park);
    // city: courtyards in the parks first, then quiet sidewalk corners all over town
    fill('city', 5, () => {
      const b = parks[Math.floor(rng() * parks.length)];
      const h = b.size / 2 - 7;
      return { x: b.cx + rng.range(-h, h), z: b.cz + rng.range(-h, h) };
    }, SPACING.city);
    const city = L.blocks.filter((b) => !b.park);
    fill('city', 20, () => {
      const b = city[Math.floor(rng() * city.length)];
      const e = b.size / 2 - 1.8, t = rng.range(-24, 24);
      const side = Math.floor(rng() * 4);
      return side < 2 ? { x: b.cx + (side ? e : -e), z: b.cz + t } : { x: b.cx + t, z: b.cz + (side === 2 ? e : -e) };
    }, SPACING.city);
    // beach: strip of sand, away from the pier
    fill('beach', QUOTA.beach, () => {
      const x = rng.range(-300, 300);
      return Math.abs(x + 110) < 12 ? null : { x, z: rng.range(WORLD.sandZ + 4, WORLD.shoreZ - 5) };
    }, SPACING.beach);
    // harbor: Lantern Pier (a few along its boards) and the container yard apron
    const pier = L.docks[0], yard = L.docks[1];
    const onPier = fill('harbor', 4, () => ({ x: (pier.x0 + pier.x1) / 2 + rng.range(-1.4, 1.4), z: rng.range(pier.z0 + 8, pier.z1 - 8) }), SPACING.harbor);
    fill('harbor', QUOTA.harbor - onPier, () => ({ x: rng.range(yard.x0 + 5, yard.x1 - 5), z: rng.range(yard.z0 + 3, yard.z1 - 3) }), SPACING.harbor);
    return out;
  }

  get count() {
    return this.got.size;
  }

  tally() {
    const t = { city: 0, beach: 0, harbor: 0 };
    for (const c of this.list) if (this.got.has(c.id)) t[c.group]++;
    return t;
  }

  ids() {
    return [...this.got];
  }

  _writeMatrices() {
    const m = this._m;
    this.list.forEach((c, i) => {
      if (this.got.has(c.id)) {
        this.discs.setMatrixAt(i, this._zero);
        this.glows.setMatrixAt(i, this._zero);
        return;
      }
      const bob = Math.sin(this.time * 1.6 + i) * 0.12;
      this._q.setFromEuler(this._e.set(0, this.time * SPIN + i, 0));
      this._s.set(1, 1, 1);
      m.compose(this._v.set(c.x, c.y + HOVER + bob, c.z), this._q, this._s);
      this.discs.setMatrixAt(i, m);
      m.compose(this._v.set(c.x, c.y + HOVER, c.z), this._q.identity(), this._s);
      this.glows.setMatrixAt(i, m);
    });
    this.discs.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
  }

  // Re-apply a saved collection silently (no cash, no toasts) and give back the perks that go with it.
  restore(ids, world) {
    this.got = new Set(ids.filter((i) => i >= 0 && i < this.list.length));
    this._writeMatrices();
    this._applyPerks(world, true);
  }

  // Per-frame: spin, proximity chord, pickup. Pays out and raises world events.
  update(dt, world) {
    this.time += dt;
    const p = world.player;
    const px = p.px, pz = p.pz;
    const reach = p.inCar ? 3 : 2.1;
    this.near.length = 0;
    let closest = Infinity;
    for (const c of this.list) {
      if (this.got.has(c.id)) continue;
      const d = Math.hypot(c.x - px, c.z - pz);
      closest = Math.min(closest, d);
      if (d < reach) {
        this._collect(c, world);
        continue;
      }
      if (d < this.radius) {
        this.near.push(c);
        if (!c.flag) {
          c.flag = true;
          world.emit('crestNear');
        }
      } else if (d > this.radius + 12) {
        c.flag = false;
      }
    }
    // the spin and bob are only worth re-uploading while a crest is within sight (every other frame is plenty)
    this.frame = (this.frame ?? 0) + 1;
    if (closest < 170 && (this.frame & 1) === 0) this._writeMatrices();
  }

  _collect(c, world) {
    this.got.add(c.id);
    const n = this.got.size;
    world.cash += CREST_CASH;
    const ms = MILESTONES.find((m) => m.at === n) ?? null;
    if (ms) {
      world.cash += ms.cash;
      this._applyPerks(world, false);
      world.emit('crestMilestone');
    } else {
      world.emit('crest');
    }
    this._writeMatrices(); // the picked-up medallion disappears at once
    world.crestToast = { n, tally: this.tally(), group: c.group, milestone: ms, t: 4 };
    world.saveRequested = true;
  }

  _applyPerks(world, silent) {
    const n = this.got.size;
    world.player.sprintMul = n >= 10 ? 1.15 : 1;
    world.durability = n >= 20 ? 0.75 : 1; // damage taken in crashes
    world.wanted.evadeScale = n >= 30 ? MILESTONE_EVADE_SCALE : 1;
    this.radius = n >= 40 ? NEAR_RADIUS_BOOSTED : NEAR_RADIUS;
    if (n >= 40 && !this.spawned[40]) {
      this.spawned[40] = true;
      this._spawnReward(world, 'duneHopper', 0xf2a541, -60, 287.6);
    }
    if (n >= 50 && !this.spawned[50]) {
      this.spawned[50] = true;
      this._spawnReward(world, 'solari', 0xf6d55c, -40, 207.6);
    }
    if (!silent) world.notify(MILESTONES.find((m) => m.at === n)?.perk ?? '', 'mission');
  }

  // Park a reward car on the nearest curb slot to (x, z), clearing whatever was parked there.
  _spawnReward(world, type, paint, x, z) {
    let best = null, bd = Infinity;
    for (const s of world.layout.slots) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    for (const v of [...world.vehicles.list]) if (v.kind === 'parked' && !v.driver && v.distanceTo(best.x, best.z) < 3.5) world.vehicles.remove(v);
    const car = world.vehicles.spawn(type, paint, best.x, best.z, best.h);
    car.owned = true;
    this.rewardCars = (this.rewardCars ?? []).concat(car);
  }
}
