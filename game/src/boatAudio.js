// boatAudio: WebAudio synthesis for the Harbor Contraband Run, built on GameAudio's context: twin outboard engine, wave slam, sonar crate chirp, Harbor Patrol hailer horn, trim-boost whoosh.
// The engine graph is created lazily on the first frame the player is in a boat.

export class BoatAudio {
  constructor(ga) {
    this.ga = ga;
    this.built = false;
    this.thr = 0; // smoothed throttle feel
  }

  _build() {
    const ga = this.ga, ctx = ga.ctx;
    this.built = true;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 420;
    // two detuned sawtooth outboards
    this.a = ctx.createOscillator();
    this.a.type = 'sawtooth';
    this.a.frequency.value = 58;
    this.b = ctx.createOscillator();
    this.b.type = 'sawtooth';
    this.b.frequency.value = 61.5;
    this.a.connect(this.lp);
    this.b.connect(this.lp);
    this.lp.connect(this.gain).connect(ga.master);
    this.a.start();
    this.b.start();
    // constant hull water-rush: band-passed white noise
    this.rush = ctx.createGain();
    this.rush.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 1.4;
    const n = ga._noise();
    n.connect(bp).connect(this.rush).connect(ga.master);
    n.start();
  }

  update(dt, world, t) {
    const ga = this.ga;
    const v = world.player.vehicle;
    const boat = v?.isBoat && !world.fx ? v : null;
    if (!this.built) {
      if (!boat) return;
      this._build();
    }
    if (!boat) {
      this.gain.gain.setTargetAtTime(0, t, 0.2);
      this.rush.gain.setTargetAtTime(0, t, 0.2);
      return;
    }
    const sp = Math.abs(boat.speedF);
    const ratio = Math.min(1.25, sp / 34);
    const throttle = boat.sinking ? 0 : Math.max(0, boat.input.throttle);
    this.thr += (Math.max(throttle, ratio * 0.5) - this.thr) * Math.min(1, 4 * dt);
    const f = 58 + (185 - 58) * Math.min(1, ratio * 0.85 + throttle * 0.15);
    this.a.frequency.setTargetAtTime(f, t, 0.06);
    this.b.frequency.setTargetAtTime(f * (61.5 / 58), t, 0.06);
    this.lp.frequency.setTargetAtTime(420 + (1900 - 420) * Math.min(1, this.thr), t, 0.08);
    this.gain.gain.setTargetAtTime(boat.sinking ? 0.03 : 0.1 + 0.07 * this.thr, t, 0.1);
    this.rush.gain.setTargetAtTime(Math.min(0.12, ratio * 0.1) * (boat.boostT > 0 ? 1.6 : 1), t, 0.1);
    void ga;
  }

  event(type) {
    const ga = this.ga, ctx = ga.ctx;
    const t = ctx.currentTime;
    if (type === 'boatSlam') {
      ga._tone(130, t, 0.09, 'sine', 0.5, 38); // 90 ms pitch-swept thud
      const n = ga._noise(false);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      n.connect(f).connect(g).connect(ga.master);
      n.start(t, Math.random() * 0.5, 0.08);
    } else if (type === 'cratePing') {
      // sonar double-chirp 880 -> 1320 Hz, each 70 ms, with a soft echo
      for (let i = 0; i < 2; i++) {
        ga._tone(880, t + i * 0.1, 0.07, 'triangle', 0.16, 1320);
        ga._tone(880, t + i * 0.1 + 0.18, 0.07, 'triangle', 0.05, 1320);
      }
    } else if (type === 'patrolHorn') {
      // dual-tone maritime hailer, 220 ms
      ga._tone(310, t, 0.22, 'square', 0.07);
      ga._tone(370, t, 0.22, 'square', 0.07);
    } else if (type === 'boatBoost') {
      const n = ga._noise(false);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      n.connect(f).connect(g).connect(ga.master);
      n.start(t, Math.random() * 0.3, 0.75);
    } else if (type === 'cbdStart') {
      ga._jingle([440, 587, 740], 0.09, 'triangle', 0.1);
    }
  }
}
