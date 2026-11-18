// gpHud: the Sunset GP broadcast overlay, built from code (no index.html edits): rank badge, ahead / behind gap pills, round + gate + timer telemetry,
// the 3-2-1-GO banner, the return-to-car warning, the failed-race note and the podium / championship standings modal. hud.js calls update() once per frame.
const el = (tag, css, parent, html = '', id = '') => {
  const d = document.createElement(tag);
  if (id) d.id = id;
  d.style.cssText = css;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
};
const MONO = 'font-family:ui-monospace,Menlo,Consolas,monospace;';
const RANK = [['1ST', '#ffd84d'], ['2ND', '#dfe6ed'], ['3RD', '#e58e52'], ['4TH', '#ff4d6d']];
const fmtGap = (g) => `${g >= 0 ? '+' : '-'}${Math.abs(g).toFixed(2)}s`;
const fmtMs = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;

export class GpHud {
  constructor(root) {
    this.cache = {};
    this.badge = el('div', 'display:none;position:absolute;left:24px;top:22px;', root, '', 'gp-badge');
    this.rank = el('div', 'font-size:84px;font-weight:900;font-style:italic;line-height:0.95;transform:skewX(-10deg);text-shadow:0 4px 0 rgba(0,0,0,0.55),0 0 18px rgba(0,0,0,0.5);letter-spacing:-2px;', this.badge, '2ND');
    this.of = el('div', 'margin:-2px 0 6px 6px;font-size:20px;font-weight:800;font-style:italic;color:#e2e8f0;text-shadow:0 2px 3px rgba(0,0,0,0.7);', this.badge, '/ 4');
    this.pillA = el('div', 'display:none;margin-bottom:4px;padding:3px 12px;border-radius:12px;font-size:15px;font-weight:800;color:#e8faff;background:rgba(14,20,32,0.82);border-left:4px solid #00e5ff;white-space:nowrap;' + MONO, this.badge);
    this.pillB = el('div', 'display:none;padding:3px 12px;border-radius:12px;font-size:15px;font-weight:800;color:#e8faff;background:rgba(14,20,32,0.82);border-left:4px solid #ffd147;white-space:nowrap;' + MONO, this.badge);
    this.tele = el('div', 'display:none;position:absolute;right:26px;top:216px;padding:8px 14px;text-align:right;background:rgba(14,20,32,0.8);border-right:4px solid #ff2a85;border-radius:6px;' + MONO, root, '', 'gp-tele');
    this.round = el('div', 'font-size:14px;font-weight:900;letter-spacing:1px;color:#ff7ab4;', this.tele);
    this.gate = el('div', 'font-size:18px;font-weight:900;color:#ffffff;', this.tele);
    this.timer = el('div', 'font-size:30px;font-weight:900;color:#ffd84d;font-variant-numeric:tabular-nums;', this.tele);
    this.best = el('div', 'font-size:12px;color:#94a3b8;', this.tele);
    this.count = el('div', 'display:none;position:absolute;left:50%;top:24%;transform:translateX(-50%);font-size:150px;font-weight:900;font-style:italic;color:#ffffff;text-shadow:0 0 30px rgba(255,42,133,0.9),0 8px 0 rgba(0,0,0,0.5);', root, '', 'gp-count');
    this.warn = el('div', 'display:none;position:absolute;left:50%;top:16%;transform:translateX(-50%);padding:8px 22px;border-radius:6px;font-size:22px;font-weight:900;font-style:italic;letter-spacing:1px;color:#ffb703;background:rgba(40,16,10,0.86);border:2px solid #ff4d6d;white-space:nowrap;', root, '', 'gp-warn');
    this.note = el('div', 'display:none;position:absolute;left:50%;top:12%;transform:translateX(-50%);padding:8px 22px;border-radius:6px;font-size:20px;font-weight:900;letter-spacing:1px;color:#ff9aa8;background:rgba(40,12,20,0.86);border:2px solid #ff4d6d;white-space:nowrap;', root, '', 'gp-note');
    this.modal = el('div', `display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:560px;box-sizing:border-box;padding:18px 22px 14px;background:rgba(14,20,32,0.93);border:2px solid #ff2a85;border-radius:10px;box-shadow:0 0 40px rgba(255,42,133,0.35);${MONO}color:#e2e8f0;`, root, '', 'gp-modal');
    this.mTitle = el('div', 'font-size:22px;font-weight:900;font-style:italic;letter-spacing:1px;color:#ff7ab4;margin-bottom:10px;', this.modal);
    this.mRows = el('div', 'display:grid;gap:5px;', this.modal);
    this.mCash = el('div', 'margin-top:10px;font-size:20px;font-weight:900;color:#9be86b;', this.modal);
    this.mHint = el('div', 'margin-top:8px;font-size:13px;color:#94a3b8;letter-spacing:1px;', this.modal);
  }

  _show(node, on) {
    const d = on ? 'block' : 'none';
    if (node.style.display !== d) node.style.display = d;
  }

  _text(key, node, value) {
    if (this.cache[key] !== value) {
      this.cache[key] = value;
      node.textContent = value;
    }
  }

  update(world) {
    const gp = world.gp;
    const v = gp?.view;
    const live = !!v?.active && v.state !== 'SERIES_FINALE';
    if (v?.active) { // the race has its own tracker: hide the street-mission panel (this runs after customsHud, which resets the same property every frame)
      const m = document.getElementById('mission');
      if (m) m.style.visibility = 'hidden';
    }
    this._show(this.badge, live);
    this._show(this.tele, live);
    this._show(this.count, !!v?.active && v.count !== null && v.count !== undefined);
    const warn = v?.footLeft != null && v.footLeft > 0 ? `RETURN TO A VEHICLE: ${Math.max(0, v.footLeft).toFixed(1)}s` : v?.dnf != null && v.dnf < 15 ? `A RIVAL FINISHED — ${Math.ceil(v.dnf)}s TO FINISH` : '';
    this._text('warn', this.warn, warn);
    this._show(this.warn, !!warn);
    const note = v && !v.active && v.failed ? `SUNSET GP: ${v.failed} — BUY-IN LOST   REMATCH IN ${v.cooldown}s` : '';
    this._text('note', this.note, note);
    this._show(this.note, !!note);
    const mod = v?.modal;
    this._show(this.modal, !!mod);
    if (mod) this._modal(mod);
    if (!live) return;

    const [label, color] = RANK[Math.min(3, Math.max(0, v.place - 1))];
    this._text('rank', this.rank, label);
    if (this.cache.rankColor !== color) { this.cache.rankColor = color; this.rank.style.color = color; }
    this._text('of', this.of, `/ ${v.total}`);
    const s = v.split;
    this._pill(this.pillA, 'a', s.ahead && `AHEAD: #${s.ahead.num} ${s.ahead.short} ${fmtGap(s.ahead.gap)}`, s.ahead && s.ahead.color, s.ahead && s.ahead.gap > -0.75);
    this._pill(this.pillB, 'b', s.behind && `BEHIND: #${s.behind.num} ${s.behind.short} ${fmtGap(s.behind.gap)}`, s.behind && s.behind.color, s.behind && s.behind.gap < 0.75);
    this._text('round', this.round, `ROUND ${v.round}/3 — ${v.roundName}`);
    this._text('gate', this.gate, v.gateText);
    this._text('timer', this.timer, v.timer);
    this._text('best', this.best, v.best ? `BEST ${fmtMs(v.best)}` : '');
    if (v.count !== null && v.count !== undefined) this._text('count', this.count, v.count > 0 ? String(v.count) : 'GO!');
  }

  // A gap pill: coloured edge from the rival's livery, amber text while the gap is under 0.75 s.
  _pill(node, key, text, color, tight) {
    this._show(node, !!text);
    if (!text) return;
    this._text(key, node, text);
    node.style.borderLeftColor = color;
    node.style.color = tight ? '#ffd166' : '#e8faff';
  }

  _modal(m) {
    const sig = JSON.stringify(m);
    if (this.cache.modal === sig) return;
    this.cache.modal = sig;
    this.mTitle.textContent = m.title;
    this.mRows.innerHTML = '';
    for (const r of m.rows) {
      const row = el('div', `display:grid;grid-template-columns:34px 1fr 96px 90px;gap:8px;align-items:center;padding:4px 8px;border-radius:4px;font-size:16px;font-weight:800;${r.mine ? 'background:rgba(255,42,133,0.22);color:#fff;' : 'color:#cbd5e1;'}`, this.mRows);
      el('span', `color:${RANK[Math.min(3, r.place - 1)][1]};font-style:italic;font-weight:900;`, row, String(r.place));
      el('span', '', row, r.name);
      el('span', 'text-align:right;color:#94a3b8;', row, r.time);
      el('span', 'text-align:right;', row, r.add ? `${r.pts} <b style="color:#7ce639">+${r.add}</b>` : `${r.pts} pts`);
    }
    this.mCash.textContent = `${m.cashLabel} +$${m.cash.toLocaleString('en-US')}${m.record ? '   NEW BEST TIME' : ''}`;
    this.mHint.textContent = m.hint;
    this.mHint.style.color = m.unlock ? '#ffd84d' : '#94a3b8';
  }
}
