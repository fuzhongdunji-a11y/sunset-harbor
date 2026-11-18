// briefcases: the gold briefcases dropped by the armored truck. Owns their flight and bounce, the hovering spin, the light pillar and pulse ring
// (three instanced meshes, three draw calls in total) and the pickup test (3.8 m from a car, 2.6 m on foot).
import * as THREE from '../vendor/three.module.min.js';

export const MAX_CASES = 3;
const SIZE = [0.75, 0.55, 0.25]; // metres
const HOVER = 0.45; // resting height above the ground
const SPIN = 1.8; // rad/s
const PILLAR_H = 8;
const PILLAR_R = 0.6;
const RING_R = 2.5;
const RING_PERIOD = 1.0;
const GRAVITY = 9.8;
const PICK_CAR = 3.8;
const PICK_FOOT = 2.6;

export class Briefcases {
  constructor(scene, collision, groundHeightAt) {
    this.collision = collision;
    this.groundHeightAt = groundHeightAt;
    this.list = []; // {x, y, z, vx, vy, vz, gy, rot, state: 'fly' | 'rest', bounces, age}
    this.time = 0;

    const box = new THREE.BoxGeometry(SIZE[0], SIZE[2], SIZE[1]); // lies flat: wide, thin, deep
    this.boxes = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0x7a4a00 }), MAX_CASES);
    const pillar = new THREE.CylinderGeometry(PILLAR_R, PILLAR_R, PILLAR_H, 10, 1, true);
    this.pillars = new THREE.InstancedMesh(pillar, new THREE.MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false }), MAX_CASES);
    const ring = new THREE.RingGeometry(0.8, 1, 36).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false }), MAX_CASES);
    for (const m of [this.boxes, this.pillars, this.rings]) {
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  get count() {
    return this.list.length;
  }

  // Throw a case from (x, y, z) with the given velocity; it lands, bounces once and then hovers.
  drop(x, y, z, vx, vy, vz) {
    const gy = this.groundHeightAt(x, z);
    this.list.push({ x, y, z, vx, vy, vz, gy, rot: Math.random() * 6, state: 'fly', bounces: 0, age: 0 });
    this._write();
  }

  // A case already lying at (x, z) (screenshots).
  place(x, z) {
    const gy = this.groundHeightAt(x, z);
    this.list.push({ x, y: gy + HOVER, z, vx: 0, vy: 0, vz: 0, gy, rot: 0.6, state: 'rest', bounces: 2, age: 5 });
    this._write();
  }

  clear() {
    this.list.length = 0;
    this._write();
  }

  _fly(c, dt) {
    c.vy -= GRAVITY * dt;
    const nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
    if (this.collision.isFree(nx, nz, 0.35)) {
      c.x = nx;
      c.z = nz;
    } else {
      c.vx = c.vz = 0; // hit a wall: drop straight down
    }
    c.y += c.vy * dt;
    const floor = c.gy + 0.2;
    if (c.y <= floor && c.vy < 0) {
      c.y = floor;
      if (c.bounces === 0) {
        c.bounces = 1;
        c.vy = -c.vy * 0.4;
        c.vx *= 0.55;
        c.vz *= 0.55;
      } else {
        c.state = 'rest';
        c.vx = c.vz = c.vy = 0;
      }
    }
  }

  // Move every case and test pickups. Returns [{c, onFoot}] for the cases collected this frame (they are removed from the list).
  update(dt, player) {
    this.time += dt;
    const got = [];
    const px = player.px, pz = player.pz;
    const reach = player.inCar ? PICK_CAR : PICK_FOOT;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.age += dt;
      c.rot += SPIN * dt;
      if (c.state === 'fly') this._fly(c, dt);
      else c.y += (c.gy + HOVER + Math.sin(this.time * 2.4 + i) * 0.06 - c.y) * Math.min(1, 8 * dt);
      if (c.age > 0.35 && Math.hypot(c.x - px, c.z - pz) < reach) {
        this.list.splice(i, 1);
        got.push({ c, onFoot: !player.inCar });
      }
    }
    this._write();
    return got;
  }

  _write() {
    const n = this.list.length;
    this.boxes.count = this.pillars.count = this.rings.count = n;
    const ph = (this.time % RING_PERIOD) / RING_PERIOD;
    for (let i = 0; i < n; i++) {
      const c = this.list[i];
      this._q.setFromEuler(this._e.set(c.state === 'fly' ? c.rot * 1.7 : 0, c.rot, c.state === 'fly' ? c.rot * 0.9 : 0));
      this._s.set(1, 1, 1);
      this.boxes.setMatrixAt(i, this._m.compose(this._p.set(c.x, c.y, c.z), this._q, this._s));
      this._q.identity();
      this.pillars.setMatrixAt(i, this._m.compose(this._p.set(c.x, c.gy + PILLAR_H / 2, c.z), this._q, this._s));
      const r = RING_R * (0.82 + 0.18 * Math.sin(ph * Math.PI * 2)); // breathes once per second
      this.rings.setMatrixAt(i, this._m.compose(this._p.set(c.x, c.gy + 0.12, c.z), this._q, this._s.set(r, 1, r)));
    }
    for (const m of [this.boxes, this.pillars, this.rings]) m.instanceMatrix.needsUpdate = true;
  }
}
