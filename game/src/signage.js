// signage: Canvas-drawn atlas of Costa Serena shop and harbour signs (all names are invented), plus UV lookup per sign.
import * as THREE from '../vendor/three.module.min.js';

// [text, background, text colour, accent]
export const SIGNS = [
  ['LA SIRENA CAFE', '#17a398', '#fff8e6', '#f6d55c'],
  ['HARBOR BURGER', '#e4572e', '#fff8e6', '#f6d55c'],
  ['COSTA MARKET', '#3d8f4f', '#ffffff', '#f2c230'],
  ['BLUE MARLIN BAR', '#1d3f73', '#ffe9a8', '#2e86ab'],
  ["SUNNY'S DINER", '#f2c230', '#7a2418', '#e4572e'],
  ['NOODLE HOUSE', '#b5262a', '#fff1d0', '#ffd24a'],
  ['SALT & LIME', '#7bc47f', '#14412b', '#ffffff'],
  ['TIDE PHARMACY', '#f4f1ea', '#0f7d6d', '#17a398'],
  ['GELATO SERENA', '#f2b8c6', '#8a1f4d', '#ffffff'],
  ['VESPER MOTORS', '#2b2d33', '#ff6f4e', '#f4f1ea'],
  ['ISLAND BOOKS', '#6a4c93', '#fff1d0', '#f2a541'],
  ['PORT & PINT', '#6b3f22', '#ffd27a', '#f4f1ea'],
  ['FRESH CATCH', '#2e86ab', '#ffffff', '#f6d55c'],
  ['NEON LAUNDRY', '#2a2d6e', '#7ff0ff', '#ff5fa8'],
  ['CORAL BANK', '#e9806e', '#ffffff', '#fff1d0'],
  ['TACO BAHIA', '#f2a541', '#5a1d12', '#17a398'],
  ['HARBOR LINE CO.', '#1d3f73', '#ffffff', '#f2c230'],
  ['LANTERN PIER', '#c43a2b', '#fff8e6', '#ffffff'],
];

export const SHOP_SIGN_COUNT = 16; // indices 0..15 are shopfronts; the rest are harbour signs
const COLS = 2;
const ROWS = 16;
const CELL_W = 512;
const CELL_H = 64;

export function makeSignAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#888';
  g.fillRect(0, 0, canvas.width, canvas.height);
  SIGNS.forEach(([text, bg, fg, accent], i) => {
    const x = (i % COLS) * CELL_W;
    const y = Math.floor(i / COLS) * CELL_H;
    g.fillStyle = bg;
    g.fillRect(x, y, CELL_W, CELL_H);
    g.fillStyle = accent;
    g.fillRect(x, y, CELL_W, 6);
    g.fillRect(x, y + CELL_H - 6, CELL_W, 6);
    for (let k = 0; k < 6; k++) { // little pennant chain on both ends
      g.beginPath();
      g.moveTo(x + 14 + k * 11, y + 14);
      g.lineTo(x + 22 + k * 11, y + CELL_H - 14);
      g.lineTo(x + 30 + k * 11, y + 14);
      g.fill();
      g.beginPath();
      g.moveTo(x + CELL_W - 14 - k * 11, y + 14);
      g.lineTo(x + CELL_W - 22 - k * 11, y + CELL_H - 14);
      g.lineTo(x + CELL_W - 30 - k * 11, y + 14);
      g.fill();
    }
    let size = 40;
    g.font = `italic 800 ${size}px "Trebuchet MS", "Arial Black", sans-serif`;
    const maxW = CELL_W - 200;
    const mw = g.measureText(text).width;
    if (mw > maxW) {
      size = Math.floor((size * maxW) / mw);
      g.font = `italic 800 ${size}px "Trebuchet MS", "Arial Black", sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillText(text, x + CELL_W / 2 + 2, y + CELL_H / 2 + 3);
    g.fillStyle = fg;
    g.fillText(text, x + CELL_W / 2, y + CELL_H / 2 + 1);
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

// [u0, v0, u1, v1] of sign i (v grows upwards in texture space).
export function signUV(i) {
  const c = i % COLS, r = Math.floor(i / COLS);
  const eps = 0.002;
  return [c / COLS + eps, 1 - (r + 1) / ROWS + eps, (c + 1) / COLS - eps, 1 - r / ROWS - eps];
}
