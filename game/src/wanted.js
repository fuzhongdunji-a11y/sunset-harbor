// wanted: heat -> stars (1-5), crime values, and the evade timer that lowers the level once the player has escaped the police.
export const STAR_HEAT = [0, 1, 3, 5.5, 8.5, 12]; // heat needed for N stars
export const CRIME = { stealParked: 1.0, carjack: 3.0, hitPed: 1.2, hitCar: 0.7, ramPolice: 1.6 };
// Sun-Crest milestone perks that touch the wanted system (the rest live in crests.js)
export const MILESTONE_EVADE_SCALE = 0.8;
const SEE_RANGE = 85; // police closer than this keep the search alive
const AIR_PING_TTL = 2.5; // seconds an Air-1 position broadcast stays valid (it is re-sent every 1.0 s while locked)
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
    this.heatScale = 1; // <1 during Signal Intercept: scrapes with traffic add less heat
    this.evadeScale = 1; // 0.8 once Sun-Crest milestone 30 is reached: stars wear off 20% sooner
    this.vouch = 0; // banked Police Vouch (0 or 1, saved): forgives the next star the moment it is earned
    this.vouchTimer = 0; // seconds until a pending redemption fires (a short beat so the star flash registers)
    this.airFreeze = false; // Air-1 has a visual lock: stars cannot wear off
    this.airDecayBoost = 1; // 1.25 while Air-1 searches and no cruiser sees the player
    this.airTarget = null; // {x, z, age}: last position Air-1 radioed to the cruisers; dropped after AIR_PING_TTL seconds without a new ping
    this.airPings = 0;
    this.onZero = null; // set by airpursuit.js: fired whenever the level reaches 0 stars, with the peak of the chase
    this._nearest = Infinity;
  }

  // Air-1 LOCKED: pause the evade timer so the level cannot drop while the spotlight holds the player.
  setAirLockFreeze(on) {
    this.airFreeze = !!on;
    if (on) this.evade = 0;
  }

  // Air-1 SEARCHING timed out: one star off. A single star stays if a cruiser still has eyes on the player.
  applyAirSearchDrop() {
    if (this.stars <= 0) return;
    let n = this.stars - 1;
    if (n === 0 && this._nearest < SEE_RANGE) n = 1;
    this.evade = 0;
    if (n === this.stars) return;
    this.heat = n === 0 ? 0 : STAR_HEAT[n];
    this.stars = n;
    if (n === 0) this._reachedZero();
    else this.notify(`Air-1 gave up  ${'★'.repeat(n)}`, 'warn');
  }

  // Air-1 radios the exact player position to every cruiser (they are on the player's tail already; this keeps the ground search from timing out).
  broadcastAirTarget(pos) {
    this.airTarget = { x: pos.x, z: pos.z, age: 0 };
    this.airPings++;
    this.evade = 0;
  }

  // The level just hit 0. `escape` = the player shook the police off (pays the LOST THEM bonus); vouchers, repairs and respawns pass false.
  _reachedZero(escape = true) {
    const peak = this.peak;
    this.peak = 0;
    this.evade = 0;
    if (escape && this.hooks.onEscape) this.hooks.onEscape(peak);
    if (this.onZero) this.onZero(peak);
  }

  // Roadside repair reward. At 1+ stars it clears the level now ('cleared'); otherwise it banks one vouch ('banked', or 'full' when one is already banked).
  grantVouch() {
    if (this.stars >= 1) {
      this.clear();
      return 'cleared';
    }
    if (this.vouch >= 1) return 'full';
    this.vouch = 1;
    return 'banked';
  }

  // Spend the banked vouch: one star is forgiven (a jump from 0 to 2+ stars keeps all but one).
  _redeemVouch() {
    if (this.vouch < 1 || this.stars < 1) return;
    this.vouch = 0;
    const n = this.stars - 1;
    this.heat = n === 0 ? 0 : STAR_HEAT[n];
    this.stars = n;
    this.evade = 0;
    if (n === 0) this.peak = 0;
    if (this.hooks.onVouch) this.hooks.onVouch(n);
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
    this.setHeat(Math.min(STAR_HEAT[5] + 2, this.heat + amount * this.heatScale));
    this.evade = 0;
  }

  // Raise the level to at least `n` stars (a higher level stays as it is) and restart the evade timer.
  raiseTo(n) {
    this.evade = 0;
    if (this.stars < n) this.setHeat(STAR_HEAT[n]);
  }

  // Drop the level by exactly one star (the Contraband Drop's smuggler decoy signal) and restart the evade timer.
  dropStar() {
    if (this.stars <= 0) return;
    const n = this.stars - 1;
    this.heat = n === 0 ? 0 : STAR_HEAT[n];
    this.stars = n;
    this.evade = 0;
    if (n === 0) this._reachedZero(false);
  }

  setHeat(h) {
    const before = this.stars;
    this.heat = h;
    this.stars = Wanted.starsFor(h);
    this.peak = Math.max(this.peak, this.stars);
    if (before === 0 && this.stars > 0 && this.vouch > 0 && this.vouchTimer <= 0) this.vouchTimer = 0.6;
    if (this.stars > before) {
      this.notify(`WANTED  ${'★'.repeat(this.stars)}`, 'warn');
      if (this.hooks.onRaise) this.hooks.onRaise(this.stars);
    }
  }

  clear() {
    const had = this.stars > 0;
    this.heat = 0;
    this.stars = 0;
    this.vouchTimer = 0;
    if (had) this._reachedZero(false); // roadside repair vouchers land here; respawns after an arrest do too (the air layer checks world.fx and pays nothing)
    this.peak = 0;
    this.evade = 0;
  }

  // nearestCop: distance to the closest police car (Infinity when none exist).
  update(dt, nearestCop) {
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    if (this.vouchTimer > 0) {
      this.vouchTimer -= dt;
      if (this.vouchTimer <= 0) this._redeemVouch();
    }
    this._nearest = nearestCop;
    if (this.airTarget && (this.airTarget.age += dt) > AIR_PING_TTL) this.airTarget = null; // Air-1 pings every 1.0 s while locked; a stale fix means the lock is gone
    if (this.stars === 0) return;
    if (this.airFreeze) {
      this.evade = 0; // visual lock: no decay at all
      return;
    }
    if (nearestCop < SEE_RANGE) {
      this.evade = Math.max(0, this.evade - dt * 2);
      return;
    }
    this.evade += dt * this.airDecayBoost;
    if (this.evade >= EVADE_TIME * this.evadeScale) {
      this.evade = 0;
      const n = this.stars - 1;
      this.heat = n === 0 ? 0 : STAR_HEAT[n];
      this.stars = n;
      if (n === 0) {
        this._reachedZero();
      } else {
        this.notify(`Heat is dropping  ${'★'.repeat(n)}`, 'warn');
      }
    }
  }

  get searching() {
    return this.stars > 0 && this.evade > 0.5;
  }
}
