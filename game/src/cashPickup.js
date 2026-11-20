// cashPickup: the Armored Cash Pickup job. Four shop bags are collected in any order, then delivered to a vault.
// States: IDLE -> COLLECTING (0..4 bags) -> TO_VAULT -> (PAID | FAILED) -> 20s cooldown -> IDLE.
// Sites come only from world.layout anchors (xs x zs); markers/bags are pooled so rounds never grow the scene.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

// public constants (max run total = 4 * 300 + 400 + 350 = $1,950)
export const CASH_PICKUP = {
  PER_BAG: 300,
  VAULT_BONUS: 400,
  CLEAN_BONUS: 350,
};

const BAGS_TOTAL = 4;
const FIRST_DELAY = 12; // seconds after load before the first round
const OUT_TIME_LIMIT = 20; // seconds continuously out of the car during COLLECTING / TO_VAULT
const BAG_R = 6; // distance to a shop for pickup
const VAULT_R = 7; // distance to the vault for delivery
const BAG_DWELL = 0.8; // seconds stopped inside the shop ring
const VAULT_DWELL = 1.0; // seconds stopped inside the vault ring
const COOLDOWN = 20; // seconds after PAID / FAILED
const SHOP_MIN_DIST = 120; // min distance between shops
const VAULT_MIN_DIST = 150; // min distance vault -> nearest shop
const FORCE_AHEAD = 35; // forcePickup: remaining shop ring this far ahead of the car
const MAX_Z = 330; // anchors must stay on land (sea is z > 340)

// shared geometry / materials
const ringGeom = new THREE.RingGeometry(2.2, 3.0, 32, 1, 0, Math.PI * 2);
const bagGeom = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const bagMat = new THREE.MeshLambertMaterial({ color: 0x6b8f3a });

// bobbing ground ring
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
    this.mesh.visible = true;
  }
  bob(t) {
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.baseY + 0.35 + 0.25 * Math.sin(t * 3);
    const s = 1 + 0.06 * Math.sin(t * 3);
    this.mesh.scale.set(s, s, 1);
  }
  hide() { this.mesh.visible = false; }
}

export class CashPickupService {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    const L = world.layout;
    this.anchors = [];
    for (const x of L.xs) for (const z of L.zs) if (z < MAX_Z) this.anchors.push({ x, z });
    this.rng = makeRng(((L.seed || 1) * 4993 + 13) >>> 0);

    this.state = 'IDLE';
    this.cooldown = FIRST_DELAY;
    this.time = 0;
    this.lastPlayer = null;

    // pooled site objects (created once, hidden until a round places them)
    this.shops = [];
    for (let i = 0; i < BAGS_TOTAL; i++) {
      const bag = new THREE.Mesh(bagGeom, bagMat);
      bag.visible = false;
      scene.add(bag);
      this.shops.push({ x: 0, z: 0, marker: new Marker(scene, 0x2ee66b), bag, collected: true });
    }
    this.vault = { x: 0, z: 0, marker: new Marker(scene, 0xffd34d) };

    this.bagPay = 0;
    this.bagsDone = 0;
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

  // farthest-point sampling with a minimum spacing; if the spacing cannot be met, fill with the farthest remaining
  _spreadSites(list, n, minDist) {
    if (list.length === 0) return [];
    const count = Math.min(n, list.length);
    const picked = [this.rng.pick(list)];
    const nearestPicked = (a) => {
      let d = Infinity;
      for (const p of picked) d = Math.min(d, this._dist(a, p));
      return d;
    };
    while (picked.length < count) {
      let best = null, bestD = -1;
      for (const a of list) {
        if (picked.includes(a)) continue;
        const d = nearestPicked(a);
        if (d < minDist) continue;
        if (d > bestD) { bestD = d; best = a; }
      }
      if (!best) {
        for (const a of list) {
          if (picked.includes(a)) continue;
          const d = nearestPicked(a);
          if (d > bestD) { bestD = d; best = a; }
        }
      }
      if (!best) break;
      picked.push(best);
    }
    return picked;
  }

  // vault = anchor farthest from the shops' centroid, at least VAULT_MIN_DIST from every shop
  _chooseVault(anchors, shops) {
    const centroid = {
      x: shops.reduce((s, a) => s + a.x, 0) / shops.length,
      z: shops.reduce((s, a) => s + a.z, 0) / shops.length,
    };
    let best = null, bestD = -1;
    let fallback = null, fallbackMin = -1;
    for (const a of anchors) {
      if (shops.includes(a)) continue;
      let minToShop = Infinity;
      for (const s of shops) minToShop = Math.min(minToShop, this._dist(a, s));
      if (minToShop > fallbackMin) { fallbackMin = minToShop; fallback = a; }
      if (minToShop < VAULT_MIN_DIST) continue;
      const d = this._dist(a, centroid);
      if (d > bestD) { bestD = d; best = a; }
    }
    return best || fallback || anchors[0];
  }

  _hideAll() {
    for (const s of this.shops) { s.marker.hide(); s.bag.visible = false; }
    this.vault.marker.hide();
  }

  _placeShop(s, x, z) {
    s.x = x;
    s.z = z;
    s.collected = false;
    const y = this._groundY(x, z);
    s.marker.setPos(x, y, z);
    s.bag.position.set(x, y + 0.4, z);
    s.bag.visible = true;
  }

  _setupSites() {
    this._hideAll();
    const picked = this._spreadSites(this.anchors, BAGS_TOTAL, SHOP_MIN_DIST);
    this.shops.forEach((s, i) => {
      const a = picked[i % picked.length];
      this._placeShop(s, a.x, a.z);
    });
    const v = this._chooseVault(this.anchors, picked);
    this.vault.x = v.x;
    this.vault.z = v.z;
    this.vault.marker.setPos(v.x, this._groundY(v.x, v.z), v.z);
    this.vault.marker.hide(); // gold ring shows only in TO_VAULT
  }

  _nearestShop(pos) {
    let nearest = null, best = Infinity;
    for (const s of this.shops) {
      if (s.collected) continue;
      const d = this._dist(pos, s);
      if (d < best) { best = d; nearest = s; }
    }
    return nearest;
  }

  _resetRun() {
    this.bagPay = 0;
    this.bagsDone = 0;
    this.outTime = 0;
    this.dwellTimer = 0;
  }

  _startRound() {
    this._setupSites();
    this.state = 'COLLECTING';
    this._resetRun();
  }

  _end(phase) {
    this.state = phase; // 'PAID' | 'FAILED'
    this.cooldown = COOLDOWN;
    this.dwellTimer = 0;
    this._hideAll();
  }

  // Staging for ?shot=cash: carPos is the car position and heading its yaw (forward = (sin h, cos h)).
  // One bag is already collected and the nearest remaining shop ring sits FORCE_AHEAD metres ahead of the car.
  forcePickup(carPos, heading = 0) {
    this._setupSites();
    // the shop farthest from the car counts as the already-collected bag
    let far = null, farD = -1;
    for (const s of this.shops) {
      const d = this._dist(carPos, s);
      if (d > farD) { farD = d; far = s; }
    }
    if (far) {
      far.collected = true;
      far.marker.hide();
      far.bag.visible = false;
    }
    const nearest = this._nearestShop(carPos);
    if (nearest) {
      this._placeShop(nearest, carPos.x + Math.sin(heading) * FORCE_AHEAD, carPos.z + Math.cos(heading) * FORCE_AHEAD);
    }
    this.state = 'COLLECTING';
    this._resetRun();
    this.bagPay = CASH_PICKUP.PER_BAG;
    this.bagsDone = 1;
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    if (this.world.wanted && typeof this.world.wanted.raiseTo === 'function') this.world.wanted.raiseTo(1);
  }

  // out-of-car timer shared by COLLECTING and TO_VAULT; returns true when the job failed
  _checkOut(dt, inCar, onEvent) {
    if (inCar) { this.outTime = 0; return false; }
    this.outTime += dt;
    if (this.outTime <= OUT_TIME_LIMIT) return false;
    if (onEvent) onEvent({ type: 'cashPickup', phase: 'failed', pay: 0, bonus: 0, bagsDone: this.bagsDone });
    this._end('FAILED');
    return true;
  }

  update(dt, ctx) {
    const { carPos, carSpeed, inCar, onEvent } = ctx;
    if (!carPos || !(dt > 0)) return;
    this.lastPlayer = { x: carPos.x, z: carPos.z };
    this.time += dt;
    for (const s of this.shops) if (!s.collected) s.marker.bob(this.time);
    this.vault.marker.bob(this.time);
    const stopped = inCar && Math.abs(carSpeed || 0) < 1;

    switch (this.state) {
      case 'IDLE':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this._startRound();
        break;

      case 'COLLECTING': {
        if (this._checkOut(dt, inCar, onEvent)) return;
        const target = this._nearestShop(carPos);
        if (target && stopped && this._dist(carPos, target) <= BAG_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= BAG_DWELL) {
            target.collected = true;
            target.marker.hide();
            target.bag.visible = false;
            this.bagsDone += 1;
            this.bagPay += CASH_PICKUP.PER_BAG;
            this.dwellTimer = 0;
            if (onEvent) onEvent({ type: 'cashPickup', phase: 'bag', pay: CASH_PICKUP.PER_BAG, bonus: 0, bagsDone: this.bagsDone });
            if (this.world.wanted && typeof this.world.wanted.raiseTo === 'function') this.world.wanted.raiseTo(Math.min(this.bagsDone, 3));
            if (this.bagsDone >= BAGS_TOTAL || !this._nearestShop(carPos)) {
              this.state = 'TO_VAULT';
              this.vault.marker.setPos(this.vault.x, this._groundY(this.vault.x, this.vault.z), this.vault.z);
            }
          }
        } else {
          this.dwellTimer = 0;
        }
        break;
      }

      case 'TO_VAULT': {
        if (this._checkOut(dt, inCar, onEvent)) return;
        if (stopped && this._dist(carPos, this.vault) <= VAULT_R) {
          this.dwellTimer += dt;
          if (this.dwellTimer >= VAULT_DWELL) {
            const w = this.world.wanted;
            const stars = w && typeof w.stars === 'number' ? w.stars : 0;
            const bonus = stars === 0 ? CASH_PICKUP.CLEAN_BONUS : 0;
            if (onEvent) onEvent({ type: 'cashPickup', phase: 'paid', pay: CASH_PICKUP.VAULT_BONUS, bonus, bagsDone: BAGS_TOTAL });
            this._end('PAID');
          }
        } else {
          this.dwellTimer = 0;
        }
        break;
      }

      case 'PAID':
      case 'FAILED':
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.cooldown === 0) this.state = 'IDLE';
        break;
    }
  }

  hudState() {
    const visible = this.state === 'COLLECTING' || this.state === 'TO_VAULT';
    let distanceLeft = 0;
    const t = this.targetPos();
    if (t && this.lastPlayer) {
      const d = this._dist(this.lastPlayer, t);
      distanceLeft = Number.isFinite(d) ? d : 0;
    }
    return { visible, label: 'CASH PICKUP', pay: this.bagPay, distanceLeft, bagsDone: this.bagsDone, bagsTotal: BAGS_TOTAL };
  }

  targetPos() {
    if (this.state === 'COLLECTING') {
      const t = this._nearestShop(this.lastPlayer || { x: 0, z: 0 });
      if (t) return { x: t.x, z: t.z };
    }
    if (this.state === 'TO_VAULT') return { x: this.vault.x, z: this.vault.z };
    return null;
  }
}
