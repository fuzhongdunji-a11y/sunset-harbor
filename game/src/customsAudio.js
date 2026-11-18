// customsAudio: WebAudio synthesis for Solaris Customs on GameAudio's context: pneumatic shutter, airbrush respray hiss + chime, impact-wrench install,
// nitrous burn loop + wastegate flutter, export cash-out arpeggio and the refusal buzzer. No sample files.

export class CustomsAudio {
  constructor(ga) {
    this.ga = ga;
    this.n2o = null; // nitrous loop nodes, built on first use
    this.prevBoost = false;
    this.burnT = 0;
  }

  event(type) {
    if (!this.ga.ctx) return;
    if (type === 'custShutterClose') this.playShutterSound(false);
    else if (type === 'custShutterOpen') this.playShutterSound(true);
    else if (type === 'custSpray') this.playSpraySound();
    else if (type === 'custWrench') this.playWrenchSound();
    else if (type === 'custExport') this.playExportJingle();
    else if (type === 'custBuzz') this.ga._tone(180, this.ga.ctx.currentTime, 0.28, 'sawtooth', 0.09, 110);
    else if (type === 'custTick') this.ga._tone(1200, this.ga.ctx.currentTime, 0.04, 'square', 0.04);
    else if (type === 'custChime') this.ga._jingle([1046.5, 1568], 0.14, 'triangle', 0.12);
  }

  // saw 92 -> 68 Hz closing (68 -> 104 opening) through a 260 Hz low-pass over 0.55 s, then a 0.09 s high-passed air-brake puff
  playShutterSound(opening) {
    const ga = this.ga, ctx = ga.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(opening ? 68 : 92, t);
    o.frequency.linearRampToValueAtTime(opening ? 104 : 68, t + 0.55);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.58);
    o.connect(lp).connect(g).connect(ga.master);
    o.start(t);
    o.stop(t + 0.6);
    this._noiseBurst(t + 0.55, 0.09, 'highpass', 1800, 0.1);
  }

  _noiseBurst(when, dur, type, freq, vol, q = 1) {
    const ga = this.ga, ctx = ga.ctx;
    const n = ga._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    n.connect(f).connect(g).connect(ga.master);
    n.start(when, Math.random() * 0.5, dur + 0.02);
  }

  // noise through a band-pass sweeping 1400 -> 3200 -> 1600 Hz (Q 2.4) over 2.2 s, then the two-note "Fresh Coat" chime (C6, G6)
  playSpraySound() {
    const ga = this.ga, ctx = ga.ctx, t = ctx.currentTime;
    const n = ga._noise(true);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.4;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.linearRampToValueAtTime(3200, t + 1.1);
    f.frequency.linearRampToValueAtTime(1600, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.2);
    g.gain.linearRampToValueAtTime(0.12, t + 2.0);
    g.gain.linearRampToValueAtTime(0, t + 2.2);
    n.connect(f).connect(g).connect(ga.master);
    n.start(t);
    n.stop(t + 2.25);
    ga._tone(1046.5, t + 2.3, 0.14, 'triangle', 0.12);
    ga._tone(1568.0, t + 2.44, 0.14, 'triangle', 0.12);
  }

  // four ratchet bursts 0.065 s apart: square 210 -> 120 Hz plus 2.4 kHz band-passed noise
  playWrenchSound() {
    const ga = this.ga, t = ga.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      ga._tone(210, t + i * 0.065, 0.045, 'square', 0.15, 120);
      this._noiseBurst(t + i * 0.065, 0.045, 'bandpass', 2400, 0.15, 4);
    }
  }

  // rising E5 G#5 B5 E6 arpeggio, triangle plus a sine octave, 80 ms step
  playExportJingle() {
    const ga = this.ga, t = ga.ctx.currentTime;
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => {
      ga._tone(f, t + i * 0.08, 0.3, 'triangle', 0.15);
      ga._tone(f * 2, t + i * 0.08, 0.2, 'sine', 0.06);
    });
  }

  _buildNitrous() {
    const ga = this.ga, ctx = ga.ctx;
    const n = ga._noise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.8;
    bp.frequency.value = 950;
    const ng = ctx.createGain();
    ng.gain.value = 0;
    n.connect(bp).connect(ng).connect(ga.master);
    n.start();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 110;
    const og = ctx.createGain();
    og.gain.value = 0;
    o.connect(og).connect(ga.master);
    o.start();
    this.n2o = { bp, ng, o, og };
  }

  // looped burn roar while boosting (noise band 950 -> 1650 Hz, saw 110 -> 175 Hz); a 3-sweep flutter chirp on release after >= 0.4 s of burn
  update(dt, world, t) {
    const v = world.player.vehicle, c = v?.custom;
    const on = !!c && c.isBoosting && !world.fx;
    if (on && !this.n2o) this._buildNitrous();
    if (this.n2o) {
      const n = this.n2o;
      this.burnT = on ? this.burnT + dt : this.burnT;
      const k = Math.min(1, this.burnT / 1.5);
      n.bp.frequency.setTargetAtTime(950 + 700 * k, t, 0.1);
      n.o.frequency.setTargetAtTime(110 + 65 * k, t, 0.1);
      n.ng.gain.setTargetAtTime(on ? 0.13 : 0, t, 0.04);
      n.og.gain.setTargetAtTime(on ? 0.08 : 0, t, 0.04);
    }
    if (this.prevBoost && !on) {
      if (this.burnT >= 0.4) for (let i = 0; i < 3; i++) this.ga._tone(2600, t + i * 0.06, 0.05, 'sine', 0.09, 1500);
      this.burnT = 0;
    }
    this.prevBoost = on;
  }
}
