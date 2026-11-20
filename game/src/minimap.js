// minimap: Canvas 2D radar. The static city is pre-rendered once; each frame it is rotated so the camera heading points up.
import { WORLD } from './config.js';

export const S = 2; // pixels per metre in the pre-rendered map (hud.js draws the Air-1 overlay with the same transform)
export const X_MAX = 350;
const Z_MIN = -310;
export const Z_MAX = 440;
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

  // Solaris Customs: a coral/teal wrench badge pinned to the rim when out of range, a pulsing cyan escape ring at 1-4 stars (Heat-Wipe ready),
  // a gold diamond on the Export Pad and a dashed guide line to it while driving the wanted model.
  _customs(g, c, player, camYaw, zoom, now) {
    const R = this.size / 2, lim = R - 22, cs = Math.cos(camYaw), sn = Math.sin(camYaw);
    const to = (x, z) => {
      const dx = (u(x) - u(player.px)) * zoom, dy = (v(z) - v(player.pz)) * zoom;
      let mx = dx * cs - dy * sn, my = dx * sn + dy * cs;
      const d = Math.hypot(mx, my);
      if (d > lim) { mx = (mx / d) * lim; my = (my / d) * lim; }
      return [R + mx, R + my];
    };
    const [gx, gy] = to(c.x, c.z);
    if (c.ex) {
      const [ex, ey] = to(c.ex.x, c.ex.z);
      if (c.match) {
        g.save();
        g.setLineDash([8, 7]);
        g.strokeStyle = '#ffd166';
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(R, R); g.lineTo(ex, ey); g.stroke();
        g.restore();
      }
      g.save();
      g.translate(ex + 14, ey - 4);
      g.beginPath(); g.moveTo(0, -7); g.lineTo(7, 0); g.lineTo(0, 7); g.lineTo(-7, 0); g.closePath();
      g.fillStyle = '#ffd166'; g.fill();
      g.strokeStyle = '#12151c'; g.lineWidth = 2; g.stroke();
      g.restore();
    }
    if (c.ring) {
      const ph = (now * 2.5) % 1;
      g.strokeStyle = `rgba(0,245,212,${(1 - ph).toFixed(2)})`;
      g.lineWidth = 3.5;
      g.beginPath(); g.arc(gx, gy, (7 + 5 * ph) * 1.9, 0, Math.PI * 2); g.stroke();
    }
    g.save();
    g.translate(gx, gy);
    g.fillStyle = '#1e293b';
    g.strokeStyle = '#00e5c3';
    g.lineWidth = 3;
    g.beginPath(); g.roundRect(-11, -11, 22, 22, 5); g.fill(); g.stroke();
    g.strokeStyle = '#ff5e5b';
    g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(-6, 6); g.lineTo(6, -6); g.stroke();
    g.beginPath(); g.arc(6.5, -6.5, 3.2, 0, Math.PI * 2); g.stroke();
    g.restore();
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
    for (const d of L.docks) rect(d.x0, d.z0, d.x1, d.z1, d.marina ? '#c89d6c' : d.name.includes('Pier') ? PAL.pier : PAL.quay);
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
    const now = extras.now ?? performance.now() / 1000; // extras.now lets a screenshot preset freeze the blink/pulse clock
    for (const car of vehicles.list) {
      if (car === player.vehicle || car.kind === 'target' || car.kind === 'rival') continue; // the intercept quarry gets its own triangle; Sunset GP rivals get coloured dots
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
    // Costa Tow Service: a pulsing orange ring on the stranded car, then on the drop-off (clamped to the rim like the other job markers)
    if (extras.tow) {
      const t = extras.tow;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      g.beginPath();
      g.arc(0, 0, far ? 6 : 7 + 1.8 * Math.sin(now * 5), 0, Math.PI * 2);
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.strokeStyle = '#ffa500';
      g.lineWidth = 3;
      g.stroke();
      g.restore();
    }
    // Harbor Loop Tour: a pulsing pink diamond on the stand, then on the next checkpoint (rim-clamped like the other job markers)
    if (extras.loopTour) {
      const t = extras.loopTour;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      const r = far ? 6 : 7.5 + 1.6 * Math.sin(now * 5);
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      g.beginPath();
      g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath();
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = '#ff5da2';
      g.fill();
      g.strokeStyle = '#ffd1e6';
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }
    // Armored Cash Pickup: a pulsing green diamond on the nearest shop, then on the vault (rim-clamped like the other job markers)
    if (extras.cashPickup) {
      const t = extras.cashPickup;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      const r = far ? 5.5 : 7 + 1.4 * Math.sin(now * 4);
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      g.beginPath();
      g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath();
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = '#2ee66b';
      g.fill();
      g.strokeStyle = '#d6ffe4';
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }
    // Paramedic Rush: a pulsing red diamond on the accident scene, then the hospital
    if (extras.paramedic) {
      const t = extras.paramedic;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      const r = far ? 5.5 : 7 + 1.4 * Math.sin(now * 4);
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      g.beginPath();
      g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath();
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = '#ff4444';
      g.fill();
      g.strokeStyle = '#ffd6d6';
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }
    // Costa Cab: a pulsing yellow ring with a dark outline on the current stand or drop-off (the radar rim clamps far ones like other markers)
    if (extras.taxi) {
      const t = extras.taxi;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      const pr = 7 + 1.8 * Math.sin(now * 5);
      g.beginPath();
      g.arc(0, 0, far ? 6 : pr, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.strokeStyle = '#ffd400';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = '#ffd400';
      g.beginPath();
      g.arc(0, 0, 2.4, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // Sunset Photo Tour: a sunset-orange diamond with a dark outline on the current stand or photo spot (rim-clamped like the cab ring)
    if (extras.photo) {
      const t = extras.photo;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      const pr = (far ? 6 : 7.5) + (far ? 0 : 1.6 * Math.sin(now * 5));
      g.beginPath();
      g.moveTo(0, -pr);
      g.lineTo(pr, 0);
      g.lineTo(0, pr);
      g.lineTo(-pr, 0);
      g.closePath();
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = '#ff7a2e';
      g.fill();
      g.strokeStyle = '#ffc48a';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
    // Costa Food Delivery: a teal-green square with a dark outline on the current restaurant or customer (rim-clamped; square so it reads apart from the cab ring and the photo diamond)
    if (extras.courier) {
      const t = extras.courier;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      const sq = (far ? 5 : 6.5) + (far ? 0 : 1.4 * Math.sin(now * 5));
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.strokeRect(-sq, -sq, sq * 2, sq * 2);
      g.fillStyle = '#14d6a0';
      g.fillRect(-sq, -sq, sq * 2, sq * 2);
      g.strokeStyle = '#d6fff2';
      g.lineWidth = 2;
      g.strokeRect(-sq, -sq, sq * 2, sq * 2);
      g.restore();
    }
    // Marina Hotel Valet: a violet upward triangle with a dark outline on the current hotel or bay (rim-clamped; a triangle reads apart from the cab ring, photo diamond and courier square)
    if (extras.valet) {
      const t = extras.valet;
      let dx = u(t.x) - u(player.px), dy = v(t.z) - v(player.pz);
      const d = Math.hypot(dx, dy), maxD = (R - 14) / zoom;
      const far = d > maxD;
      if (far) { dx *= maxD / d; dy *= maxD / d; }
      g.save();
      g.translate(u(player.px) + dx, v(player.pz) + dy);
      g.scale(inv, inv);
      const tr = (far ? 6 : 7.5) + (far ? 0 : 1.4 * Math.sin(now * 5));
      g.beginPath();
      g.moveTo(0, -tr);
      g.lineTo(tr * 0.95, tr * 0.75);
      g.lineTo(-tr * 0.95, tr * 0.75);
      g.closePath();
      g.strokeStyle = 'rgba(12,16,24,0.95)';
      g.lineWidth = 6;
      g.stroke();
      g.fillStyle = '#c44dff';
      g.fill();
      g.strokeStyle = '#f0d4ff';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
    // Sunset GP: checkered start ring while idle; during a race the glowing route, a pulsing cyan ring on the active gate, a checkered finish and the three rival dots
    const gp = extras.gp;
    if (gp) {
      const ring = (x, z, r, col) => { g.strokeStyle = col; g.lineWidth = 3 * inv; g.beginPath(); g.arc(u(x), v(z), r * inv, 0, Math.PI * 2); g.stroke(); };
      if (gp.start) {
        g.save();
        g.translate(u(gp.start.x), v(gp.start.z));
        g.scale(inv, inv);
        g.beginPath();
        g.arc(0, 0, 9, 0, Math.PI * 2);
        g.strokeStyle = '#12151c';
        g.lineWidth = 6;
        g.stroke();
        g.strokeStyle = gp.start.blocked ? '#ffaa22' : '#ff2a85';
        g.lineWidth = 3.4;
        g.stroke();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(0, 0, 3.6, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      if (gp.route && gp.route.length > 1) {
        g.lineJoin = 'round';
        g.beginPath();
        gp.route.forEach((q, i) => (i ? g.lineTo(u(q.x), v(q.z)) : g.moveTo(u(q.x), v(q.z))));
        g.strokeStyle = 'rgba(255,42,133,0.35)';
        g.lineWidth = 7 * inv;
        g.stroke();
        g.strokeStyle = '#ff2a85';
        g.lineWidth = 2.5 * inv;
        g.stroke();
      }
      if (gp.gate) ring(gp.gate.x, gp.gate.z, 7 + 2.5 * Math.sin(now * 6), '#00e5ff');
      if (gp.finish && gp.route) {
        g.save();
        g.translate(u(gp.finish.x), v(gp.finish.z));
        g.scale(inv, inv);
        for (let a = 0; a < 3; a++) for (let b2 = 0; b2 < 3; b2++) { g.fillStyle = (a + b2) % 2 ? '#ffffff' : '#12151c'; g.fillRect(-6 + a * 4, -6 + b2 * 4, 4, 4); }
        g.restore();
      }
      const maxD = (R - 14) / zoom; // far rivals ride the rim so the pack spacing stays readable
      for (const r of gp.rivals ?? []) {
        let dx = u(r.x) - u(player.px), dy = v(r.z) - v(player.pz);
        const d = Math.hypot(dx, dy);
        if (d > maxD) { dx *= maxD / d; dy *= maxD / d; }
        g.save();
        g.translate(u(player.px) + dx, v(player.pz) + dy);
        g.scale(inv, inv);
        g.rotate(-r.h);
        g.beginPath();
        g.arc(0, 0, 4.5, 0, Math.PI * 2);
        g.fillStyle = r.color;
        g.fill();
        g.strokeStyle = 'rgba(12,16,24,0.95)';
        g.lineWidth = 1.5;
        g.stroke();
        g.beginPath();
        g.moveTo(0, -4.5);
        g.lineTo(0, -9);
        g.stroke(); // nose tick
        g.restore();
      }
    }
    // Harbor Contraband Run: white hull chevrons at the berths, a cyan bollard ring on Pier 1, cyan diamonds on the crate buoys, a gold anchor ring on the slip, flashing red/blue triangles for Harbor Patrol
    const bt = extras.boats;
    if (bt) {
      const at = (x, z, h, fn) => {
        g.save();
        g.translate(u(x), v(z));
        g.rotate(-h);
        g.scale(inv, inv);
        g.lineJoin = 'round';
        fn();
        g.restore();
      };
      const edge = (fill, outer = 5) => {
        g.strokeStyle = '#12151c';
        g.lineWidth = outer;
        g.stroke();
        g.strokeStyle = '#ffffff';
        g.lineWidth = outer - 3;
        g.stroke();
        g.fillStyle = fill;
        g.fill();
      };
      for (const m of bt.moored) {
        at(m.x, m.z, m.h, () => {
          g.beginPath();
          g.moveTo(0, -6);
          g.lineTo(3.8, 5);
          g.lineTo(0, 2.6);
          g.lineTo(-3.8, 5);
          g.closePath();
          edge('#ffffff', 4);
        });
      }
      if (bt.ring) {
        at(bt.ring.x, bt.ring.z, 0, () => {
          const pr = 1 + Math.sin(now * 4) * 0.12;
          g.scale(pr, pr);
          g.beginPath();
          g.arc(0, 0, 7, 0, Math.PI * 2);
          g.strokeStyle = '#12151c';
          g.lineWidth = 6;
          g.stroke();
          g.strokeStyle = '#5ee8ff';
          g.lineWidth = 3;
          g.stroke();
        });
      }
      for (const b of bt.buoys) {
        at(b.x, b.z, camYaw, () => {
          const pr = 1 + Math.sin(now * 6) * 0.14;
          g.scale(pr, pr);
          g.beginPath();
          g.moveTo(0, -8);
          g.lineTo(6, 0);
          g.lineTo(0, 8);
          g.lineTo(-6, 0);
          g.closePath();
          edge('#39d5ff', 5);
        });
      }
      if (bt.slip) {
        g.save();
        g.translate(u(bt.slip.x), v(bt.slip.z));
        g.strokeStyle = '#12151c';
        g.lineWidth = 6 * inv;
        g.beginPath();
        g.arc(0, 0, bt.slip.r * S, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = '#ffc21a';
        g.lineWidth = 3 * inv;
        g.setLineDash([8 * inv, 5 * inv]);
        g.stroke();
        g.setLineDash([]);
        g.rotate(-camYaw);
        g.scale(inv, inv);
        g.strokeStyle = '#ffc21a';
        g.lineWidth = 3;
        g.beginPath(); // anchor: shank, stock, flukes
        g.moveTo(0, -8);
        g.lineTo(0, 7);
        g.moveTo(-4, -4);
        g.lineTo(4, -4);
        g.moveTo(-7, 2);
        g.arc(0, 1, 7, Math.PI, 0, true);
        g.stroke();
        g.restore();
      }
      const blink = Math.floor(now * 6) % 2 === 0;
      for (const pb of bt.patrols) {
        at(pb.x, pb.z, pb.h, () => {
          g.beginPath();
          g.moveTo(0, -10);
          g.lineTo(7, 8);
          g.lineTo(-7, 8);
          g.closePath();
          edge(blink ? '#ff3b30' : '#3a78ff', 6);
        });
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

    // ambient event (Roadside Tuner): a pulsing light-blue wrench, pinned to the rim while it is beyond the radar radius
    const drawWrench = !extras.ambient ? null : () => {
      const dx = (u(extras.ambient.x) - u(player.px)) * zoom;
      const dy = (v(extras.ambient.z) - v(player.pz)) * zoom;
      const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
      let mx = dx * cs - dy * sn, my = dx * sn + dy * cs;
      const dist = Math.hypot(mx, my), lim = R - 20;
      if (dist > lim) {
        mx = (mx / dist) * lim;
        my = (my / dist) * lim;
      }
      if (extras.ambient.kind === 'hauler') {
        // Stunt Hauler: 12 px yellow ramp wedge with a magenta diamond and a white arrow pointing the way the truck drives (so you can line up behind it)
        const ax = extras.ambient.x, az = extras.ambient.z, fx = Math.sin(extras.ambient.h), fz = Math.cos(extras.ambient.h);
        const hx = u(ax + fx) - u(ax), hy = v(az + fz) - v(az);
        const ang = Math.atan2(hx * sn + hy * cs, hx * cs - hy * sn);
        g.save();
        g.translate(R + mx, R + my);
        g.rotate(ang);
        g.scale(1.3, 1.3);
        g.lineJoin = 'round';
        const wedge = () => {
          g.beginPath(); // low tail, tall nose: a ramp seen from above
          g.moveTo(-6, -5);
          g.lineTo(6, -2.2);
          g.lineTo(6, 2.2);
          g.lineTo(-6, 5);
          g.closePath();
        };
        wedge();
        g.strokeStyle = '#12151c';
        g.lineWidth = 4;
        g.stroke();
        wedge();
        g.fillStyle = '#ffcc00';
        g.fill();
        g.fillStyle = '#ff00aa';
        g.beginPath(); // magenta diamond
        g.moveTo(-3.4, 0);
        g.lineTo(-0.2, -2.8);
        g.lineTo(3, 0);
        g.lineTo(-0.2, 2.8);
        g.closePath();
        g.fill();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.4;
        g.beginPath(); // white direction arrow
        g.moveTo(-1.4, 0);
        g.lineTo(4.6, 0);
        g.moveTo(2.6, -2);
        g.lineTo(4.8, 0);
        g.lineTo(2.6, 2);
        g.stroke();
        g.restore();
        return;
      }
      g.save();
      g.translate(R + mx, R + my);
      g.globalAlpha = 0.8 + 0.2 * Math.sin(now * Math.PI * 4); // 0.6..1.0 at 2 Hz
      const sc = 1.55 + 0.08 * Math.sin(now * Math.PI * 4);
      g.scale(sc, sc);
      g.rotate(Math.PI / 4);
      g.lineCap = 'round';
      const wrench = (color, extra) => {
        g.strokeStyle = color;
        g.lineWidth = 6 + extra;
        g.beginPath(); // handle
        g.moveTo(0, -2);
        g.lineTo(0, 13);
        g.stroke();
        g.lineWidth = 5 + extra; // open C-jaw
        g.beginPath();
        g.arc(0, -8, 6.5, -Math.PI / 2 + 0.75, -Math.PI / 2 - 0.75 + Math.PI * 2);
        g.stroke();
      };
      wrench('#12151c', 5);
      wrench('#5ceeff', 0);
      g.restore();
    };

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
    if (extras.customs) this._customs(g, extras.customs, player, camYaw, zoom, now);
    if (drawWrench) drawWrench(); // on top of the player arrow so a tuner right next to us still shows
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
