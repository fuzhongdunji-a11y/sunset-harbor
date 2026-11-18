// HaulerArt: the Stunt Hauler's procedural art. Two Canvas2D textures (the scrolling green chevron deck and the "COSTA COLA" cube face), the quad-drone cube
// (cube + four rotor arms), the tether and the shard geometry. "COSTA COLA" is this game's own fictional soft-drink brand.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from '../meshBuilder.js';

export const CUBE_SIZE = 3;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// 128 x 256: charcoal strip with four neon-green chevrons pointing up the canvas. Repeats vertically so the event can scroll it.
export function makeChevronTexture() {
  const c = canvas(128, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#16181d';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#2b2f38';
  g.fillRect(0, 0, 8, 256);
  g.fillRect(120, 0, 8, 256);
  g.lineJoin = 'miter';
  for (let k = 0; k < 4; k++) {
    const y = 20 + k * 64;
    g.beginPath();
    g.moveTo(14, y + 40);
    g.lineTo(64, y);
    g.lineTo(114, y + 40);
    g.lineTo(114, y + 56);
    g.lineTo(64, y + 16);
    g.lineTo(14, y + 56);
    g.closePath();
    g.fillStyle = '#00ff66';
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 256 x 256 cube face: neon-magenta ground, white and cyan double border, slanted block lettering COSTA / COLA over a yellow sun-wave stripe.
export function makeCubeTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#ff00aa';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 240, 240);
  g.strokeStyle = '#00f6ff';
  g.lineWidth = 5;
  g.strokeRect(22, 22, 212, 212);
  // yellow sun-wave stripe behind the lettering
  g.fillStyle = '#ffee00';
  g.beginPath();
  g.moveTo(22, 128);
  for (let x = 22; x <= 234; x += 4) g.lineTo(x, 128 + Math.sin((x - 22) / 17) * 9);
  for (let x = 234; x >= 22; x -= 4) g.lineTo(x, 170 + Math.sin((x - 22) / 17) * 9);
  g.closePath();
  g.fill();
  g.save();
  g.translate(128, 0);
  g.transform(1, 0, -0.22, 1, 0, 0); // retro slant
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = 'italic 900 62px Impact, "Arial Black", sans-serif';
  g.lineWidth = 8;
  g.strokeStyle = '#4a0036';
  g.fillStyle = '#ffffff';
  g.strokeText('COSTA', 0, 118);
  g.fillText('COSTA', 0, 118);
  g.font = 'italic 900 70px Impact, "Arial Black", sans-serif';
  g.strokeText('COLA', 0, 204);
  g.fillStyle = '#00f6ff';
  g.fillText('COLA', 0, 204);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The drone: a textured 3 m cube plus four black rotor arms with glowing cyan disc quads (a second mesh, so two draw calls in all).
export function buildDroneCube(faceTexture) {
  const group = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), new THREE.MeshBasicMaterial({ map: faceTexture, fog: false }));
  const b = new MeshBuilder();
  const h = CUBE_SIZE / 2;
  const disc = new THREE.Color(0.0, 2.4, 2.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (h + 0.5), cz = sz * (h + 0.5);
      b.box(Math.min(sx * h, cx) - 0.06, h - 0.05, Math.min(sz * h, cz) - 0.06, Math.max(sx * h, cx) + 0.06, h + 0.07, Math.max(sz * h, cz) + 0.06, 0x15161a); // arm
      b.box(cx - 0.05, h - 0.05, cz - 0.05, cx + 0.05, h + 0.2, cz + 0.05, 0x15161a); // motor post
      // 0.6 m rotor disc: a square plus two crossed blades make a rough octagon (the whole drone turns, so it reads as spinning)
      b.flat(cx - 0.22, cz - 0.22, cx + 0.22, cz + 0.22, h + 0.22, disc);
      b.flat(cx - 0.3, cz - 0.1, cx + 0.3, cz + 0.1, h + 0.22, disc);
      b.flat(cx - 0.1, cz - 0.3, cx + 0.1, cz + 0.3, h + 0.22, disc);
    }
  }
  const rotors = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
  group.add(cube, rotors);
  return { group, cube, rotors };
}

// Thin pink beam, unit length along Y (scale.y = length).
export function buildTether() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), new THREE.MeshBasicMaterial({ color: 0xff44cc, transparent: true, opacity: 0.55, fog: false }));
  m.frustumCulled = false;
  return m;
}

// 16 neon shards in one InstancedMesh: a small tetrahedron, coloured per instance (magenta / cyan / yellow).
export const SHARD_COUNT = 16;
const SHARD_COLORS = [0xff00aa, 0x00f6ff, 0xffee00];
export function buildShards(scene) {
  const mesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), SHARD_COUNT);
  const c = new THREE.Color();
  for (let k = 0; k < SHARD_COUNT; k++) mesh.setColorAt(k, c.set(k < 2 ? 0xff00aa : SHARD_COLORS[k % 3]));
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}
