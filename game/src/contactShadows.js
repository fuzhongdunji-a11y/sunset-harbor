// contactShadows: soft blob shadows under cars and people, drawn as ONE instanced mesh (a single draw call for all of them).
// Usage each frame: begin(); add(...) per caster; end().
import * as THREE from '../vendor/three.module.min.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(20,28,48,0.85)');
  grad.addColorStop(0.55, 'rgba(20,28,48,0.5)');
  grad.addColorStop(1, 'rgba(20,28,48,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ContactShadows {
  constructor(scene, max = 160) {
    this.max = max;
    this.count = 0;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.75, fog: true,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  // Centre (x, y, z), half-extents rx (across) and rz (along the heading), heading h (radians).
  add(x, y, z, rx, rz, h) {
    if (this.count >= this.max) return;
    _q.setFromAxisAngle(_up, h);
    _m.compose(_p.set(x, y + 0.03, z), _q, _s.set(rx * 2, 1, rz * 2));
    this.mesh.setMatrixAt(this.count++, _m);
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
