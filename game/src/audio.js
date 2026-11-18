// audio: WebAudio synthesis only (no sample files). Engine, police siren, collisions, jingles, door and ambience (waves, birds), plus mute.
// The AudioContext is created by start(), which the title screen calls from the player's click / key press (browser autoplay rules).
import { AmbientAudio } from './ambient/AmbientAudio.js';
import { BoatAudio } from './boatAudio.js';
import { CustomsAudio } from './customsAudio.js';

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
    this.blipT = 0; // Signal Intercept upload blips
    this.buzzT = 0; // suspicion buzzer / signal-loss beeps
    this.ambient = new AmbientAudio(this); // ambient city events (Roadside Tuner)
    this.boat = new BoatAudio(this); // outboards, wave slam, sonar chirp, patrol hailer
    this.customs = new CustomsAudio(this); // Solaris Customs shutter, spray, wrench, nitrous, export jingle
  }

  playShutterSound(opening) { this.customs.playShutterSound(opening); }
  playSpraySound() { this.customs.playSpraySound(); }
  playWrenchSound() { this.customs.playWrenchSound(); }
  playExportJingle() { this.customs.playExportJingle(); }
  playNitrousSound(active) { if (active) this.customs._buildNitrous?.call(this.customs); }

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
    this._buildRotor();
  }

  // Costa Air-1 rotor: looped noise through a low-pass (cutoff Doppler-shifted), chopped by a 12.5 Hz saw LFO for the blade slap, plus a 62.5 Hz triangle sub-thump.
  // The whole bus sits at exactly 0 gain while Air-1 is not flying.
  _buildRotor() {
    const ctx = this.ctx;
    this.rotorGain = ctx.createGain();
    this.rotorGain.gain.value = 0;
    this.rotorLp = ctx.createBiquadFilter();
    this.rotorLp.type = 'lowpass';
    this.rotorLp.frequency.value = 280;
    const amp = ctx.createGain();
    amp.gain.value = 0.55;
    const n = this._noise();
    n.connect(this.rotorLp).connect(amp).connect(this.rotorGain);
    n.start();
    this.rotorLfo = ctx.createOscillator();
    this.rotorLfo.type = 'sawtooth';
    this.rotorLfo.frequency.value = 12.5;
    this.rotorLfoDepth = ctx.createGain();
    this.rotorLfoDepth.gain.value = 0;
    this.rotorLfo.connect(this.rotorLfoDepth).connect(amp.gain);
    this.rotorLfo.start();
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = 62.5;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.7;
    sub.connect(subGain).connect(this.rotorGain);
    sub.start();
    this.rotorGain.connect(this.master);
    this.rotorOff = true;
    this.rotorLevel = 0; // the gain the bus is heading for (read by the checks)
  }

  // dist: metres to Air-1, closing: m/s it approaches (negative = receding), active: false hard-gates to 0.
  updateRotorAudio(dist, closing, active) {
    if (!this.ctx || !this.rotorGain) return;
    const t = this.ctx.currentTime;
    const g = this.rotorGain.gain;
    if (!active) {
      this.rotorLevel = 0;
      if (!this.rotorOff) {
        this.rotorOff = true;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(0, t + 0.1);
        g.setValueAtTime(0, t + 0.11); // pin it at exactly 0.000 so no tail of the setTarget curve lingers
        this.rotorLfoDepth.gain.cancelScheduledValues(t);
        this.rotorLfoDepth.gain.setValueAtTime(this.rotorLfoDepth.gain.value, t);
        this.rotorLfoDepth.gain.linearRampToValueAtTime(0, t + 0.1);
      }
      return;
    }
    if (this.rotorOff) {
      this.rotorOff = false;
      g.cancelScheduledValues(t);
      this.rotorLfoDepth.gain.cancelScheduledValues(t);
    }
    this.rotorLevel = 0.22 / (1 + dist / 45);
    g.setTargetAtTime(this.rotorLevel, t, 0.12);
    this.rotorLfoDepth.gain.setTargetAtTime(0.45, t, 0.12);
    const shift = Number.isFinite(closing) ? Math.max(-90, Math.min(140, closing * 3.2)) : 0; // Doppler: +140 Hz closing at 44 m/s, -90 Hz receding
    this.rotorLp.frequency.setTargetAtTime(280 + shift, t, 0.1);
  }

  // PA squelch (80 ms band-passed noise) then two 90 ms square tones, 1046 -> 1397 Hz.
  playAirLockChirp() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1650;
    f.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5, 0.09);
    this._tone(1046, t + 0.09, 0.09, 'square', 0.06);
    this._tone(1397, t + 0.19, 0.09, 'square', 0.06);
  }

  // Pod release: a 220 ms sine whistle falling 1800 -> 520 Hz.
  playSpikeDrop() {
    if (this.ctx) this._tone(1800, this.ctx.currentTime, 0.22, 'sine', 0.1, 520);
  }

  // Tyre blow-out: 140 ms 3200 Hz band-passed noise burst and a 45 ms 95 Hz thud.
  playTirePuncture() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5, 0.16);
    this._tone(95, t, 0.045, 'sine', 0.35);
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

    // engine: speed -> rpm with a few gears so it climbs and drops (boats have their own outboard synth)
    if (v && !v.isBoat && !world.fx) {
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

    this._intercept(dt, world.intercept, t);
    this._alarm(dt, world.armored, p, t);
    this.ambient.update(dt, world.ambient.active, t);
    this.boat.update(dt, world, t);
    this.customs.update(dt, world, t);
    this._gp(dt, world);
    const air = world.air;
    this.updateRotorAudio(air ? air.audio.dist : 999, air ? air.audio.closing : 0, !!air && air.active && !world.fx);
    for (const e of events) this._event(e);
  }

  // Armored truck security alarm: 620 / 460 Hz swapping every 0.25 s once the truck is running, fading out over 60 m.
  _alarm(dt, am, p, t) {
    if (!am.active || !am.fleeing || am.armor <= 0 || !am.truck) return;
    const d = Math.hypot(am.truck.x - p.px, am.truck.z - p.pz);
    if (d >= 60) return;
    this.alarmT = (this.alarmT ?? 0) - dt;
    if (this.alarmT > 0) return;
    this.alarmT = 0.25;
    this.alarmHi = !this.alarmHi;
    this._tone(this.alarmHi ? 620 : 460, t, 0.24, 'square', 0.075 * Math.pow(1 - d / 60, 1.3));
  }

  // Heavy armored-plate hit: a 90 -> 38 Hz sine drop under a hard metallic crash.
  _heavyHit() {
    const ctx = this.ctx, t = ctx.currentTime;
    this._tone(90, t, 0.18, 'sine', 0.5, 38);
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2600;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5, 0.36);
    this._tone(1180, t, 0.16, 'square', 0.045);
    this._tone(1730, t + 0.02, 0.12, 'square', 0.035);
  }

  // Rear door latch (sharp tick) then a bright two-note chime, 880 -> 1320 Hz.
  _caseDrop() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5, 0.08);
    this._tone(180, t, 0.07, 'square', 0.12);
    this._tone(880, t + 0.12, 0.2, 'sine', 0.13);
    this._tone(1320, t + 0.26, 0.32, 'sine', 0.13);
  }

  // A heavy "chink" and a rising C6 - E6 - G6 - C7 arpeggio, 50 ms per note.
  _casePick() {
    const t = this.ctx.currentTime;
    this._tone(2400, t, 0.1, 'triangle', 0.1, 1500);
    this._tone(300, t, 0.1, 'sine', 0.14, 160);
    [1047, 1319, 1568, 2093].forEach((f, i) => this._tone(f, t + 0.04 + i * 0.05, 0.2, 'sine', 0.1));
  }

  // Signal Intercept feedback: data blips that climb in pitch with the upload, a buzzer that speeds up with suspicion, double beeps when the link is dropping.
  _intercept(dt, ic, t) {
    if (!ic.active) return;
    const v = ic.view;
    this.blipT -= dt;
    this.buzzT -= dt;
    if (v.zone === 'OPTIMAL' && !v.breaking && this.blipT <= 0) {
      this.blipT = 0.5;
      this._tone(660 + v.upload * 6, t, 0.07, 'sine', 0.05);
      this._tone(990 + v.upload * 8, t + 0.09, 0.06, 'sine', 0.035);
    } else if (v.zone === 'TOO CLOSE' && this.buzzT <= 0) {
      this.buzzT = Math.max(0.1, 0.45 - v.susp / 260);
      this._tone(170 + v.susp * 1.4, t, 0.09, 'square', 0.04 + v.susp * 0.0009);
    } else if (v.zone === 'SIGNAL LOSS' && !v.breaking && this.buzzT <= 0) {
      this.buzzT = 1;
      this._tone(520, t, 0.08, 'triangle', 0.07);
      this._tone(390, t + 0.13, 0.1, 'triangle', 0.07);
    }
  }

  // Several notes at once, long and soft.
  _chord(notes, dur, vol) {
    const t = this.ctx.currentTime;
    for (const f of notes) this._tone(f, t, dur, 'sine', vol);
  }

  // ---- Sunset GP (all synthesis; sunsetGP.js queues cues in gp.cues and publishes gp.audioView) -------------------------------------------------------------
  // Countdown beeps: 3-2-1 are a 440 Hz triangle+square blip with a 120 ms decay; GO! is an 880 + 1320 Hz fifth burst of 380 ms.
  playRaceCountdown(step) {
    const t = this.ctx.currentTime;
    if (step > 0) {
      this._tone(440, t, 0.12, 'triangle', 0.16);
      this._tone(440, t, 0.12, 'square', 0.05);
    } else {
      this._tone(880, t, 0.38, 'triangle', 0.16);
      this._tone(1320, t, 0.38, 'square', 0.07);
    }
  }

  // Two-note FM-ish chime D5 -> A5 in 75 ms; over the last three gates each gate sits one semitone higher (streak 1..3).
  playGateClear(streak = 0) {
    const t = this.ctx.currentTime, k = 2 ** (streak / 12);
    this._tone(587.3 * k, t, 0.075, 'sine', 0.14);
    this._tone(880 * k, t + 0.04, 0.075, 'sine', 0.12);
    this._tone(1174.6 * k, t + 0.04, 0.05, 'triangle', 0.04);
  }

  // Gaining a place: bright major-third (659 -> 830 Hz); losing one: a muted minor-second thud (196 -> 185 Hz).
  playPositionChange(gained) {
    const t = this.ctx.currentTime;
    if (gained) {
      this._tone(659, t, 0.14, 'triangle', 0.14);
      this._tone(830, t + 0.1, 0.22, 'triangle', 0.14);
    } else {
      this._tone(196, t, 0.2, 'sine', 0.2, 185);
      this._tone(98, t, 0.22, 'sine', 0.12);
    }
  }

  // Crowd swell (band-passed noise, 2.2 s) under a four-voice brass fanfare: C5-E5-G5-C6 on a win, a minor cadence otherwise.
  playCheckeredFanfare(place) {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 1.0);
    bp.frequency.exponentialRampToValueAtTime(900, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 2.3);
    const notes = place === 1 ? [523.3, 659.3, 784, 1046.5] : [440, 523.3, 659.3, 440];
    notes.forEach((f, i) => {
      this._tone(f, t + 0.15 + i * 0.16, 0.5, 'sawtooth', 0.07);
      this._tone(f * 1.005, t + 0.15 + i * 0.16, 0.5, 'sawtooth', 0.05);
    });
  }

  // Three detuned saws (68 / 79 / 92 Hz) through a resonant low-pass whose cutoff revs 220 -> 680 Hz: the rivals revving beside the player on the grid.
  _revChorus(on) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.rev) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 4.5;
      lp.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.4);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1.6;
      const depth = ctx.createGain();
      depth.gain.value = 230;
      lfo.connect(depth).connect(lp.frequency);
      const oscs = [68, 79, 92].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      lp.connect(g).connect(this.master);
      lfo.start();
      this.rev = { oscs, lfo, g, lp };
    } else if (!on && this.rev) {
      const r = this.rev;
      this.rev = null;
      r.g.gain.cancelScheduledValues(t);
      r.g.gain.setValueAtTime(r.g.gain.value, t);
      r.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      r.oscs.forEach((o) => o.stop(t + 0.35));
      r.lfo.stop(t + 0.35);
    }
  }

  // One shared rival-engine voice on the nearest rival inside 28 m: sawtooth + exhaust hiss, level (1 - d/28)^2, pitch Doppler-shifted by the closing speed.
  updateRivalEngineDoppler(dist, relVel, revPhase) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.rivalEng) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0;
      const ng = ctx.createGain();
      ng.gain.value = 0.35;
      o.connect(lp);
      n.connect(ng).connect(lp);
      lp.connect(g).connect(this.master);
      o.start();
      n.start();
      this.rivalEng = { o, g, lp };
    }
    const e = this.rivalEng;
    const near = dist < 28 ? (1 - dist / 28) ** 2 : 0;
    const f0 = 70 + 40 * Math.sin(revPhase);
    e.o.frequency.setTargetAtTime(f0 * (343 / Math.max(120, 343 - relVel)), t, 0.05);
    e.lp.frequency.setTargetAtTime(500 + near * 900, t, 0.1);
    e.g.gain.setTargetAtTime(near * 0.2, t, 0.06);
  }

  _gp(dt, world) {
    const gp = world.gp;
    if (!gp) return;
    for (const c of gp.cues.splice(0)) {
      if (c.k === 'count') this.playRaceCountdown(c.v);
      else if (c.k === 'gate') this.playGateClear(c.v);
      else if (c.k === 'pos') this.playPositionChange(c.v > 0);
      else if (c.k === 'fanfare') this.playCheckeredFanfare(c.v);
      else if (c.k === 'fail') this._tone(330, this.ctx.currentTime, 0.6, 'sawtooth', 0.09, 90);
    }
    this._revChorus(gp.state === 'COUNTDOWN' || gp.state === 'GRID_LOCK');
    if (gp.racing) {
      this.revPhase = (this.revPhase ?? 0) + dt * 7;
      this.updateRivalEngineDoppler(gp.audioView.dist, gp.audioView.closing, this.revPhase);
    } else if (this.rivalEng) this.rivalEng.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  _event(type) {
    if (type.startsWith('amb')) this.ambient.event(type);
    else if (type.startsWith('cust')) this.customs.event(type);
    else if (type === 'boatSlam' || type === 'cratePing' || type === 'patrolHorn' || type === 'boatBoost' || type === 'cbdStart') this.boat.event(type);
    else if (type === 'airLock') this.playAirLockChirp();
    else if (type === 'airSpikeDrop') this.playSpikeDrop();
    else if (type === 'airPuncture') this.playTirePuncture();
    else if (type === 'icptStart') this._jingle([440, 554, 659], 0.08, 'sine', 0.1);
    else if (type === 'icptEvade') this._tone(300, this.ctx.currentTime, 0.4, 'sawtooth', 0.09, 900);
    else if (type === 'icptDone') this._jingle([659, 880, 1175, 1568], 0.07, 'triangle', 0.14);
    else if (type === 'ramHit') this._heavyHit();
    else if (type === 'caseDrop') this._caseDrop();
    else if (type === 'casePick') this._casePick();
    else if (type === 'amsStart') this._jingle([392, 494, 587], 0.08, 'triangle', 0.1);
    else if (type === 'amsAlarm') this._tone(900, this.ctx.currentTime, 0.3, 'sawtooth', 0.08, 500);
    else if (type === 'amsTick') this._tone(1000, this.ctx.currentTime, 0.05, 'square', 0.06);
    else if (type === 'amsBonus') this._jingle([523, 659, 784, 1047], 0.07, 'triangle', 0.14);
    else if (type === 'failed') this._tone(440, this.ctx.currentTime, 0.55, 'sawtooth', 0.09, 110);
    else if (type === 'crestNear') this._chord([523, 659, 784], 1.0, 0.035);
    else if (type === 'crest') {
      const t = this.ctx.currentTime;
      [1319, 1760, 2093].forEach((f, i) => this._tone(f, t + i * 0.06, 0.25, 'sine', 0.07));
      this._tone(659, t, 0.3, 'triangle', 0.06);
    } else if (type === 'crestMilestone') {
      this._jingle([523, 659, 784, 1047, 1319], 0.09, 'triangle', 0.16);
      this._chord([523, 784, 1047], 1.4, 0.05);
    } else if (type === 'mission') this._jingle([523, 659, 784, 1047], 0.11, 'triangle', 0.16);
    else if (type === 'escaped') this._jingle([392, 523, 659, 784, 1047], 0.09, 'triangle', 0.15);
    else if (type === 'wantedUp') this._jingle([880, 660, 880], 0.09, 'square', 0.07);
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
