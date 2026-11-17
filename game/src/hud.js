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
    if (this.cache.stars !== world.wanted) {
      this.cache.stars = world.wanted;
      e.stars.forEach((s, i) => s.classList.toggle('on', i < world.wanted));
      e.stars[0].parentElement.classList.toggle('hot', world.wanted > 0);
    }
    const m = world.missions.active;
    if (m) {
      this._set('mt', e.mTitle, m.title);
      this._set('mo', e.mObj, m.objective);
      this._set('md', e.mDist, `${Math.round(world.missions.distanceTo(p.px, p.pz))} m`);
      this._set('mr', e.mReward, `Reward $${m.reward}`);
    } else {
      this._set('mt', e.mTitle, 'Free Roam');
      this._set('mo', e.mObj, 'Explore Costa Serena. More jobs soon.');
      this._set('md', e.mDist, '');
      this._set('mr', e.mReward, '');
    }
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
