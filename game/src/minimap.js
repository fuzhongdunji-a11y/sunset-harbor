// minimap: Canvas 2D radar. The static city is pre-rendered once; each frame it is rotated so the camera heading points up.
import { WORLD } from './config.js';

const S = 2; // pixels per metre in the pre-rendered map
const X_MAX = 350;
const Z_MIN = -310;
const Z_MAX = 440;
const u = (x) => (X_MAX - x) * S; // map X = -x
const v = (z) => (Z_MAX - z) * S; // map Y = -z

export class Minimap {
  constructor(canvas, layout) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layout = layout;
    this.size = canvas.width;
    this.map = this._prerender();
  }

  _prerender() {
    const L = this.layout;
    const c = document.createElement('canvas');
    c.width = X_MAX * 2 * S;
    c.height = (Z_MAX - Z_MIN) * S;
    const g = c.getContext('2d');
    g.fillStyle = '#4faccc'; // sea
    g.fillRect(0, 0, c.width, c.height);
    const rect = (x0, z0, x1, z1, color) => {
      g.fillStyle = color;
      g.fillRect(u(x1), v(z1), (x1 - x0) * S, (z1 - z0) * S);
    };
    rect(-X_MAX, Z_MIN, X_MAX, WORLD.sandZ, '#a9cc8e'); // grass
    rect(-X_MAX, WORLD.sandZ, X_MAX, WORLD.shoreZ, '#f1dfb0'); // sand
    for (const d of L.docks) rect(d.x0, d.z0, d.x1, d.z1, d.name.includes('Pier') ? '#b08c5e' : '#bdb9ae');
    // roads
    g.fillStyle = '#56606d';
    const W = WORLD.road;
    for (const x of L.xs) rect(x - W / 2, L.zs[0] - W / 2, x + W / 2, L.zs[L.zs.length - 1] + W / 2, '#56606d');
    for (const z of L.zs) rect(L.xs[0] - W / 2, z - W / 2, L.xs[L.xs.length - 1] + W / 2, z + W / 2, '#56606d');
    g.fillStyle = '#e9d58a';
    for (const x of L.xs) g.fillRect(u(x) - 0.5, v(L.zs[L.zs.length - 1]), 1, (L.zs[L.zs.length - 1] - L.zs[0]) * S);
    for (const z of L.zs) g.fillRect(u(L.xs[L.xs.length - 1]), v(z) - 0.5, (L.xs[L.xs.length - 1] - L.xs[0]) * S, 1);
    // blocks and buildings
    for (const b of L.blocks) {
      const h = b.size / 2;
      rect(b.cx - h, b.cz - h, b.cx + h, b.cz + h, b.park ? '#78b565' : '#d6d0c3');
    }
    for (const b of L.buildings) rect(b.x0, b.z0, b.x1, b.z1, b.h > 40 ? '#8794a3' : '#a9a396');
    for (const c2 of L.containers) rect(c2.x0, c2.z0, c2.x1, c2.z1, '#7d8a97');
    return c;
  }

  // missionPos: {x, z} or null; camYaw: direction the camera looks along.
  draw(player, vehicles, missionPos, camYaw, zoomOverride) {
    const g = this.ctx;
    const n = this.size;
    const R = n / 2;
    const zoom = zoomOverride ?? (player.inCar ? 0.7 + Math.max(0, 0.15 - Math.abs(player.vehicle.speedF) * 0.004) : 1.15);
    g.clearRect(0, 0, n, n);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#4faccc';
    g.fillRect(0, 0, n, n);
    g.translate(R, R);
    g.rotate(camYaw);
    g.scale(zoom, zoom);
    g.translate(-u(player.px), -v(player.pz));
    g.drawImage(this.map, 0, 0);
    for (const car of vehicles.list) {
      if (car === player.vehicle) continue;
      g.save();
      g.translate(u(car.x), v(car.z));
      g.rotate(-car.h);
      g.fillStyle = '#f2f2f2';
      g.strokeStyle = 'rgba(20,24,30,0.85)';
      g.lineWidth = 1;
      const w = car.type.wid * S, l = car.type.len * S;
      g.fillRect(-w / 2, -l / 2, w, l);
      g.strokeRect(-w / 2, -l / 2, w, l);
      g.restore();
    }
    g.restore();

    // mission marker (clamped to the rim when it is out of range)
    if (missionPos) {
      const dx = (u(missionPos.x) - u(player.px)) * zoom;
      const dy = (v(missionPos.z) - v(player.pz)) * zoom;
      const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
      let mx = dx * cs - dy * sn;
      let my = dx * sn + dy * cs;
      const dist = Math.hypot(mx, my);
      const lim = R - 14;
      const edge = dist > lim;
      if (edge) {
        mx = (mx / dist) * lim;
        my = (my / dist) * lim;
      }
      g.save();
      g.translate(R + mx, R + my);
      g.fillStyle = '#ffd23f';
      g.strokeStyle = '#1b1f27';
      g.lineWidth = 3;
      g.beginPath();
      if (edge) {
        g.rotate(Math.atan2(my, mx) + Math.PI / 2);
        g.moveTo(0, -9);
        g.lineTo(8, 7);
        g.lineTo(-8, 7);
        g.closePath();
      } else {
        g.arc(0, 0, 8, 0, Math.PI * 2);
      }
      g.stroke();
      g.fill();
      g.restore();
    }

    // player arrow (always points up) and rim
    g.save();
    g.translate(R, R);
    g.fillStyle = '#ff5a3c';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -13);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.stroke();
    // "N" on the rim: world -z is north, which is map-down before the rotation
    const nr = R - 17;
    const nx = R + -Math.sin(camYaw) * nr;
    const ny = R + Math.cos(camYaw) * nr;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(nx, ny, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1f27';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 1);
  }
}
