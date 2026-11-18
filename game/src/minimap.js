// minimap: Canvas 2D radar. The static city is pre-rendered once; each frame it is rotated so the camera heading points up.
import { WORLD } from './config.js';

const S = 2; // pixels per metre in the pre-rendered map
const X_MAX = 350;
const Z_MIN = -310;
const Z_MAX = 440;
const PAL = {
  sea: '#1f6f9c', shallow: '#3b9cc4', grass: '#a3c785', sand: '#f4e2b2', park: '#6fb25e', pier: '#a97c4e', quay: '#c4bfb2',
  block: '#eadfc8', kerb: '#c9bda4', road: '#3a4350', lane: '#f2d675', tall: '#6f7f93', low: '#b8a88f', cargo: '#7d8a97',
};
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
    g.fillStyle = PAL.sea; // deep blue so land (warm) and water (cool) never blur together
    g.fillRect(0, 0, c.width, c.height);
    const rect = (x0, z0, x1, z1, color) => {
      g.fillStyle = color;
      g.fillRect(u(x1), v(z1), (x1 - x0) * S, (z1 - z0) * S);
    };
    // a lighter shallows band along the shore, then land
    rect(-X_MAX, WORLD.shoreZ, X_MAX, WORLD.shoreZ + 26, PAL.shallow);
    rect(-X_MAX, Z_MIN, X_MAX, WORLD.sandZ, PAL.grass);
    rect(-X_MAX, WORLD.sandZ, X_MAX, WORLD.shoreZ, PAL.sand);
    for (const d of L.docks) rect(d.x0, d.z0, d.x1, d.z1, d.name.includes('Pier') ? PAL.pier : PAL.quay);
    // blocks first (warm, light), roads on top (dark with a pale kerb line), so the street grid reads at a glance
    for (const b of L.blocks) {
      const h = b.size / 2;
      rect(b.cx - h, b.cz - h, b.cx + h, b.cz + h, b.park ? PAL.park : PAL.block);
    }
    const W = WORLD.road;
    const zA = L.zs[0] - W / 2, zB = L.zs[L.zs.length - 1] + W / 2;
    const xA = L.xs[0] - W / 2, xB = L.xs[L.xs.length - 1] + W / 2;
    for (const x of L.xs) rect(x - W / 2 - 1, zA - 1, x + W / 2 + 1, zB + 1, PAL.kerb);
    for (const z of L.zs) rect(xA - 1, z - W / 2 - 1, xB + 1, z + W / 2 + 1, PAL.kerb);
    for (const x of L.xs) rect(x - W / 2, zA, x + W / 2, zB, PAL.road);
    for (const z of L.zs) rect(xA, z - W / 2, xB, z + W / 2, PAL.road);
    g.fillStyle = PAL.lane;
    for (const x of L.xs) g.fillRect(u(x) - 0.5, v(zB), 1, (zB - zA) * S);
    for (const z of L.zs) g.fillRect(u(xB), v(z) - 0.5, (xB - xA) * S, 1);
    for (const b of L.buildings) rect(b.x0, b.z0, b.x1, b.z1, b.h > 40 ? PAL.tall : PAL.low);
    for (const c2 of L.containers) rect(c2.x0, c2.z0, c2.x1, c2.z1, PAL.cargo);
    return c;
  }

  // missionPos: {x, z} or null; camYaw: direction the camera looks along.
  draw(player, vehicles, missionPos, camYaw, extras = {}, zoomOverride) {
    const g = this.ctx;
    const n = this.size;
    const R = n / 2;
    // zoom out with speed so the next junction is visible in time; eased so the map never pumps
    const target = player.inCar ? 0.78 - Math.min(0.26, Math.abs(player.vehicle.speedF) * 0.0075) : 1.0;
    this.zoom = this.zoom === undefined ? target : this.zoom + (target - this.zoom) * 0.08;
    const zoom = zoomOverride ?? this.zoom;
    g.clearRect(0, 0, n, n);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = PAL.sea;
    g.fillRect(0, 0, n, n);
    g.translate(R, R);
    g.rotate(camYaw);
    g.scale(zoom, zoom);
    g.translate(-u(player.px), -v(player.pz));
    g.drawImage(this.map, 0, 0);
    const now = performance.now() / 1000;
    for (const car of vehicles.list) {
      if (car === player.vehicle || car.kind === 'target') continue; // the intercept quarry gets its own triangle
      const police = car.kind === 'police';
      const parked = car.kind === 'parked';
      g.save();
      g.translate(u(car.x), v(car.z));
      g.rotate(-car.h);
      const w = car.type.wid * S, l = car.type.len * S;
      if (police) {
        const blink = Math.floor(now * 6) % 2 === 0;
        g.fillStyle = blink ? '#ff3b30' : '#3a78ff';
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.fillRect(-6, -9.5, 12, 19);
        g.strokeRect(-6, -9.5, 12, 19);
        g.strokeStyle = 'rgba(12,16,24,0.9)'; // dark outer edge keeps the white outline readable on pale blocks
        g.lineWidth = 1;
        g.strokeRect(-7.2, -10.7, 14.4, 21.4);
      } else {
        g.fillStyle = parked ? '#8f9aa8' : '#ffffff';
        g.strokeStyle = 'rgba(12,16,24,0.9)';
        g.lineWidth = 1.2;
        g.fillRect(-w / 2, -l / 2, w, l);
        g.strokeRect(-w / 2, -l / 2, w, l);
      }
      g.restore();
    }
    if (extras.peds) {
      g.fillStyle = '#ffd23f';
      g.strokeStyle = 'rgba(12,16,24,0.85)';
      g.lineWidth = 0.9;
      for (const p of extras.peds) {
        if (!p.active || p.state === 'down' || !p.model.group.visible) continue;
        g.beginPath();
        g.arc(u(p.x), v(p.z), 1.9, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    const inv = 1 / zoom; // sizes below are screen pixels, drawn inside the zoomed map transform
    // Sun-Crests inside the radar radius: a golden diamond with a sonar ring that expands every 1.5 s
    if (extras.crests) {
      for (const c of extras.crests) {
        const ph = (now % 1.5) / 1.5;
        g.save();
        g.translate(u(c.x), v(c.z));
        g.strokeStyle = `rgba(255, 210, 63, ${(1 - ph).toFixed(2)})`;
        g.lineWidth = 2.2 * inv;
        g.beginPath();
        g.arc(0, 0, (5 + ph * 24) * inv, 0, Math.PI * 2);
        g.stroke();
        g.scale(inv, inv);
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(5, 0);
        g.lineTo(0, 6);
        g.lineTo(-5, 0);
        g.closePath();
        g.fillStyle = '#ffd23f';
        g.strokeStyle = 'rgba(12,16,24,0.95)';
        g.lineWidth = 2;
        g.stroke();
        g.fill();
        g.restore();
      }
    }
    // Signal Intercept quarry: cyan triangle, dashed red inner ring (15 m) and a solid outer ring (45 m) that flashes yellow when we are out of range
    const ic = extras.intercept;
    if (ic) {
      g.save();
      g.translate(u(ic.x), v(ic.z));
      g.lineWidth = 2.4 * inv;
      g.strokeStyle = 'rgba(255, 74, 60, 0.95)';
      g.setLineDash([6 * inv, 5 * inv]);
      g.beginPath();
      g.arc(0, 0, ic.near * S, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 3.2 * inv;
      g.strokeStyle = ic.outside && Math.floor(now * 4) % 2 === 0 ? '#ffd23f' : '#4fe6ff';
      g.beginPath();
      g.arc(0, 0, ic.far * S, 0, Math.PI * 2);
      g.stroke();
      g.rotate(-ic.h);
      g.scale(inv, inv);
      g.beginPath();
      g.moveTo(0, -8);
      g.lineTo(6, 6);
      g.lineTo(-6, 6);
      g.closePath();
      g.lineJoin = 'round';
      g.strokeStyle = '#12151c';
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#4fe6ff';
      g.fill();
      g.restore();
    }
    // Armored Shakedown: pulsing gold shield on the truck (dark square once its armor is gone), yellow diamonds on loose briefcases, double ring on the drop-off
    const am = extras.armored;
    if (am) {
      const badge = (x, z, draw) => {
        g.save();
        g.translate(u(x), v(z));
        g.rotate(-camYaw); // keep icons upright on the rotating map
        g.scale(inv, inv);
        g.lineJoin = 'round';
        draw();
        g.restore();
      };
      const outline = (fill, widthOuter = 5) => {
        g.strokeStyle = '#12151c';
        g.lineWidth = widthOuter;
        g.stroke();
        g.strokeStyle = '#ffffff';
        g.lineWidth = widthOuter - 3;
        g.stroke();
        g.fillStyle = fill;
        g.fill();
      };
      if (am.drop) {
        badge(am.drop.x, am.drop.z, () => {
          const pr = 1 + Math.sin(now * 4) * 0.08;
          g.scale(pr, pr);
          g.beginPath();
          g.arc(0, 0, 13, 0, Math.PI * 2);
          g.strokeStyle = '#12151c';
          g.lineWidth = 7;
          g.stroke();
          g.strokeStyle = '#ffc21a';
          g.lineWidth = 4;
          g.stroke();
          g.beginPath();
          g.arc(0, 0, 6, 0, Math.PI * 2);
          outline('#ffc21a', 6);
        });
      }
      for (const c of am.cases) {
        badge(c.x, c.z, () => {
          const pr = 1 + Math.sin(now * 7) * 0.12;
          g.scale(pr, pr);
          g.beginPath();
          g.moveTo(0, -8);
          g.lineTo(6.5, 0);
          g.lineTo(0, 8);
          g.lineTo(-6.5, 0);
          g.closePath();
          outline('#ffe83a');
        });
      }
      if (am.wreck) {
        badge(am.wreck.x, am.wreck.z, () => {
          g.beginPath();
          g.rect(-5, -7, 10, 14);
          outline('#8a6a1c');
        });
      }
      if (am.truck) {
        badge(am.truck.x, am.truck.z, () => {
          const pr = 1.15 + Math.sin(now * 6) * 0.14;
          g.scale(pr, pr);
          g.beginPath();
          g.moveTo(-8, -8);
          g.lineTo(8, -8);
          g.lineTo(8, 1);
          g.lineTo(0, 10);
          g.lineTo(-8, 1);
          g.closePath();
          outline('#ffc21a', 6);
          g.beginPath();
          g.moveTo(-3.5, -3.5);
          g.lineTo(3.5, -3.5);
          g.lineTo(3.5, 0.5);
          g.lineTo(0, 5);
          g.lineTo(-3.5, 0.5);
          g.closePath();
          g.fillStyle = '#1b2a4e';
          g.fill();
        });
      }
    }
    g.restore();

    // mission marker (clamped to the rim when it is out of range)
    const amOnMap = am && am.target && Math.hypot(am.target.x - player.px, am.target.z - player.pz) * S * zoom <= R - 14;
    const quarryOnMap = (ic && ic.dist * S * zoom <= R - 14) || amOnMap; // their own icons already mark the target, so no second pin
    if (missionPos && !quarryOnMap) {
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
      const pulse = 1 + Math.sin(now * 5) * 0.08;
      g.scale(pulse, pulse);
      g.fillStyle = '#ffd23f';
      g.lineJoin = 'round';
      if (edge) {
        g.rotate(Math.atan2(my, mx) + Math.PI / 2);
        g.beginPath();
        g.moveTo(0, -12);
        g.lineTo(10, 8);
        g.lineTo(-10, 8);
        g.closePath();
        g.strokeStyle = '#12151c'; // dark halo, then white edge, then the yellow fill
        g.lineWidth = 7;
        g.stroke();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 3.5;
        g.stroke();
        g.fill();
      } else {
        g.beginPath();
        g.arc(0, 0, 10, 0, Math.PI * 2);
        g.strokeStyle = '#12151c';
        g.lineWidth = 7;
        g.stroke();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 3.5;
        g.stroke();
        g.fill();
        g.fillStyle = '#12151c'; // centre dot so it reads as a target pin, not another car
        g.beginPath();
        g.arc(0, 0, 3.2, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    // player: soft view cone behind the arrow, then a dark-haloed coral arrow (always points up)
    g.save();
    g.translate(R, R);
    const cone = g.createRadialGradient(0, 0, 8, 0, 0, 62);
    cone.addColorStop(0, 'rgba(255,255,255,0.42)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 62, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    g.closePath();
    g.fill();
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(0, -15);
    g.lineTo(10.5, 11);
    g.lineTo(0, 5.5);
    g.lineTo(-10.5, 11);
    g.closePath();
    g.strokeStyle = '#12151c';
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3.2;
    g.stroke();
    g.fillStyle = '#ff5a3c';
    g.fill();
    g.restore();
    // rim: dark outer ring + white ring so the disc separates from any scene colour behind it
    g.strokeStyle = 'rgba(12,16,24,0.7)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(R, R, R - 1.5, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(R, R, R - 4.5, 0, Math.PI * 2);
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
