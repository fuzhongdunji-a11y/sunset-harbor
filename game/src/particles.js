// particles: a tiny pool of point sprites (one draw call per pool) for smoke, embers and sparks. Each particle fades its colour over its life.
import * as THREE from '../vendor/three.module.min.js';

// One shared round, soft-edged sprite (Canvas generated) so puffs and sparks are discs rather than hard squares.
let dotTexture = null;
function softDot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

export class ParticlePool {
  // opts: {max, size, opacity, additive, gravity, drag, from: 0xRRGGBB, to: 0xRRGGBB}
  constructor(scene, opts) {
    this.max = opts.max;
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 0;
    this.from = new THREE.Color(opts.from);
    this.to = new THREE.Color(opts.to);
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max); // seconds left
    this.span = new Float32Array(this.max); // seconds at birth
    this.next = 0;
    this.alive = 0;
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -1000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      map: softDot(), size: opts.size, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: opts.opacity ?? 1, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !opts.additive,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    if (this.life[i] <= 0) this.alive++;
    this.life[i] = this.span[i] = life;
    this.col[k] = this.from.r;
    this.col[k + 1] = this.from.g;
    this.col[k + 2] = this.from.b;
    this.points.visible = true;
  }

  update(dt) {
    if (this.alive <= 0) return;
    let alive = 0;
    const c = new THREE.Color();
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1000;
        continue;
      }
      alive++;
      const damp = Math.exp(-this.drag * dt);
      this.vel[k] *= damp;
      this.vel[k + 2] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp - this.gravity * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const age = 1 - this.life[i] / this.span[i];
      c.copy(this.from).lerp(this.to, age);
      this.col[k] = c.r;
      this.col[k + 1] = c.g;
      this.col[k + 2] = c.b;
    }
    this.alive = alive;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    if (!alive) this.points.visible = false;
  }

  clear() {
    this.life.fill(0);
    this.pos.fill(0);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -1000;
    this.alive = 0;
    this.points.visible = false;
  }
}
