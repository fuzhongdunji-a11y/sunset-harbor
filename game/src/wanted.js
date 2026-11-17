// wanted: heat -> stars (1-5), crime values, and the evade timer that lowers the level once the player has escaped the police.
export const STAR_HEAT = [0, 1, 3, 5.5, 8.5, 12]; // heat needed for N stars
export const CRIME = { stealParked: 1.0, carjack: 3.0, hitPed: 1.2, hitCar: 0.7, ramPolice: 1.6 };
const SEE_RANGE = 85; // police closer than this keep the search alive
const EVADE_TIME = 7; // seconds out of sight per star lost

export class Wanted {
  constructor(notify) {
    this.notify = notify;
    this.heat = 0;
    this.stars = 0;
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
    if (this.stars > before) this.notify(`WANTED  ${'★'.repeat(this.stars)}`, 'warn');
  }

  clear() {
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
      this.notify(n === 0 ? 'WANTED LEVEL LOST' : `Heat is dropping  ${'★'.repeat(n)}`, n === 0 ? 'info' : 'warn');
    }
  }

  get searching() {
    return this.stars > 0 && this.evade > 0.5;
  }
}
