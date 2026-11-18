// wanted: heat -> stars (1-5), crime values, and the evade timer that lowers the level once the player has escaped the police.
export const STAR_HEAT = [0, 1, 3, 5.5, 8.5, 12]; // heat needed for N stars
export const CRIME = { stealParked: 1.0, carjack: 3.0, hitPed: 1.2, hitCar: 0.7, ramPolice: 1.6 };
const SEE_RANGE = 85; // police closer than this keep the search alive
export const EVADE_TIME = 7; // seconds out of sight per star lost

export class Wanted {
  // hooks: {onRaise(stars), onEscape(starsLost)}, fired when the level goes up and when it is shaken off entirely.
  constructor(notify, hooks = {}) {
    this.notify = notify;
    this.hooks = hooks;
    this.heat = 0;
    this.stars = 0;
    this.peak = 0; // highest level reached in this chase (sets the escape bonus)
    this.evade = 0; // seconds spent unseen at the current level
    this.cooldowns = {};
  }

  static starsFor(heat) {
    let n = 0;
    for (let k = 1; k < STAR_HEAT.length; k++) if (heat >= STAR_HEAT[k]) n = k;
    return n;
  }

  // Report a crime; per-kind cooldown stops one collision from counting every frame.
  commit(kind, amount = CRIME[kind], cooldown = 0.8) {
    if ((this.cooldowns[kind] ?? 0) > 0) return;
    this.cooldowns[kind] = cooldown;
    this.setHeat(Math.min(STAR_HEAT[5] + 2, this.heat + amount));
    this.evade = 0;
  }

  setHeat(h) {
    const before = this.stars;
    this.heat = h;
    this.stars = Wanted.starsFor(h);
    this.peak = Math.max(this.peak, this.stars);
    if (this.stars > before) {
      this.notify(`WANTED  ${'★'.repeat(this.stars)}`, 'warn');
      if (this.hooks.onRaise) this.hooks.onRaise(this.stars);
    }
  }

  clear() {
    this.peak = 0;
    this.heat = 0;
    this.stars = 0;
    this.evade = 0;
  }

  // nearestCop: distance to the closest police car (Infinity when none exist).
  update(dt, nearestCop) {
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    if (this.stars === 0) return;
    if (nearestCop < SEE_RANGE) {
      this.evade = Math.max(0, this.evade - dt * 2);
      return;
    }
    this.evade += dt;
    if (this.evade >= EVADE_TIME) {
      this.evade = 0;
      const n = this.stars - 1;
      this.heat = n === 0 ? 0 : STAR_HEAT[n];
      this.stars = n;
      if (n === 0) {
        const peak = this.peak;
        this.peak = 0;
        if (this.hooks.onEscape) this.hooks.onEscape(peak);
      } else {
        this.notify(`Heat is dropping  ${'★'.repeat(n)}`, 'warn');
      }
    }
  }

  get searching() {
    return this.stars > 0 && this.evade > 0.5;
  }
}
