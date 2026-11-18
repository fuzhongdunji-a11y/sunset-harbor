// AmbientAudio: the sound of ambient city events, synthesised on GameAudio's context. For the Roadside Tuner: a friendly double horn chirp inside 70 m,
// hazard relay clicks and a radiator hiss inside 50 m (fading with distance), and a rising arpeggio + clunk when the repair is done.
const HORN_RANGE = 70;
const CLOSE_RANGE = 50;
const HORN_EVERY = 9;

export class AmbientAudio {
  constructor(audio) {
    this.audio = audio;
    this.hornT = 0;
    this.lastLit = false;
    this.hiss = null; // {gain} once built
  }

  _buildHiss() {
    const a = this.audio, ctx = a.ctx;
    const src = a._noise(true);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 1.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(a.master);
    src.start();
    this.hiss = { gain: g };
  }

  // Dual triangle horn (440 + 554 Hz), two 90 ms bursts 70 ms apart.
  _horn(t, vol) {
    for (const start of [t, t + 0.16]) {
      this.audio._tone(440, start, 0.09, 'triangle', vol);
      this.audio._tone(554, start, 0.09, 'triangle', vol);
    }
  }

  // A relay tick: a 12 ms band-passed noise burst, alternating high and low.
  _click(t, high, vol) {
    const a = this.audio, ctx = a.ctx;
    const n = a._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = high ? 1900 : 1450;
    f.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    n.connect(f).connect(g).connect(a.master);
    n.start(t, Math.random() * 0.5, 0.03);
  }

  // Called every frame by GameAudio with the active ambient event (or null).
  update(dt, ev, t) {
    let hiss = 0; // target hiss level this frame
    const apply = () => this.hiss && this.hiss.gain.gain.setTargetAtTime(hiss, t, 0.08);
    if (!ev || ev.state !== 'idle' || !ev.dist) {
      apply();
      this.lastLit = false;
      if (ev && ev.state === 'idle') this.hornT = Math.max(0, this.hornT - dt);
      return;
    }
    const d = ev.dist;
    if (d < HORN_RANGE) {
      this.hornT -= dt;
      if (this.hornT <= 0) {
        this.hornT = HORN_EVERY;
        this._horn(t, 0.06 * (1 - (d / HORN_RANGE) * 0.6));
      }
    } else {
      this.hornT = 0;
    }
    if (d < CLOSE_RANGE) {
      const near = 1 - d / CLOSE_RANGE;
      if (ev.hazardLit !== this.lastLit) {
        this._click(t, ev.hazardLit, 0.5 * near);
        this.lastLit = ev.hazardLit;
      }
      if (!this.hiss) this._buildHiss();
      hiss = 0.06 * near * (0.7 + 0.3 * Math.sin(t * Math.PI * 2 * 0.8)); // slow 0.8 Hz swell
    }
    apply();
  }

  // One-shot cues, sent through world.emit().
  event(type) {
    const a = this.audio, t = a.ctx.currentTime;
    if (type === 'ambRepair') {
      [523, 659, 784].forEach((f, i) => {
        a._tone(f, t + i * 0.1, 0.22, 'square', 0.05);
        a._tone(f, t + i * 0.1, 0.22, 'sine', 0.08);
      });
      a._tone(110, t, 0.2, 'sine', 0.3, 55); // latch clunk as the hood shuts
    } else if (type === 'ambSteal') {
      a._tone(700, t, 0.1, 'square', 0.05); // owner's phone: dial blips
      a._tone(880, t + 0.14, 0.1, 'square', 0.05);
      a._tone(700, t + 0.28, 0.1, 'square', 0.05);
    }
  }
}
