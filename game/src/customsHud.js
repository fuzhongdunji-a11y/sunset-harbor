// customsHud: DOM overlay for Solaris Customs, built from code (no index.html edits): the in-bay #customs-panel, the nitrous gauge #n2o-hud with the tuning chip,
// the Export Match pill, the live gate warning, the CLEARED banner and the projected Export Slate label. hud.js calls update() once per frame.
import * as THREE from '../vendor/three.module.min.js';
import * as C from './customsCatalog.js';

const el = (tag, css, parent, html = '', id = '') => {
  const d = document.createElement(tag);
  if (id) d.id = id;
  d.style.cssText = css;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
};
const fmt = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const MONO = "font-family:ui-monospace,Menlo,Consolas,monospace;";

export class CustomsHud {
  constructor(root) {
    this.root = root;
    this.v = new THREE.Vector3();
    this.cache = {};
    this.panel = el('div', `display:none;position:absolute;left:28px;top:108px;width:356px;box-sizing:border-box;padding:12px 14px 10px;background:rgba(14,20,32,0.88);border-left:2px solid #00e5c3;border-radius:8px;text-transform:uppercase;font-weight:700;${MONO}color:#e2e8f0;`, root, '', 'customs-panel');
    this.head = el('div', 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;', this.panel);
    this.title = el('span', 'color:#ff5e5b;font-size:16px;font-weight:900;letter-spacing:1px;', this.head, 'SOLARIS CUSTOMS // BAY 01');
    this.cash = el('span', 'color:#7ce639;font-size:16px;', this.head);
    this.badge = el('div', 'font-size:12px;letter-spacing:1px;margin-bottom:8px;', this.panel);
    this.rows = [];
    for (let i = 0; i < 6; i++) {
      const r = el('div', 'height:32px;line-height:32px;display:flex;align-items:center;gap:8px;padding:0 8px;border-radius:4px;font-size:12px;white-space:nowrap;overflow:hidden;', this.panel);
      this.rows.push({
        r, arrow: el('span', 'width:10px;color:#00e5c3;', r), name: el('span', 'width:122px;color:#94a3b8;', r), chip: el('i', 'width:12px;height:12px;border-radius:50%;border:1px solid rgba(255,255,255,0.5);flex:none;', r),
        value: el('span', 'flex:1;overflow:hidden;text-overflow:ellipsis;', r), tag: el('span', 'text-align:right;', r),
      });
    }
    this.stats = el('div', 'margin-top:8px;display:grid;gap:5px;', this.panel);
    this.bars = ['TOP SPEED', 'ACCEL / N2O', 'ARMOR'].map((label) => {
      const row = el('div', 'display:grid;grid-template-columns:96px 1fr 98px;gap:6px;align-items:center;font-size:11px;', this.stats);
      el('span', 'color:#94a3b8;', row, label);
      const track = el('div', 'position:relative;height:8px;background:#1b2536;border-radius:2px;overflow:hidden;', row);
      const base = el('div', 'position:absolute;left:0;top:0;height:100%;width:0;background:#e2e8f0;', track);
      const delta = el('div', 'position:absolute;top:0;height:100%;width:0;background:#00e5c3;', track);
      const num = el('span', 'text-align:right;color:#e2e8f0;', row);
      return { base, delta, num };
    });
    this.foot = el('div', 'margin-top:9px;font-size:11px;color:#94a3b8;letter-spacing:0;', this.panel, '[W/S] CATEGORY [A/D] OPTION [E] BUY/APPLY [R] QUICK RESPRAY [Q] EXIT');

    this.n2o = el('div', 'display:none;position:absolute;right:34px;bottom:210px;width:190px;text-align:right;', root, '', 'n2o-hud');
    this.n2oLabel = el('div', `font-size:11px;letter-spacing:2px;color:#94a3b8;${MONO}margin-bottom:2px;`, this.n2o, 'N2O [SHIFT]');
    const cap = (this.cap = el('div', 'margin-left:auto;width:148px;height:12px;background:#111827;transform:skewX(-14deg);border:1px solid rgba(255,255,255,0.35);overflow:hidden;', this.n2o));
    this.n2oFill = el('div', 'height:100%;width:100%;background:linear-gradient(90deg,#00b4d8,#00f5d4);', cap);
    this.chip = el('div', `margin-top:5px;display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:800;letter-spacing:1px;color:#00f5d4;background:rgba(14,20,32,0.82);border:1px solid #00e5c3;${MONO}`, this.n2o);

    this.match = el('div', 'display:none;position:absolute;left:22px;top:150px;max-width:420px;padding:3px 10px;border-radius:11px;font-size:12px;font-weight:800;letter-spacing:0.5px;color:#ffd166;background:rgba(15,23,42,0.86);', root);
    this.matchToast = el('div', 'display:none;position:absolute;left:50%;top:74px;transform:translateX(-50%);padding:8px 20px;border-radius:6px;font-size:18px;font-weight:900;letter-spacing:1px;color:#ffd166;background:rgba(15,23,42,0.88);border:2px solid #ffd166;white-space:nowrap;', root);
    this.warn = el('div', 'display:none;position:absolute;left:50%;top:18%;transform:translateX(-50%);padding:8px 22px;border-radius:6px;font-size:22px;font-weight:900;font-style:italic;letter-spacing:2px;color:#ffb703;background:rgba(40,16,10,0.84);border:2px solid #ff5e5b;white-space:nowrap;', root);
    this.banner = el('div', 'display:none;position:absolute;left:50%;top:5%;transform:translateX(-50%);padding:8px 22px;border-radius:8px;font-size:24px;font-weight:900;font-style:italic;letter-spacing:3px;color:#00f5d4;background:linear-gradient(90deg,rgba(12,16,24,0.9),rgba(10,50,48,0.9));border:2px solid #00e5c3;box-shadow:0 0 22px rgba(0,229,195,0.5);white-space:nowrap;', root);
    this.slate = el('div', 'display:none;position:absolute;transform:translate(-50%,-100%);padding:3px 10px;border-radius:4px;font-size:12px;font-weight:900;letter-spacing:1px;color:#ffd166;background:rgba(15,23,42,0.82);border-bottom:2px solid #00e5c3;white-space:nowrap;pointer-events:none;', root);
  }

  update(world, hudRoot) {
    const cu = world.customs, p = world.player, v = p.vehicle;
    // in-bay panel (hides the mission box and the minimap so nothing overlaps)
    const open = cu.panelOpen;
    this.panel.style.display = open ? 'block' : 'none';
    for (const id of ['mission', 'minimap-wrap']) { const n = document.getElementById(id); if (n) n.style.visibility = open ? 'hidden' : ''; }
    if (open) this._panel(cu);
    // nitrous gauge + tuning chip
    const c = v?.custom, hasN = !!c && c.n2o > 0 && !v.isBoat, tuning = cu.tuningLabel(v);
    this.n2o.style.display = hasN || (tuning && !v?.isBoat) ? 'block' : 'none';
    this.n2oLabel.style.display = hasN ? 'block' : 'none';
    this.cap.style.display = hasN ? 'block' : 'none';
    if (hasN) {
      const ch = c.n2oCharge;
      this.n2oFill.style.width = `${Math.round(ch * 100)}%`;
      this.n2oFill.style.background = ch >= 0.995 ? '#ffffff' : ch < 0.2 ? '#ffb703' : 'linear-gradient(90deg,#00b4d8,#00f5d4)';
      this.n2oLabel.textContent = `N2O [SHIFT] ${Math.round(ch * 100)}%`;
    }
    this.chip.style.display = tuning ? 'inline-block' : 'none';
    if (tuning) this.chip.textContent = tuning;
    // export match pill / toast
    const m = cu.match;
    this.match.style.display = m ? 'block' : 'none';
    if (m) {
      const t = cu.activeType;
      const txt = `★ SOLARIS EXPORT MATCH: ${C.EXPORT_NAMES[t]} — DELIVER TO SOLARIS CUSTOMS (${fmt(C.BASE_VALUE[t])}+)`;
      this.match.textContent = txt;
      this.matchToast.textContent = txt;
    }
    this.matchToast.style.display = m && cu.matchT > 0 ? 'block' : 'none';
    // warnings and banner
    this.warn.style.display = cu.warn ? 'block' : 'none';
    if (cu.warn) this.warn.textContent = cu.warn.text;
    this.banner.style.display = cu.banner ? 'block' : 'none';
    if (cu.banner) this.banner.textContent = cu.banner.text;
    // slate label projected over the board
    const cam = world.camera;
    this.v.set(...slatePoint(cu)).project(cam);
    const dist = Math.hypot(cam.position.x - cu.L.ax, cam.position.z - cu.L.az);
    const vis = this.v.z < 1 && dist < 70 && !open && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
    this.slate.style.display = vis ? 'block' : 'none';
    if (vis) {
      this.slate.style.left = `${(this.v.x * 0.5 + 0.5) * hudRoot.clientWidth}px`;
      this.slate.style.top = `${(-this.v.y * 0.5 + 0.5) * hudRoot.clientHeight}px`;
      const label = cu.slateLabel;
      if (this.cache.slate !== label) { this.cache.slate = label; this.slate.textContent = label; }
    }
  }

  _panel(cu) {
    const m = cu.menuView();
    this.cash.textContent = fmt(m.cash);
    if (m.stars > 0) {
      const cost = m.cd > 0 ? `HEAT-WIPE CD ${Math.ceil(m.cd)}s` : `CLEAR FOR ${m.hotCost === 0 ? 'FREE' : fmt(m.hotCost)}`;
      this.badge.textContent = `${m.stars}★ HOT — ${cost}`;
      this.badge.style.color = '#ff4757';
    } else {
      this.badge.textContent = '0★ CLEAN';
      this.badge.style.color = '#00e5c3';
    }
    m.rows.forEach((r, i) => {
      const d = this.rows[i];
      d.r.style.background = r.active ? 'rgba(0,229,195,0.22)' : 'transparent';
      d.arrow.textContent = r.active ? '▸' : '';
      d.name.textContent = r.name;
      d.value.textContent = r.value;
      d.value.style.color = r.active ? '#ffffff' : '#cbd5e1';
      d.chip.style.display = r.swatch !== null ? 'block' : 'none';
      if (r.swatch !== null) d.chip.style.background = `#${r.swatch.toString(16).padStart(6, '0')}`;
      d.tag.textContent = r.tag;
      d.tag.style.color = r.kind === 'owned' ? '#00e5c3' : r.kind === 'locked' ? '#ff6b81' : '#ffd166';
    });
    const topMax = m.topMax * 1.0;
    const [b0, b1, b2] = this.bars;
    b0.base.style.width = `${(m.topNow / topMax) * 100}%`;
    b0.delta.style.left = `${(m.topNow / topMax) * 100}%`;
    b0.delta.style.width = `${(Math.max(0, m.topPrev - m.topNow) / topMax) * 100}%`;
    b0.num.textContent = `${m.topPrev} KM/H`;
    b1.base.style.width = `${Math.min(100, m.accel * 3 + (m.n2o === 'NONE' ? 0 : 35))}%`;
    b1.num.textContent = `+${m.accel}% / ${m.n2o}`;
    b2.base.style.width = m.armor === 'STOCK' ? '10%' : m.armor.includes('0.60') ? '90%' : '55%';
    b2.num.textContent = m.armor;
    this.foot.textContent = m.spraying ? 'SPRAYING...' : '[W/S] CATEGORY [A/D] OPTION [E] BUY/APPLY [R] QUICK RESPRAY [Q] EXIT';
  }
}

function slatePoint(cu) {
  const L = cu.L, x = -5.9, z = -1.7, y = 4.2;
  return [L.ax + x * L.lx + z * L.fx, cu.y + y, L.az + x * L.lz + z * L.fz];
}
