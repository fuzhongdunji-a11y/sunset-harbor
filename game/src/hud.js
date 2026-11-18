// hud: DOM overlay (speed, cash, wanted stars, mission panel, prompts, toasts). Only writes to the DOM when a value changes.
import { EVADE_TIME } from './wanted.js';
import { CREST_TOTAL, QUOTA, GROUP_NAME, MILESTONES, nextMilestone } from './crests.js';

const $ = (id) => document.getElementById(id);
const HINT_DIM_AFTER = 14; // seconds of play before the control hints fade back

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      cash: $('cash'), stars: [...document.querySelectorAll('#stars span')],
      mTitle: $('m-title'), mObj: $('m-obj'), mDist: $('m-dist'), mReward: $('m-reward'),
      speed: $('speed-val'), speedo: $('speedo'), carName: $('car-name'), district: $('district'),
      prompt: $('prompt'), toast: $('toast'), hints: $('hints'), speedBar: $('speed-bar'),
      banner: $('banner'), bust: $('bust'), bustBar: $('bust-bar'), hpBar: $('hp-bar'), mTime: $('m-time'),
      mission: $('mission'), edge: $('edge'), speedfx: $('speedfx'), drift: $('drift'),
      cashDelta: $('cash-delta'), evade: $('evade'), evadeBar: $('evade-bar'), evadeTxt: $('evade-txt'),
      promptKey: $('prompt-key'), promptText: $('prompt-text'),
      icpt: $('icpt'), icptUp: $('icpt-up'), icptSus: $('icpt-sus'), icptUpPct: $('icpt-up-pct'), icptSusPct: $('icpt-sus-pct'), icptDist: $('icpt-dist'),
      crestN: $('crest-n'), crestToast: $('crest-toast'), ctTitle: $('ct-title'), ctTally: $('ct-tally'), ctFill: $('ct-fill'), ctNext: $('ct-next'),
      pauseCrests: $('pause-crests'),
    };
    this.crestTimer = 0;
    this.cache = {};
    this.toastTimer = 0;
    this.toastQueue = [];
    this.playTime = 0;
    this.deltaTimer = 0;
    this.driftHold = 0;
  }

  // Restart a one-shot CSS animation class.
  _retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  _cash(world) {
    const e = this.el;
    const cash = world.cash;
    if (this.cache.cashRaw !== undefined && cash !== this.cache.cashRaw) {
      const d = cash - this.cache.cashRaw;
      if (Math.abs(d) >= 10) {
        this.cashDelta = (this.deltaTimer > 0 ? this.cashDelta : 0) + d;
        this.deltaTimer = 2;
        e.cashDelta.textContent = `${this.cashDelta >= 0 ? '+' : '-'}$${Math.abs(this.cashDelta).toLocaleString('en-US')}`;
        e.cashDelta.className = `show ${this.cashDelta >= 0 ? 'gain' : 'loss'}`;
        this._retrigger(e.cash, 'bump');
      }
    }
    this.cache.cashRaw = cash;
    this._set('cash', e.cash, `$${cash.toLocaleString('en-US')}`);
  }

  // Wanted block: star pop on a new level, evade meter while searching, red/blue screen edge that grows with the heat and the nearest cruiser.
  _wanted(world) {
    const e = this.el;
    const w = world.wanted;
    const stars = w.stars;
    if (this.cache.stars !== stars) {
      if (stars > (this.cache.stars ?? 0)) for (let i = this.cache.stars ?? 0; i < stars; i++) this._retrigger(e.stars[i], 'pop');
      this.cache.stars = stars;
      e.stars.forEach((s, i) => s.classList.toggle('on', i < stars));
      e.stars[0].parentElement.classList.toggle('hot', stars > 0);
      e.evade.classList.toggle('hidden', stars === 0);
    }
    const searching = w.searching;
    if (this.cache.search !== searching) {
      this.cache.search = searching;
      e.stars[0].parentElement.classList.toggle('search', searching);
      e.evade.classList.toggle('chased', !searching);
      this._set('evTxt', e.evadeTxt, searching ? 'EVADING...' : 'POLICE ON YOU');
    }
    if (stars > 0 && searching) e.evadeBar.style.width = `${Math.round(Math.min(1, w.evade / (EVADE_TIME * w.evadeScale)) * 100)}%`;

    let edge = 0;
    if (stars > 0 && !world.fx) {
      const near = Math.max(0, Math.min(1, (90 - world.police.nearest) / 70)); // cruiser close behind = stronger
      edge = searching ? 0.12 : 0.15 + stars * 0.07 + near * 0.35;
    }
    const q = Math.round(edge * 20) / 20;
    if (this.cache.edge !== q) {
      this.cache.edge = q;
      e.edge.style.opacity = String(q);
    }
  }

  // Signal Intercept: DATA UPLOAD over SUSPICION, plus the live distance to the target with its zone tag.
  _intercept(world) {
    const e = this.el;
    const v = world.intercept.view;
    e.icpt.classList.toggle('hidden', !v.active);
    if (!v.active) return;
    const up = Math.round(v.upload), sus = Math.round(v.susp);
    e.icptUp.style.width = `${v.upload.toFixed(1)}%`;
    e.icptSus.style.width = `${v.susp.toFixed(1)}%`;
    this._set('iup', e.icptUpPct, `${up}%`);
    this._set('isus', e.icptSusPct, `${sus}%`);
    let tag = v.zone;
    if (v.zone === 'SIGNAL LOSS' && !v.breaking) tag = `SIGNAL LOSS ${Math.ceil(v.lostLeft)}s`;
    if (v.breaking) tag = v.dist > 80 ? 'CLEAN BREAK' : 'BREAK AWAY';
    this._set('idist', e.icptDist, `${Math.round(v.dist)} m [${tag}]`);
    const cls = v.breaking ? '' : v.zone === 'TOO CLOSE' ? 'near' : v.zone === 'SIGNAL LOSS' ? 'far' : '';
    if (this.cache.icls !== cls) {
      this.cache.icls = cls;
      e.icptDist.className = cls;
    }
  }

  // Sun-Crests: running counter, the 4 s pickup card (count, district tally, bar to the next milestone) and the pause-screen total.
  _crests(world, dt) {
    const e = this.el;
    const c = world.crests;
    const n = c.count;
    if (this.cache.crestCount !== n) {
      this.cache.crestCount = n;
      const ty = c.tally();
      e.crestN.textContent = `${n} / ${CREST_TOTAL}`;
      e.pauseCrests.textContent = `Sun-Crests ${n} / ${CREST_TOTAL}  ·  City ${ty.city}/${QUOTA.city}  Beach ${ty.beach}/${QUOTA.beach}  Harbor ${ty.harbor}/${QUOTA.harbor}`;
    }
    const t = world.crestToast;
    if (t) {
      world.crestToast = null;
      this.crestTimer = t.t;
      const nm = nextMilestone(t.n);
      const prev = [...MILESTONES].reverse().find((m) => m.at <= t.n)?.at ?? 0;
      e.ctTitle.textContent = `SUN-CRESTS ${t.n} / ${CREST_TOTAL}`;
      e.ctTally.textContent = `${GROUP_NAME.city} ${t.tally.city}/${QUOTA.city}  ·  ${GROUP_NAME.beach} ${t.tally.beach}/${QUOTA.beach}  ·  ${GROUP_NAME.harbor} ${t.tally.harbor}/${QUOTA.harbor}`;
      e.ctFill.style.width = `${nm ? Math.round(((t.n - prev) / (nm.at - prev)) * 100) : 100}%`;
      if (t.milestone) {
        e.ctNext.className = 'hit';
        e.ctNext.textContent = `MILESTONE ${t.milestone.at}!  +$${t.milestone.cash.toLocaleString('en-US')}  ${t.milestone.perk}`;
      } else {
        e.ctNext.className = '';
        e.ctNext.textContent = nm ? `+$250   ·   next ${nm.at}: +$${nm.cash.toLocaleString('en-US')}` : '+$250';
      }
      this._retrigger(e.crestToast, 'show');
      e.crestToast.classList.remove('hidden');
    }
    if (this.crestTimer > 0) {
      this.crestTimer -= dt;
      if (this.crestTimer <= 0) e.crestToast.classList.add('hidden');
    }
  }

  show(visible) {
    this.root.classList.toggle('hidden', !visible);
  }

  _set(key, el, value) {
    if (this.cache[key] !== value) {
      this.cache[key] = value;
      el.textContent = value;
    }
  }

  update(dt, world) {
    const p = world.player;
    const e = this.el;
    this._cash(world);
    this.deltaTimer -= dt;
    if (this.deltaTimer <= 0 && e.cashDelta.classList.contains('show')) e.cashDelta.classList.remove('show');
    this._wanted(world);
    this._intercept(world);
    this._crests(world, dt);
    this.playTime += dt;
    e.hints.classList.toggle('dim', this.playTime > HINT_DIM_AFTER);
    const bust = world.police.bustProgress;
    e.bust.classList.toggle('hidden', bust <= 0.01);
    if (bust > 0.01) e.bustBar.style.width = `${Math.round(bust * 100)}%`;
    const fx = world.fx ? world.fx.kind : '';
    if (this.cache.fx !== fx) {
      this.cache.fx = fx;
      e.banner.className = fx ? `banner-${fx}` : 'hidden';
      e.banner.textContent = fx.toUpperCase();
    }
    const m = world.missions.view;
    if (this.cache.mt !== undefined && (this.cache.mt !== m.title || this.cache.mo !== m.objective)) this._retrigger(e.mission, 'flash');
    this._set('mt', e.mTitle, m.title);
    this._set('mo', e.mObj, m.objective);
    this._set('md', e.mDist, `${Math.round(m.dist)} m`);
    const left = m.time === null ? null : Math.max(0, m.time);
    this._set('mti', e.mTime, left === null ? `Step ${m.step}` : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    e.mTime.classList.toggle('late', left !== null && left < 20);
    this._set('mr', e.mReward, `Reward ${m.rewardText ?? `$${m.reward}`}`);
    const inCar = p.inCar;
    if (this.cache.inCar !== inCar) {
      this.cache.inCar = inCar;
      e.speedo.classList.toggle('hidden', !inCar);
      e.hints.textContent = inCar
        ? 'W/S gas & brake   A/D steer   Space handbrake   F get out   M sound   Esc pause'
        : 'WASD move   Shift sprint   Space jump   F drive nearby car   M sound   Esc pause';
    }
    if (inCar) {
      const kmh = Math.round(p.vehicle.speedKmh);
      this._set('speed', e.speed, String(kmh));
      this._set('car', e.carName, p.vehicle.type.name);
      e.hpBar.style.width = `${Math.round(p.vehicle.health)}%`;
      const ratio = Math.min(1, p.vehicle.speedKmh / (p.vehicle.type.maxSpeed * 3.6));
      e.speedBar.style.width = `${(ratio * 100).toFixed(0)}%`;
      e.speedBar.classList.toggle('redline', ratio > 0.92);
      // DRIFT tag: held briefly so it does not flicker while the slide fades
      const v = p.vehicle;
      this.driftHold = v.slip > 3.2 && Math.abs(v.speedF) > 8 ? 0.35 : Math.max(0, this.driftHold - dt);
      e.drift.classList.toggle('hidden', this.driftHold <= 0);
      // speed lines only in the last stretch of top speed
      const fx = Math.max(0, Math.min(0.55, (ratio - 0.72) * 2.2));
      const q = Math.round(fx * 20) / 20;
      if (this.cache.sfx !== q) {
        this.cache.sfx = q;
        e.speedfx.style.opacity = String(q);
      }
    }
    if (!inCar && this.cache.sfx) {
      this.cache.sfx = 0;
      e.speedfx.style.opacity = '0';
    }
    this._set('district', e.district, world.district);
    if (this.cache.prompt !== world.prompt) {
      this.cache.prompt = world.prompt;
      const m2 = /^\[(\w+)\]\s*(.*)$/.exec(world.prompt);
      e.promptKey.textContent = m2 ? m2[1] : '';
      e.promptText.textContent = m2 ? m2[2] : world.prompt;
      e.prompt.classList.toggle('hidden', !world.prompt);
    }

    for (const msg of world.messages) this.toastQueue.push(msg);
    world.messages.length = 0;
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) {
      const next = this.toastQueue.shift();
      if (next) {
        e.toast.textContent = next.text;
        e.toast.className = `toast-${next.kind} show`;
        this.toastTimer = next.kind === 'mission' ? 3.2 : 2.2;
      } else {
        e.toast.classList.remove('show');
      }
    }
  }
}
