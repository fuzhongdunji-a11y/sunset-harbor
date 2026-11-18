// environment: sky dome, sun, clouds, sea, ground planes, fog and the lighting rig (with a shadow that follows the camera focus).
import * as THREE from '../vendor/three.module.min.js';
import { WORLD, SKY } from './config.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeRng } from './rng.js';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.78, -0.42).normalize();

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    scene.background = new THREE.Color(SKY.horizon);
    scene.fog = new THREE.Fog(SKY.fog, 320, 1700);

    this.hemi = new THREE.HemisphereLight(0xd6ebff, 0xf6d9a8, 1.5);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2b0, 2.9);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -95;
    sc.right = sc.top = 95;
    sc.near = 1;
    sc.far = 420;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);

    this.sky = this._buildSky();
    scene.add(this.sky);
    this.sunDisc = this._buildSunDisc();
    scene.add(this.sunDisc);
    this.clouds = this._buildClouds();
    scene.add(this.clouds);
    this._buildGround();
    this._buildSea();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(2100, 24, 14);
    const pos = geo.attributes.position;
    const colors = [];
    const hor = new THREE.Color(SKY.horizon);
    const mid = new THREE.Color(SKY.mid);
    const top = new THREE.Color(SKY.zenith);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, pos.getY(i) / 2100));
      // three-stop gradient: cream horizon -> light sky -> deep blue zenith
      if (t < 0.28) c.copy(hor).lerp(mid, Math.pow(t / 0.28, 0.7));
      else c.copy(mid).lerp(top, Math.pow((t - 0.28) / 0.72, 0.8));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    return m;
  }

  _buildSunDisc() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(60, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfffbe6, fog: false }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(150, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a0, fog: false, transparent: true, opacity: 0.3, depthWrite: false }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(330, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd78a, fog: false, transparent: true, opacity: 0.12, depthWrite: false }));
    g.add(core, glow, halo);
    return g;
  }

  _buildClouds() {
    const rng = makeRng(77);
    const group = new THREE.Group();
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const b = new MeshBuilder();
    for (let k = 0; k < 18; k++) {
      const cx = rng.range(-1500, 1500);
      const cz = rng.range(-1500, 1100);
      const cy = rng.range(260, 380);
      const puffs = rng.int(4, 7);
      for (let p = 0; p < puffs; p++) {
        const s = rng.range(40, 90);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(cx + p * 55 - puffs * 27, cy + rng.range(-8, 14), cz + rng.range(-25, 25)),
          new THREE.Quaternion(),
          new THREE.Vector3(s * 1.4, s * 0.5, s),
        );
        b.setTransform(m);
        b.addGeometry(ico, p % 2 ? 0xffffff : 0xf3f8fc);
      }
    }
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    group.add(mesh);
    this.cloudMesh = mesh;
    return group;
  }

  _buildGround() {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(6000, 3000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x84bf68 }));
    grass.position.set(0, 0, WORLD.sandZ - 1500);
    grass.receiveShadow = true;
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(6000, WORLD.shoreZ - WORLD.sandZ).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf0dca8 }));
    sand.position.set(0, 0.0, (WORLD.shoreZ + WORLD.sandZ) / 2);
    sand.receiveShadow = true;
    // wet sand slope down into the sea
    const b = new MeshBuilder();
    b.quad([-3000, 0, WORLD.shoreZ], [3000, 0, WORLD.shoreZ], [3000, -0.7, WORLD.shoreZ + 14], [-3000, -0.7, WORLD.shoreZ + 14], 0xd9c590, [0, 1, 0.3]);
    const slope = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(grass, sand, slope);
  }

  _buildSea() {
    const xsArr = [];
    for (let x = -2400; x < -520; x += 240) xsArr.push(x);
    for (let x = -520; x <= 520; x += 13) xsArr.push(x);
    for (let x = 760; x <= 2400; x += 240) xsArr.push(x);
    const zsArr = [];
    const z0 = WORLD.shoreZ + 4;
    for (let z = z0; z < z0 + 160; z += 8) zsArr.push(z);
    for (let z = z0 + 160; z < z0 + 700; z += 60) zsArr.push(z);
    for (let z = z0 + 700; z <= 2600; z += 300) zsArr.push(z);
    const nx = xsArr.length, nz = zsArr.length;
    const pos = new Float32Array(nx * nz * 3);
    const idx = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 3;
        pos[k] = xsArr[i];
        pos[k + 1] = -0.5;
        pos[k + 2] = zsArr[j];
      }
    }
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.boundingSphere.radius = 4000;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * nz * 3), 3));
    this.seaGeo = geo;
    this.seaBase = pos.slice();
    this.sea = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0xfff0c8, shininess: 90, flatShading: true, transparent: true, opacity: 0.95 }));
    this.sea.receiveShadow = true;
    this.scene.add(this.sea);
    // foam line along the shore
    const f = new MeshBuilder();
    f.flat(-3000, WORLD.shoreZ + 5, 3000, WORLD.shoreZ + 7.5, -0.42, 0xffffff);
    this.foam = new THREE.Mesh(f.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.scene.add(this.foam);
  }

  // Called every frame: animate waves/clouds, keep sky and shadow around the focus point.
  update(dt, camera, focus) {
    this.time += dt;
    const t = this.time;
    const p = this.seaGeo.attributes.position;
    const col = this.seaGeo.attributes.color;
    const base = this.seaBase;
    const shoreZ = WORLD.shoreZ;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      const near = Math.abs(x) < 560 && z < 1000;
      const wave = near ? Math.sin(x * 0.045 + t * 0.9) * 0.16 + Math.sin(z * 0.06 - t * 1.25 + x * 0.02) * 0.2 : 0;
      p.array[i * 3 + 1] = -0.5 + wave;
      // turquoise shallows fading to deep blue, lighter wave crests, and glints that twinkle across the water
      const depth = Math.min(1, Math.max(0, (z - shoreZ) / 260));
      const crest = Math.max(0, wave) * 1.4;
      const spark = near ? Math.max(0, Math.sin(x * 0.83 + t * 2.7) * Math.sin(z * 0.61 - t * 2.1 + x * 0.3)) ** 6 * 1.7 : 0;
      col.array[i * 3] = 0.1 + (0.02 - 0.1) * depth + crest * 0.5 + spark;
      col.array[i * 3 + 1] = 0.72 + (0.42 - 0.72) * depth + crest * 0.5 + spark;
      col.array[i * 3 + 2] = 0.8 + (0.7 - 0.8) * depth + crest * 0.4 + spark;
    }
    p.needsUpdate = true;
    col.needsUpdate = true;
    this.foam.material.opacity = 0.45 + Math.sin(t * 1.3) * 0.15;
    this.cloudMesh.position.x = Math.sin(t * 0.02) * 300;
    this.sky.position.copy(camera.position);
    this.sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, 1750);
    // shadow follows focus, snapped to the texel grid to avoid shimmering
    const snap = 190 / 2048;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + SUN_DIR.x * 220, SUN_DIR.y * 220, fz + SUN_DIR.z * 220);
  }
}
