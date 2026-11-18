// AmbientAudio: the sound of ambient city events, synthesised on GameAudio's context. For the Roadside Tuner: a friendly double horn chirp inside 70 m,
// hazard relay clicks and a radiator hiss inside 50 m (fading with distance), and a rising arpeggio + clunk when the repair is done.
// For the Sky-Ad Stunt Hauler: the Costa Cola synth-pop jingle inside 100 m (cut dead by the smash), the glass smash + sub-bass drop, and the payout chord.
const HORN_RANGE = 70;
const CLOSE_RANGE = 50;
const HORN_EVERY = 9;
// Costa Cola jingle (Stunt Hauler): 128 BPM, 8th-note steps, four bars of eight; semitones F#4 A#4 C#5 F#5 D#5 as frequencies, 0 = rest
const STEP = 60 / 128 / 2;
const JINGLE_RANGE = 100;
const [F4, A4, C5, D5, F5] = [369.99, 466.16, 554.37, 622.25, 739.99];
const JINGLE_MELODY = [
  [F4, A4, C5, F5, D5, C5, A4, 0],
  [F4, A4, C5, F5, D5, C5, A4, C5],
  [A4, C5, D5, F5, D5, C5, A4, 0],
  [F4, A4, C5, F5, D5, C5, F5, 0],
];

export class AmbientAudio {
  constructor(audio) {
    this.audio = audio;
    this.hornT = 0;
    this.lastLit = false;
    this.hiss = null; // {gain} once built
    this.jingle = null; // {in, gain} once the Stunt Hauler first comes in range
    this.jingleNext = 0;
    this.jingleStep = 0;
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

  // Costa Cola jingle bus: every note goes through a 2600 Hz low-pass, like a rooftop PA speaker.
  _buildJingleBus() {
    const a = this.audio, ctx = a.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.value = 0;
    lp.connect(g).connect(a.master);
    this.jingle = { in: lp, gain: g };
  }

  _note(freq, when, dur, type, vol) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(this.jingle.in);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  // One 8th-note step of the 4-bar, 128 BPM loop (32 steps = 7.5 s): square lead with a bell overtone over an octave-bouncing bass.
  _jingleStep(step, when) {
    const m = JINGLE_MELODY[step >> 3][step & 7];
    if (m) {
      this._note(m, when, STEP * 1.7, 'square', 0.16);
      this._note(m * 3.5, when, STEP * 0.8, 'sine', 0.09); // FM-bell-like overtone
    }
    this._note(step & 1 ? 185 : 92.5, when, STEP * 0.9, 'triangle', 0.3); // F#3 / F#2
  }

  // Schedule the jingle a quarter second ahead while the cube is up and the player is within 100 m; fade it out at once otherwise (the smash cuts it dead).
  _jingleUpdate(ev, t) {
    const on = !!ev?.jingleOn;
    if (!this.jingle) {
      if (!on) return;
      this._buildJingleBus();
    }
    const vol = on ? 0.55 * (1 - ev.dist / JINGLE_RANGE) ** 2 : 0;
    this.jingle.gain.gain.setTargetAtTime(vol, t, on ? 0.12 : 0.012);
    if (!on) {
      this.jingleNext = 0;
      return;
    }
    if (this.jingleNext < t - 0.1) this.jingleNext = t + 0.05;
    while (this.jingleNext < t + 0.25) {
      this._jingleStep(this.jingleStep, this.jingleNext);
      this.jingleStep = (this.jingleStep + 1) & 31;
      this.jingleNext += STEP;
    }
  }

  // Called every frame by GameAudio with the active ambient event (or null).
  update(dt, ev, t) {
    this._jingleUpdate(ev?.kind === 'hauler' ? ev : null, t);
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
    } else if (type === 'ambLaunch') {
      a._tone(260, t, 0.35, 'sawtooth', 0.05, 900); // the lip boost: a rising whoosh
    } else if (type === 'ambShatter') {
      // crystalline FM glass: bright detuned pings and a hiss of noise, over a sub-bass drop (90 -> 32 Hz in 0.9 s)
      [2093, 2637, 3136, 3951, 1568].forEach((f, i) => {
        a._tone(f, t + i * 0.012, 0.28, 'square', 0.025);
        a._tone(f * 1.5, t + i * 0.012, 0.18, 'sine', 0.05);
      });
      const n = a._noise(false), hp = a.ctx.createBiquadFilter(), g = a.ctx.createGain();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      n.connect(hp).connect(g).connect(a.master);
      n.start(t, Math.random() * 0.4, 0.5);
      a._tone(90, t, 0.9, 'sine', 0.55, 32);
    } else if (type === 'ambStunt') {
      [370, 466, 554, 698, 831].forEach((f) => { // F# major 9, arcade-style
        a._tone(f, t + 0.3, 1.0, 'square', 0.035);
        a._tone(f, t + 0.3, 1.0, 'sine', 0.07);
      });
    } else if (type === 'ambAir') {
      a._tone(660, t, 0.1, 'triangle', 0.08);
      a._tone(990, t + 0.09, 0.16, 'triangle', 0.08);
    } else if (type === 'ambLocked') {
      a._tone(120, t, 0.14, 'sawtooth', 0.12);
      a._tone(120, t + 0.2, 0.14, 'sawtooth', 0.12);
    }
  }
}
