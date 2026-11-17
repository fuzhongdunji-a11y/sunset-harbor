// audio: WebAudio synthesis only (no sample files). Engine, police siren, collisions, jingles, door and ambience (waves, birds), plus mute.
// The AudioContext is created by start(), which the title screen calls from the player's click / key press (browser autoplay rules).
const MUTE_KEY = 'sunsetHarbor.mute';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage blocked: stay unmuted */
    }
    this.birdT = 4;
    this.lastImpactT = 0;
    this.gear = 0;
    this.sirenPhase = 0;
  }

  get ready() {
    return !!this.ctx;
  }

  // Build the persistent graph: master, engine, siren, waves. Safe to call more than once.
  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // one second of white noise, looped by every noise source
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._buildEngine();
    this._buildSiren();
    this._buildWaves();
  }

  _noise(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  _buildEngine() {
    const ctx = this.ctx;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.engFilter = lp;
    this.engOscA = ctx.createOscillator();
    this.engOscA.type = 'sawtooth';
    this.engOscB = ctx.createOscillator();
    this.engOscB.type = 'square';
    const mixB = ctx.createGain();
    mixB.gain.value = 0.35;
    this.engOscA.connect(lp);
    this.engOscB.connect(mixB).connect(lp);
    lp.connect(this.engGain).connect(this.master);
    this.engOscA.start();
    this.engOscB.start();
    // tyre / wind roar scales with speed
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const n = this._noise();
    n.connect(bp).connect(this.roarGain).connect(this.master);
    n.start();
  }

  _buildSiren() {
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    const sq = ctx.createOscillator();
    sq.type = 'square';
    sq.frequency.value = 700;
    this.sirenSq = sq;
    const sqGain = ctx.createGain();
    sqGain.gain.value = 0.25;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.sirenOsc.connect(this.sirenGain);
    sq.connect(sqGain).connect(this.sirenGain);
    if (this.sirenPan) this.sirenGain.connect(this.sirenPan).connect(this.master);
    else this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    sq.start();
  }

  _buildWaves() {
    const ctx = this.ctx;
    this.waveGain = ctx.createGain();
    this.waveGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const n = this._noise();
    n.connect(lp).connect(this.waveGain).connect(this.master);
    n.start();
    // slow swell: an LFO riding on the wave gain
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(this.waveGain.gain);
    lfo.start();
    this.waveDepth = depth;
    // city bed: low murmur everywhere
    this.cityGain = ctx.createGain();
    this.cityGain.gain.value = 0.015;
    const cb = ctx.createBiquadFilter();
    cb.type = 'lowpass';
    cb.frequency.value = 220;
    const n2 = this._noise();
    n2.connect(cb).connect(this.cityGain).connect(this.master);
    n2.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.04);
    return this.muted;
  }

  setPaused(paused) {
    if (!this.ctx) return;
    if (paused) this.ctx.suspend();
    else this.ctx.resume();
  }

  // Called every playing frame.
  update(dt, world) {
    const events = world.events.splice(0);
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const p = world.player;
    const v = p.vehicle;

    // engine: speed -> rpm with a few gears so it climbs and drops
    if (v && !world.fx) {
      const sp = Math.abs(v.speedF);
      const top = v.type.maxSpeed;
      const gears = 5;
      const ratio = Math.min(1, sp / top);
      const g = Math.min(gears - 1, Math.floor(ratio * gears));
      const inGear = ratio * gears - g;
      const rpm = 0.18 + inGear * 0.7 + (v.input.throttle > 0 ? 0.1 : 0);
      this.gear += (g - this.gear) * Math.min(1, 12 * dt);
      const base = 38 + rpm * 70 + this.gear * 6;
      this.engOscA.frequency.setTargetAtTime(base, t, 0.05);
      this.engOscB.frequency.setTargetAtTime(base * 0.5, t, 0.05);
      this.engFilter.frequency.setTargetAtTime(280 + rpm * 900, t, 0.08);
      const load = v.input.throttle > 0 ? 1 : 0.55;
      this.engGain.gain.setTargetAtTime(0.1 + 0.1 * load, t, 0.1);
      this.roarGain.gain.setTargetAtTime(Math.min(0.1, ratio * 0.1) * (v.input.hand ? 1.6 : 1), t, 0.1);
    } else {
      this.engGain.gain.setTargetAtTime(0, t, 0.15);
      this.roarGain.gain.setTargetAtTime(0, t, 0.15);
    }

    // collisions
    if (v && v.impact > 2.5 && t - this.lastImpactT > 0.18) {
      this.lastImpactT = t;
      this._crash(Math.min(1, v.impact / 14));
    }

    // siren of the nearest chasing cruiser
    let near = null, nd = Infinity;
    for (const c of world.police.cops) {
      if (!c.chasing) continue;
      const d = Math.hypot(c.v.x - p.px, c.v.z - p.pz);
      if (d < nd) {
        nd = d;
        near = c.v;
      }
    }
    if (near && nd < 220) {
      this.sirenPhase += dt * 0.55;
      const wail = 0.5 - 0.5 * Math.cos(this.sirenPhase * Math.PI * 2);
      const f = 640 + wail * 520;
      this.sirenOsc.frequency.setTargetAtTime(f, t, 0.03);
      this.sirenSq.frequency.setTargetAtTime(f, t, 0.03);
      const vol = Math.pow(Math.max(0, 1 - nd / 220), 1.6) * 0.16;
      this.sirenGain.gain.setTargetAtTime(vol, t, 0.12);
      if (this.sirenPan) {
        const yaw = world.rig.yaw;
        const rx = -Math.cos(yaw), rz = Math.sin(yaw);
        const pan = ((near.x - p.px) * rx + (near.z - p.pz) * rz) / Math.max(nd, 8);
        this.sirenPan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, pan)), t, 0.1);
      }
    } else {
      this.sirenGain.gain.setTargetAtTime(0, t, 0.2);
    }

    // ambience: waves louder near the shore (z > 250), birds in the day
    const shore = Math.min(1, Math.max(0, (p.pz - 120) / 220));
    this.waveGain.gain.setTargetAtTime(0.035 + shore * 0.1, t, 0.4);
    this.waveDepth.gain.setTargetAtTime(0.02 + shore * 0.06, t, 0.4);
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 3 + Math.random() * 7;
      this._bird(0.5 + (1 - shore) * 0.2);
    }

    for (const e of events) this._event(e);
  }

  _event(type) {
    if (type === 'mission') this._jingle([523, 659, 784, 1047], 0.11, 'triangle', 0.16);
    else if (type === 'busted') this._busted();
    else if (type === 'wasted') this._wasted();
    else if (type === 'hitPed') this._thump(0.9);
    else if (type === 'door') this._door();
    else if (type === 'carjack') {
      this._crash(0.35);
      this._door();
    }
  }

  // Short filtered noise burst with a low body tone.
  _crash(strength) {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200 * (0.4 + strength), t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * (0.3 + strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5, 0.45);
    this._thump(0.4 + strength * 0.6);
  }

  _thump(amount) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * amount, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  _door() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5, 0.12);
    this._tone(110, t + 0.02, 0.12, 'square', 0.1);
  }

  _tone(freq, when, dur, type, vol, slideTo = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(this.master);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  _jingle(notes, step, type, vol) {
    const t = this.ctx.currentTime;
    notes.forEach((f, i) => this._tone(f, t + i * step, step * 2.2, type, vol));
    this._tone(notes[notes.length - 1] * 0.5, t + notes.length * step, 0.6, 'sine', vol * 0.8);
  }

  _busted() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this._tone(880, t + i * 0.22, 0.16, 'square', 0.12);
      this._tone(660, t + i * 0.22 + 0.11, 0.1, 'square', 0.1);
    }
    this._tone(330, t + 0.7, 0.9, 'sawtooth', 0.12, 120);
  }

  _wasted() {
    const t = this.ctx.currentTime;
    this._tone(220, t, 1.8, 'sawtooth', 0.16, 45);
    this._tone(110, t, 2.0, 'sine', 0.22, 30);
    this._crash(1);
  }

  // A two-note chirp with a fast downward slide.
  _bird(vol) {
    const t = this.ctx.currentTime;
    const base = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this._tone(base, t + i * 0.13, 0.09, 'sine', 0.03 * vol, base * 0.7);
  }
}
