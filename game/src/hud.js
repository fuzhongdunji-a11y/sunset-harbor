// hud: DOM overlay (speed, cash, wanted stars, mission panel, prompts, toasts). Only writes to the DOM when a value changes.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      cash: $('cash'), stars: [...document.querySelectorAll('#stars span')],
      mTitle: $('m-title'), mObj: $('m-obj'), mDist: $('m-dist'), mReward: $('m-reward'),
      speed: $('speed-val'), speedo: $('speedo'), carName: $('car-name'), district: $('district'),
      prompt: $('prompt'), toast: $('toast'), hints: $('hints'), speedBar: $('speed-bar'),
      banner: $('banner'), bust: $('bust'), bustBar: $('bust-bar'), hpBar: $('hp-bar'), mTime: $('m-time'),
    };
    this.cache = {};
    this.toastTimer = 0;
    this.toastQueue = [];
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
    this._set('cash', e.cash, `$${world.cash.toLocaleString('en-US')}`);
    const stars = world.wanted.stars;
    if (this.cache.stars !== stars) {
      this.cache.stars = stars;
      e.stars.forEach((s, i) => s.classList.toggle('on', i < stars));
      e.stars[0].parentElement.classList.toggle('hot', stars > 0);
    }
    const searching = world.wanted.searching;
    if (this.cache.search !== searching) {
      this.cache.search = searching;
      e.stars[0].parentElement.classList.toggle('search', searching);
    }
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
    this._set('mt', e.mTitle, m.title);
    this._set('mo', e.mObj, m.objective);
    this._set('md', e.mDist, `${Math.round(m.dist)} m`);
    const left = m.time === null ? null : Math.max(0, m.time);
    this._set('mti', e.mTime, left === null ? `Step ${m.step}` : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    e.mTime.classList.toggle('late', left !== null && left < 20);
    this._set('mr', e.mReward, `Reward $${m.reward}`);
    const inCar = p.inCar;
    if (this.cache.inCar !== inCar) {
      this.cache.inCar = inCar;
      e.speedo.classList.toggle('hidden', !inCar);
      e.hints.textContent = inCar
        ? 'W/S gas & brake   A/D steer   Space handbrake   F get out   Mouse look   Esc pause'
        : 'WASD move   Shift sprint   Space jump   F drive nearby car   Mouse look   Esc pause';
    }
    if (inCar) {
      const kmh = Math.round(p.vehicle.speedKmh);
      this._set('speed', e.speed, String(kmh));
      this._set('car', e.carName, p.vehicle.type.name);
      e.hpBar.style.width = `${Math.round(p.vehicle.health)}%`;
      e.speedBar.style.width = `${Math.min(100, (p.vehicle.speedKmh / (p.vehicle.type.maxSpeed * 3.6)) * 100).toFixed(0)}%`;
    }
    this._set('district', e.district, world.district);
    this._set('prompt', e.prompt, world.prompt);
    e.prompt.classList.toggle('hidden', !world.prompt);

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
