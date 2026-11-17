// Procedural window textures (Canvas 2D): a daylight facade map plus an emissive map that makes some windows glow.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

const CELLS = 4; // 4x4 windows per tile
const CELL_PX = 32;

export function makeFacadeTextures(seed = 1) {
  const rng = makeRng(seed * 31 + 5);
  const size = CELLS * CELL_PX;
  const diffuse = document.createElement('canvas');
  const glow = document.createElement('canvas');
  diffuse.width = diffuse.height = glow.width = glow.height = size;
  const d = diffuse.getContext('2d');
  const g = glow.getContext('2d');
  d.fillStyle = '#ffffff';
  d.fillRect(0, 0, size, size);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);

  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const x = cx * CELL_PX + 7;
      const y = cy * CELL_PX + 6;
      const w = CELL_PX - 14;
      const h = CELL_PX - 14;
      // floor slab line (slightly darker band under every row)
      d.fillStyle = 'rgba(0,0,0,0.10)';
      d.fillRect(cx * CELL_PX, cy * CELL_PX + CELL_PX - 3, CELL_PX, 3);
      const lit = rng() < 0.2;
      if (lit) {
        const warm = rng() < 0.7 ? '#ffd68a' : '#ffeebb';
        d.fillStyle = warm;
        d.fillRect(x, y, w, h);
        g.fillStyle = warm;
        g.fillRect(x, y, w, h);
      } else {
        const grad = d.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, '#6fa3c4');
        grad.addColorStop(1, '#23405c');
        d.fillStyle = grad;
        d.fillRect(x, y, w, h);
        // sky reflection glint
        d.fillStyle = 'rgba(255,255,255,0.22)';
        d.fillRect(x, y, w, 3);
      }
      d.fillStyle = 'rgba(0,0,0,0.25)';
      d.fillRect(x + w / 2 - 0.5, y, 1, h);
    }
  }

  const make = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: make(diffuse), emissiveMap: make(glow), tileMetres: CELLS * 3.2 };
}
