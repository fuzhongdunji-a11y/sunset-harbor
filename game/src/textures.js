// Procedural facade textures (Canvas 2D): three window patterns, each with a daylight map and an emissive map for lit windows.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

const CELLS = 4; // 4x4 windows per tile
const CELL_PX = 32;
export const FACADE_STYLES = { grid: 0, ribbon: 1, shutters: 2 };

function glass(d, x, y, w, h, tint = ['#6fa3c4', '#23405c']) {
  const grad = d.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, tint[0]);
  grad.addColorStop(1, tint[1]);
  d.fillStyle = grad;
  d.fillRect(x, y, w, h);
  d.fillStyle = 'rgba(255,255,255,0.22)'; // sky reflection glint
  d.fillRect(x, y, w, 3);
  d.fillStyle = 'rgba(255,255,255,0.1)';
  d.beginPath();
  d.moveTo(x + w * 0.55, y);
  d.lineTo(x + w * 0.85, y);
  d.lineTo(x + w * 0.35, y + h);
  d.lineTo(x + w * 0.05, y + h);
  d.fill();
}

// One window pattern. `lit(x, y, w, h)` paints a glowing window into both maps.
const PAINTERS = {
  // punched square windows with a centre mullion
  [FACADE_STYLES.grid](d, g, cx, cy, rng, lit) {
    const x = cx * CELL_PX + 7, y = cy * CELL_PX + 6, w = CELL_PX - 14, h = CELL_PX - 14;
    d.fillStyle = 'rgba(0,0,0,0.10)';
    d.fillRect(cx * CELL_PX, cy * CELL_PX + CELL_PX - 3, CELL_PX, 3);
    if (rng() < 0.2) lit(x, y, w, h);
    else glass(d, x, y, w, h);
    d.fillStyle = 'rgba(0,0,0,0.25)';
    d.fillRect(x + w / 2 - 0.5, y, 1, h);
  },
  // continuous glass ribbons separated by pale spandrels (offices)
  [FACADE_STYLES.ribbon](d, g, cx, cy, rng, lit) {
    const x = cx * CELL_PX, y = cy * CELL_PX + 7, w = CELL_PX, h = CELL_PX - 15;
    if (rng() < 0.16) lit(x + 1, y, w - 2, h);
    else glass(d, x, y, w, h, ['#7fb6c9', '#2d5a73']);
    d.fillStyle = 'rgba(0,0,0,0.35)';
    d.fillRect(x, y, 1.5, h); // mullion
    d.fillStyle = 'rgba(0,0,0,0.16)';
    d.fillRect(x, cy * CELL_PX + CELL_PX - 5, w, 5); // spandrel shade
  },
  // tall windows with louvred shutters and a balcony rail on alternate floors (old quarter, marina)
  [FACADE_STYLES.shutters](d, g, cx, cy, rng, lit) {
    const base = cx * CELL_PX, top = cy * CELL_PX;
    const x = base + 10, y = top + 4, w = CELL_PX - 20, h = CELL_PX - 10;
    if (rng() < 0.22) lit(x, y, w, h);
    else glass(d, x, y, w, h);
    d.fillStyle = '#7d7d7d'; // shutters, tinted by the wall colour
    d.fillRect(base + 4, y, 6, h);
    d.fillRect(base + CELL_PX - 10, y, 6, h);
    d.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < h; k += 3) {
      d.fillRect(base + 4, y + k, 6, 1);
      d.fillRect(base + CELL_PX - 10, y + k, 6, 1);
    }
    d.fillStyle = 'rgba(0,0,0,0.15)';
    d.fillRect(base, top + CELL_PX - 3, CELL_PX, 3);
    if (cy % 2 === 1) { // balcony rail
      d.fillStyle = '#3a3a3a';
      d.fillRect(base + 2, top + CELL_PX - 10, CELL_PX - 4, 2);
      for (let k = 4; k < CELL_PX - 2; k += 4) d.fillRect(base + k, top + CELL_PX - 10, 1, 8);
    }
  },
};

export function makeFacadeTextures(seed = 1) {
  const size = CELLS * CELL_PX;
  const make = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const styles = Object.values(FACADE_STYLES).map((style) => {
    const rng = makeRng(seed * 31 + 5 + style * 101);
    const diffuse = document.createElement('canvas');
    const glow = document.createElement('canvas');
    diffuse.width = diffuse.height = glow.width = glow.height = size;
    const d = diffuse.getContext('2d');
    const g = glow.getContext('2d');
    d.fillStyle = '#ffffff';
    d.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    g.fillRect(0, 0, size, size);
    const lit = (x, y, w, h) => {
      const warm = rng() < 0.7 ? '#ffd68a' : '#ffeebb';
      d.fillStyle = warm;
      d.fillRect(x, y, w, h);
      g.fillStyle = warm;
      g.fillRect(x, y, w, h);
    };
    for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) PAINTERS[style](d, g, cx, cy, rng, lit);
    return { map: make(diffuse), emissiveMap: make(glow) };
  });
  return { styles, tileMetres: CELLS * 3.2 };
}
