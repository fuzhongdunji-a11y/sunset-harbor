// environment: sky dome, sun, clouds, sea, ground planes, fog and the lighting rig (with a shadow that follows the camera focus).
import * as THREE from '../vendor/three.module.min.js';
import { WORLD, SKY } from './config.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeRng } from './rng.js';

// Low evening sun in the south-west, over the sea: long shadows run inland (north-east), and the sea carries the glitter path.
export const SUN_DIR = new THREE.Vector3(-0.5, 0.47, 0.72).normalize();

// Sea surface height (the same swell the water mesh is displaced with): boats, buoys and wakes ride on this.
export const SEA_LEVEL = -0.5;
export function seaHeight(x, z, t) {
  if (Math.abs(x) >= 560 || z >= 1000) return SEA_LEVEL;
  return SEA_LEVEL + Math.sin(x * 0.045 + t * 0.9) * 0.16 + Math.sin(z * 0.06 - t * 1.25 + x * 0.02) * 0.2;
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    scene.background = new THREE.Color(SKY.horizon);
    scene.fog = new THREE.Fog(SKY.fog, 300, 1650);

    // cool sky fill, warm bounce from the sunlit ground: shadows stay soft blue-violet instead of going black
    this.hemi = new THREE.HemisphereLight(0xc8dcff, 0xffd8ae, 2.8);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffbb78, 3.5);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -95;
    sc.right = sc.top = 95;
    sc.near = 1;
    sc.far = 420;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.09;
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
    const geo = new THREE.SphereGeometry(2100, 40, 20);
    const pos = geo.attributes.position;
    const colors = [];
    const hor = new THREE.Color(SKY.horizon);
    const band = new THREE.Color(SKY.band);
    const mid = new THREE.Color(SKY.mid);
    const top = new THREE.Color(SKY.zenith);
    const glow = new THREE.Color(SKY.glow);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = Math.min(1, Math.max(0, y / 2100));
      // horizon apricot -> rose band -> clear blue -> deep blue zenith
      if (t < 0.1) c.copy(hor).lerp(band, t / 0.1);
      else if (t < 0.34) c.copy(band).lerp(mid, Math.pow((t - 0.1) / 0.24, 0.8));
      else c.copy(mid).lerp(top, Math.pow((t - 0.34) / 0.66, 0.85));
      // warm glow wrapped around the sun's azimuth, strongest near the horizon
      const along = (x * SUN_DIR.x + y * SUN_DIR.y + z * SUN_DIR.z) / 2100;
      const k = Math.max(0, along);
      c.lerp(glow, Math.min(0.85, Math.pow(k, 5) * 1.1 + Math.pow(k, 2) * 0.22 * (1 - t)));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -10;
    return m;
  }

  _buildSunDisc() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(70, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(190, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc070, fog: false, transparent: true, opacity: 0.32, depthWrite: false }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(420, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff9a5a, fog: false, transparent: true, opacity: 0.14, depthWrite: false }));
    g.add(core, glow, halo);
    return g;
  }

  _buildClouds() {
    const rng = makeRng(77);
    const group = new THREE.Group();
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const b = new MeshBuilder();
    const lit = new THREE.Color(0xfff2e2), shade = new THREE.Color(0xf4c6b8), hot = new THREE.Color(0xffb36a), c = new THREE.Color();
    for (let k = 0; k < 20; k++) {
      const cx = rng.range(-1500, 1500);
      const cz = rng.range(-1500, 1100);
      const cy = rng.range(240, 360);
      const puffs = rng.int(4, 7);
      // clouds toward the sun glow orange, the rest are peach on top with rose undersides
      const dl = Math.hypot(cx, cz) || 1;
      const sunward = Math.max(0, (cx * SUN_DIR.x + cz * SUN_DIR.z) / dl);
      for (let p = 0; p < puffs; p++) {
        const s = rng.range(40, 90);
        const px = cx + p * 62 - puffs * 31, py = cy + rng.range(-8, 14);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(px, py, cz + rng.range(-25, 25)),
          new THREE.Quaternion(),
          new THREE.Vector3(s * 1.7, s * 0.42, s),
        );
        b.setTransform(m);
        c.copy(p % 2 ? lit : shade).lerp(hot, sunward * 0.55);
        b.addGeometry(ico, c.getHex());
      }
    }
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    group.add(mesh);
    this.cloudMesh = mesh;
    return group;
  }

  _buildGround() {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(6000, 3000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x84bf68 }));
    grass.position.set(0, -0.08, WORLD.sandZ - 1500); // a hair below the road surface: the 6 km plane z-fought the asphalt close to the camera
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
    this.sea = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0xffc27a, shininess: 55, flatShading: true, transparent: true, opacity: 0.95 }));
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
      const wave = seaHeight(x, z, t) - SEA_LEVEL;
      p.array[i * 3 + 1] = SEA_LEVEL + wave;
      // turquoise shallows fading to deep blue, lighter wave crests, and glints that twinkle across the water
      const depth = Math.min(1, Math.max(0, (z - shoreZ) / 260));
      const crest = Math.max(0, wave) * 1.4;
      // glints twinkle, and are concentrated in a column under the sun (the glitter path)
      const path = Math.exp(-(((x + (z - shoreZ) * 0.69) / 220) ** 2)) * 0.9 + 0.35;
      const spark = near ? Math.max(0, Math.sin(x * 0.83 + t * 2.7) * Math.sin(z * 0.61 - t * 2.1 + x * 0.3)) ** 6 * 1.0 * path : 0;
      // far water mirrors the apricot sky; near water stays turquoise -> teal
      const far = Math.min(1, Math.max(0, (z - shoreZ - 120) / 1100));
      let r = 0.1 + (0.03 - 0.1) * depth + crest * 0.5;
      let g = 0.7 + (0.4 - 0.7) * depth + crest * 0.5;
      let bl = 0.78 + (0.66 - 0.78) * depth + crest * 0.4;
      r += (0.98 - r) * far * 0.8 + spark * 1.0;
      g += (0.66 - g) * far * 0.8 + spark * 0.85;
      bl += (0.56 - bl) * far * 0.8 + spark * 0.6;
      col.array[i * 3] = r;
      col.array[i * 3 + 1] = g;
      col.array[i * 3 + 2] = bl;
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
