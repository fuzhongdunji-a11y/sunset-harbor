// sunsetGP: the Sunset GP rival street-racing championship. SunsetGPDirector owns the 3-round series (fees, purses, points, the Vento Apex R unlock), the race state machine,
// the start/finish gantry, the gate pylons, the confetti and the ?shot=gp staging. Rival driving is rivalRacer.js, the circuits are gpCourse.js, the HUD is gpHud.js.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';
import { Course, ROUNDS, GATE_HALF } from './gpCourse.js';
import { RivalRacer, RivalPack } from './rivalRacer.js';
import { makeRng } from './rng.js';

export const POINTS = [10, 6, 4, 2];
export const RING_R = 6.0; // the start ring around the gantry
const DNF_AFTER_WINNER = 30; // seconds the player has once a rival has finished
const FOOT_LIMIT = 12; // seconds allowed out of a car mid-race
const COURSE_LIMIT = 220; // metres from the active gate before the race is abandoned
const COOLDOWN = 15; // rematch cooldown after a failed / abandoned round
const GRID_TIME = 1.0, COUNT_TIME = 3.6, GO_AT = 3.0, PODIUM_TIME = 6.0, FINALE_TIME = 8.0;
const MAGENTA = 0xff2a85, AMBER = 0xffaa22;
const BANNER = { w: 512, h: 128 };

// The three rivals: chassis, livery and driving tuning (see rivalRacer.js for how each number is used).
export const PROFILES = [
  { id: 'cruz', name: 'Mateo "Veloce" Cruz', short: 'CRUZ', num: '07', carType: 'vesper', top: 31.5, cornerMult: 0.86, mistake: 0.06, lane: 1.6, mass: 1, color: '#00e5ff', livery: { key: 'cruz', base: '#00d8f2', roundel: ['#ffffff', '#101820'], num: '07' } },
  { id: 'takahashi', name: 'Sora Takahashi', short: 'TAKAHASHI', num: '22', carType: 'tuner', top: 33.0, cornerMult: 0.76, mistake: 0.12, lane: -0.9, mass: 1, color: '#ffd147', livery: { key: 'takahashi', base: '#1b1c22', roundel: ['#ffc531', '#15161a'], num: '22' } },
  { id: 'bellini', name: 'Dante "Bruto" Bellini', short: 'BELLINI', num: '88', carType: 'solari', top: 32.2, cornerMult: 0.80, mistake: 0.09, lane: 2.8, mass: 1.35, aggr: true, color: '#ff3b3b', livery: { key: 'bellini', base: '#d4202c', roundel: ['#ffffff', '#9d1620'], num: '88' } },
];
const NAME_OF = { player: 'YOU', cruz: 'CRUZ', takahashi: 'TAKAHASHI', bellini: 'BELLINI' };

export const defaultGp = () => ({ tourActive: false, currentRound: 0, points: { player: 0, cruz: 0, takahashi: 0, bellini: 0 }, toursWon: 0, unlockedVentoApex: false, bestTimesMs: [null, null, null] });

// Standings table sorted by points; a tie goes to the better finish in the last race played.
export function standings(points, lastOrder) {
  const ids = ['player', 'cruz', 'takahashi', 'bellini'];
  const pos = (id) => { const k = lastOrder ? lastOrder.indexOf(id) : 9; return k < 0 ? 9 : k; };
  return ids.map((id) => ({ id, pts: points[id] })).sort((a, b) => b.pts - a.pts || pos(a.id) - pos(b.id));
}

export const fmtTime = (sec) => {
  const t = Math.max(0, sec);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}`;
};

export class SunsetGPDirector {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.courses = ROUNDS.map((r) => new Course(world.net, r));
    this.st = defaultGp();
    this.state = 'IDLE_BEACON';
    this.t = 0; // seconds in the state
    this.raceT = 0; // race clock (starts at GO)
    this.racers = [];
    this.pack = null;
    this.rng = makeRng(0x5e11 + world.layout.seed);
    this.cues = []; // audio cues {k, v}, drained by audio.js
    this.view = { active: false };
    this.mapView = null;
    this.audioView = { dist: 99, closing: 0 };
    this.lastOrder = null; // finishing order of the last race (tie-break)
    this.pend = null; // the result of the race on the podium screen, not yet committed
    this.msg = ''; // why the beacon is blocked (shown as the prompt), '' when it is open
    this.dwell = 0;
    this.clock = 0;
    this.vento = null;
    this.ventoT = 0;
    this.ps = 0; this.pHint = 0; this.gi = 0; this.place = 4; this.footT = 0; this.dnfT = null; this.cooldown = 0; this.modal = null; this.shotFrozen = false;
    this._buildProps();
    this._gantryAt(this.course.gantry.x, this.course.gantry.z, this.course.gantry.h);
    // tick with the world: wrap afterStep so shots, the bench and the live loop all run the same code
    const orig = world.afterStep.bind(world);
    world.afterStep = (dt, mouse) => {
      orig(dt, mouse);
      this.update(dt);
    };
  }

  get round() { return Math.min(2, this.st.currentRound); }
  get course() { return this.courses[this.round]; }
  get cfg() { return ROUNDS[this.round]; }
  // True while a race (or its podium) owns the world: scripted missions, ambient events and a second GP start all stand down.
  isBusy() { return this.state !== 'IDLE_BEACON' && this.state !== 'ABANDONED' && this.state !== 'RACE_FAILED'; }
  get racing() { return this.state === 'RACING'; }

  serialize() { return JSON.parse(JSON.stringify(this.st)); }
  restore(raw) {
    this.st = { ...defaultGp(), ...(raw ?? {}) };
    this.st.currentRound = Math.min(2, this.st.currentRound);
    this._gantryAt(this.course.gantry.x, this.course.gantry.z, this.course.gantry.h);
    this._ensureVento(true);
  }

  // ---- props: gantry (1 draw call), gate pylons (1 InstancedMesh), confetti (1 InstancedMesh) --------------------------------------------------------------------
  _buildProps() {
    const cv = document.createElement('canvas');
    cv.width = BANNER.w;
    cv.height = BANNER.h;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, BANNER.w, BANNER.h);
    const grad = g.createLinearGradient(0, 0, BANNER.w, 0);
    grad.addColorStop(0, '#2a0a3a');
    grad.addColorStop(1, '#5b1250');
    g.fillStyle = grad;
    g.fillRect(16, 8, BANNER.w - 16, 112);
    for (let i = 0; i < 31; i++) {
      g.fillStyle = (i + 0) % 2 ? '#ffffff' : '#15161a';
      g.fillRect(16 + i * 16, 8, 16, 10);
      g.fillStyle = i % 2 ? '#15161a' : '#ffffff';
      g.fillRect(16 + i * 16, 110, 16, 10);
    }
    g.font = 'italic 900 70px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ff2a85';
    g.fillText('SUNSET GP', 268, 66);
    g.fillStyle = '#ffffff';
    g.fillText('SUNSET GP', 262, 62);
    g.fillStyle = '#ffffff'; // the corner texel every plain face samples
    g.fillRect(0, BANNER.h - 8, 8, 8);
    this.bannerTex = new THREE.CanvasTexture(cv);
    this.bannerTex.colorSpace = THREE.SRGBColorSpace;

    const b = new MeshBuilder();
    const STEEL = 0x2b2d3a, NEON = new THREE.Color(2.6, 0.2, 1.0), OFF = new THREE.Color(0.12, 0.08, 0.1);
    for (const sx of [-1, 1]) {
      const x = sx * 6.5;
      b.box(x - 0.8, 0, -0.8, x + 0.8, 0.3, 0.8, 0x15161a);
      for (const px of [-0.3, 0.3]) b.box(x + px - 0.12, 0.3, -0.12, x + px + 0.12, 9.5, 0.12, STEEL);
      for (let y = 1.4; y < 9.2; y += 2.2) b.box(x - 0.3, y, -0.08, x + 0.3, y + 0.14, 0.08, STEEL);
      b.box(x - 0.04 + sx * 0.5, 0.6, 0.3, x + 0.04 + sx * 0.5, 9.2, 0.38, NEON); // neon edge strip on the front
    }
    b.box(-7.0, 9.0, -0.45, 7.0, 9.5, 0.45, STEEL); // the truss the banner hangs from
    const U = (cx, cy) => [cx / BANNER.w, 1 - cy / BANNER.h];
    for (const front of [true, false]) {
      const z = front ? 0.5 : -0.5, a = front ? 1 : -1;
      // banner face: u runs with +x on the front and with -x on the back so the lettering reads from both sides
      const x0 = front ? -6.2 : 6.2, x1 = front ? 6.2 : -6.2;
      b.quad([x0, 7.5, z], [x1, 7.5, z], [x1, 9.0, z], [x0, 9.0, z], 0xffffff, [0, 0, a], [U(16, 120), U(512, 120), U(512, 8), U(16, 8)]);
    }
    b.box(-6.3, 7.4, -0.5, 6.3, 7.5, 0.5, STEEL);
    this.podStart = b.pos.length / 3;
    for (const x of [-2.7, -0.9, 0.9, 2.7]) b.box(x - 0.34, 6.5, 0.42, x + 0.34, 7.3, 0.9, OFF);
    this.podCount = (b.pos.length / 3 - this.podStart) / 4;
    this.ringStart = b.pos.length / 3;
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * Math.PI * 2, a1 = ((i + 0.78) / 20) * Math.PI * 2;
      const P = (a, r) => [Math.cos(a) * r, 0.12, Math.sin(a) * r];
      b.quad(P(a0, RING_R - 0.6), P(a1, RING_R - 0.6), P(a1, RING_R), P(a0, RING_R), new THREE.Color(2.4, 0.3, 1.1), [0, 1, 0]);
    }
    this.ringEnd = b.pos.length / 3;
    const geo = b.build();
    this.gantryGeo = geo;
    this.gantry = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.bannerTex, vertexColors: true }));
    this.gantry.frustumCulled = false;
    this.scene.add(this.gantry);
    this.podColor = (k, col) => {
      const c = geo.attributes.color;
      for (let i = this.podStart + k * this.podCount; i < this.podStart + (k + 1) * this.podCount; i++) c.setXYZ(i, col.r, col.g, col.b);
      c.needsUpdate = true;
    };
    this.ringColor = (col) => {
      const c = geo.attributes.color;
      for (let i = this.ringStart; i < this.ringEnd; i++) c.setXYZ(i, col.r, col.g, col.b);
      c.needsUpdate = true;
    };
    this.ringAmber = false;

    // gate pylon + floating chevron, one geometry, 4 instances (current gate's two posts, next gate's two at 55% scale)
    const p = new MeshBuilder();
    const W = 0xffffff;
    p.box(-0.55, 0, -0.55, 0.55, 0.3, 0.55, W);
    p.box(-0.28, 0.3, -0.28, 0.28, 5.2, 0.28, W);
    p.box(-0.4, 5.2, -0.4, 0.4, 5.5, 0.4, W);
    for (const dy of [0, 0.35]) {
      const y = 6.1 + dy;
      p.quad([0, y, 1.5], [-1.0, y, -0.2], [0, y, 0.35], [0, y, 0.35], W, [0, 1, 0]);
      p.quad([0, y, 1.5], [0, y, 0.35], [1.0, y, -0.2], [1.0, y, -0.2], W, [0, 1, 0]);
      p.quad([0, y, 1.5], [0, y, 0.35], [-1.0, y, -0.2], [-1.0, y, -0.2], W, [0, -1, 0]);
      p.quad([0, y, 1.5], [1.0, y, -0.2], [0, y, 0.35], [0, y, 0.35], W, [0, -1, 0]);
    }
    this.pylons = new THREE.InstancedMesh(p.build(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 4);
    this.pylons.frustumCulled = false;
    this.pylons.visible = false;
    this.scene.add(this.pylons);
    this.pylonTris = p.pos.length / 9;

    // confetti: 80 flat quads
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.26, 0.16), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 80);
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    const cc = [0xffd23f, 0xff2a85, 0x00e5ff, 0xffffff];
    for (let i = 0; i < 80; i++) this.confetti.setColorAt(i, new THREE.Color(cc[i % 4]));
    this.scene.add(this.confetti);
    this.conf = Array.from({ length: 80 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, wr: 0 }));
    this.confT = 0;
    this._o = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  _gantryAt(x, z, h) {
    this.gantry.position.set(x, this.world.layout.groundHeightAt(x, z), z);
    this.gantry.rotation.y = h;
    this.gantryPose = { x, z, h };
  }

  _lights(mode) { // 'off' | 'red' | 'green'
    const col = mode === 'red' ? new THREE.Color(2.6, 0.15, 0.1) : mode === 'green' ? new THREE.Color(0.2, 2.6, 0.6) : new THREE.Color(0.12, 0.08, 0.1);
    for (let k = 0; k < 4; k++) this.podColor(k, col);
  }

  // Current gate + the next one: left/right pylons, 5.5 m either side of the line, chevrons pointing along the course.
  _placeGates(gi) {
    const C = this.course, o = this._o;
    this.pylons.visible = true;
    let n = 0;
    for (let k = 0; k < 2; k++) {
      const g = C.gates[gi + k];
      for (const side of [-1, 1]) {
        if (!g) { o.position.set(0, -50, 0); o.scale.setScalar(0.001); } else {
          o.position.set(g.x + g.nx * 5.5 * side, this.world.layout.groundHeightAt(g.x, g.z), g.z + g.nz * 5.5 * side);
          o.rotation.set(0, Math.atan2(g.tx, g.tz), 0);
          o.scale.setScalar(k === 0 ? 1 : 0.55);
        }
        o.updateMatrix();
        this.pylons.setMatrixAt(n, o.matrix);
        this.pylons.setColorAt(n, this._c.set(k === 0 ? MAGENTA : AMBER).multiplyScalar(1.5));
        n++;
      }
    }
    this.pylons.instanceMatrix.needsUpdate = true;
    this.pylons.instanceColor.needsUpdate = true;
  }

  _burst() {
    const f = this.course.finishPose();
    const fx = Math.sin(f.h), fz = Math.cos(f.h);
    this.conf.forEach((c, i) => {
      const a = (i / 80) * Math.PI * 2 + this.rng() * 0.6, sp = 4 + this.rng() * 7;
      c.x = f.x + (this.rng() - 0.5) * 9; c.z = f.z + (this.rng() - 0.5) * 2; c.y = 9;
      c.vx = Math.cos(a) * sp * 0.6 + fx * 3; c.vz = Math.sin(a) * sp * 0.6 + fz * 3; c.vy = 5 + this.rng() * 7;
      c.rx = this.rng() * 6; c.ry = this.rng() * 6; c.wr = 3 + this.rng() * 8;
    });
    this.confT = 6;
    this.confetti.visible = true;
  }

  _stepConfetti(dt) {
    if (this.confT <= 0) return;
    this.confT -= dt;
    const o = this._o;
    this.conf.forEach((c, i) => {
      c.vy -= 6 * dt; c.vx *= 1 - 0.8 * dt; c.vz *= 1 - 0.8 * dt;
      c.vy = Math.max(c.vy, -2.4); // flutter, not fall
      c.x += c.vx * dt; c.y = Math.max(0.05, c.y + c.vy * dt); c.z += c.vz * dt;
      c.rx += c.wr * dt; c.ry += c.wr * 0.7 * dt;
      o.position.set(c.x, c.y, c.z);
      o.rotation.set(c.rx, c.ry, 0);
      o.scale.setScalar(this.confT > 0.5 ? 1 : this.confT * 2);
      o.updateMatrix();
      this.confetti.setMatrixAt(i, o.matrix);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    if (this.confT <= 0) this.confetti.visible = false;
  }

  // ---- reward car -----------------------------------------------------------------------------------------------------------------------------------------------
  // The Vento Apex R waits at the Harbor Marina paddock (the curb slot nearest Pier 1) once unlocked: one car, restored on every load.
  _ensureVento(force = false) {
    const w = this.world;
    if (!this.st.unlockedVentoApex) return;
    if (this.vento && w.vehicles.list.includes(this.vento)) return;
    const slot = this._paddock();
    const p = w.player;
    if (!force && Math.hypot(p.px - slot.x, p.pz - slot.z) < 60) return; // never pop a car in front of the player
    for (const v of [...w.vehicles.list]) if (v.kind === 'parked' && !v.driver && v.typeKey !== 'ventoApex' && v.distanceTo(slot.x, slot.z) < 3.5) w.vehicles.remove(v);
    this.vento = w.vehicles.spawn('ventoApex', 0xff8a4c, slot.x, slot.z, slot.h);
    this.vento.owned = true;
  }

  _paddock() {
    const pier = this.world.layout.marina.piers[0];
    let best = null, bd = Infinity;
    for (const s of this.world.layout.slots) {
      const d = Math.hypot(s.x - pier.ring.x, s.z - 320);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---- gating -----------------------------------------------------------------------------------------------------------------------------------------------------
  _gate() {
    const w = this.world, p = w.player, C = this.course, fee = this.cfg.fee, n = this.round + 1;
    const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
    if (!car) return `BRING A CAR TO ENTER SUNSET GP — ROUND ${n} ($${fee})`;
    if (w.wanted.stars >= 1) return 'LOSE THE HEAT TO START SUNSET GP';
    if (w.cash < fee) return `NEED $${fee} BUY-IN FOR ROUND ${n}`;
    if (w.ambient.missionBusy || w.ambient.active || w.customs.locked) return 'FINISH YOUR CURRENT JOB FIRST';
    void C;
    return '';
  }

  _idle(dt) {
    const w = this.world, p = w.player, G = this.course.gantry;
    const d = Math.hypot(p.px - G.x, p.pz - G.z);
    const near = d < 22 && !w.fx;
    this.msg = near ? this._gate() : '';
    const open = near && !this.msg;
    const amber = near && !!this.msg;
    if (amber !== this.ringAmber) {
      this.ringAmber = amber;
      this.ringColor(amber ? new THREE.Color(2.6, 1.7, 0.2) : new THREE.Color(2.4, 0.3, 1.1));
    }
    this.mapView = { start: { x: G.x, z: G.z, blocked: !!this.msg }, route: null, gate: null, rivals: [] };
    this.view = { active: false };
    let go = false;
    if (open && d < RING_R) {
      const v = p.vehicle;
      if (Math.abs(v.speedF) < 3) {
        this.dwell += dt;
        if (w.prompt === '') w.prompt = `[E] Start Sunset GP — Round ${this.round + 1} ($${this.cfg.fee})`;
        w.promptProgress = Math.min(1, this.dwell / 1.2);
        go = w._input.pressed('KeyE') || this.dwell >= 1.2;
      } else {
        this.dwell = 0;
        if (w.prompt === '') w.prompt = 'STOP IN THE RING TO START SUNSET GP';
      }
    } else {
      this.dwell = 0;
      if (this.msg && w.prompt === '') w.prompt = this.msg;
    }
    if (go) this._enterGrid();
  }

  // ---- race flow --------------------------------------------------------------------------------------------------------------------------------------------------
  _enter(state) {
    this.state = state;
    this.t = 0;
  }

  _spawnRivals() {
    const C = this.course, w = this.world;
    this.pack = new RivalPack(this.scene, PROFILES);
    this.racers = PROFILES.map((pr) => new RivalRacer(pr, w.vehicles.spawnRival(pr.carType, 0xffffff, 0, 0, 0), C, makeRng(0x6770 + this.round * 31 + pr.num.charCodeAt(1))));
  }

  _enterGrid() {
    const w = this.world, C = this.course, p = w.player;
    w.cash -= this.cfg.fee; // the buy-in is gone the moment the grid locks
    w.saveRequested = true;
    this.pend = null;
    this.cleanup(false);
    this._enter('GRID_LOCK');
    this._spawnRivals();
    // clear the grid of parked cars and traffic, then snap everyone to a 2x2 grid behind the line
    const slotsS = [22.5, 22.5, 16, 16], slotsL = [2.4, -2.4, 2.4, -2.4];
    const pts = slotsS.map((s, k) => { const c = C.pointAt(s); return { x: c.x + c.nx * slotsL[k], z: c.z + c.nz * slotsL[k], c }; });
    for (const v of [...w.vehicles.list]) if (v.kind === 'parked' && !v.driver && pts.some((q) => v.distanceTo(q.x, q.z) < 6)) w.vehicles.remove(v);
    w.traffic.clearArea(C.gantry.x, C.gantry.z, 60, w.focusPoint);
    const pv = p.vehicle;
    const place = (v, k) => {
      const q = pts[k];
      v.x = q.x; v.z = q.z; v.h = Math.atan2(q.c.tx, q.c.tz);
      v.vx = v.vz = v.speedF = 0; v.steer = 0; v.wake = true; v.frozen = true; v.health = Math.max(v.health, 60);
    };
    place(pv, 1); // the player starts front-right
    this.racers.forEach((r, i) => { place(r.v, [0, 3, 2][i]); r.s = 0; r.hint = 0; });
    w.rig.yaw = pv.h;
    w.rig.snap(p, w.collision);
    this.gi = 0; this.ps = 0; this.pHint = 0; this.raceT = 0; this.footT = 0; this.dnfT = null; this.place = 4; this.lastPlace = 4;
    this._gantryAt(C.gantry.x, C.gantry.z, C.gantry.h);
    this._lights('off');
    this._placeGates(0);
    this.pack.mesh.visible = true;
  }

  _order() {
    // finishing order: finished rivals by time, then everyone else by progress (the player counts by his own progress)
    const items = this.racers.map((r) => ({ id: r.p.id, key: r.finished ? 1e9 - r.finishTime : r.s }));
    items.push({ id: 'player', key: this.playerDone ? 1e9 - this.playerDone : this.ps });
    return items.sort((a, b) => b.key - a.key).map((i) => i.id);
  }

  _race(dt) {
    const w = this.world, p = w.player, C = this.course;
    this.raceT += dt;
    if (w.fx) return this._fail('RACE_FAILED', 'WRECKED');
    const car = p.inCar && !p.vehicle.isBoat ? p.vehicle : null;
    if (!car) {
      this.footT += dt;
      if (this.footT > FOOT_LIMIT) return this._fail('ABANDONED', 'ABANDONED');
    } else this.footT = 0;
    const pr = C.project(p.px, p.pz, this.pHint);
    this.pHint = Math.max(0, pr.i - 1);
    if (pr.dist < 40) this.ps = Math.max(this.ps, pr.s);
    // gates: inside the trigger radius, or already past it along the line (a missed gate never blocks the race)
    for (let n = 0; n < 2; n++) {
      const g = C.gates[this.gi];
      if (!g) break;
      const hit = Math.hypot(p.px - g.x, p.pz - g.z) < GATE_HALF || (this.ps > g.s + 12 && pr.dist < 40);
      if (!hit) break;
      this.gi++;
      const left = C.gates.length - this.gi;
      if (g.final) { this.cues.push({ k: 'gate', v: 3 }); this._finish(); return undefined; }
      this.cues.push({ k: 'gate', v: left <= 3 ? 4 - left : 0 });
      this._placeGates(this.gi);
    }
    const far = C.gates[Math.min(this.gi, C.gates.length - 1)];
    // 220 m from the active gate is "off course", but never less than the gap to it: the longest straights run 234 m between gates
    const prevS = this.gi > 0 ? C.gates[this.gi - 1].s : 0;
    if (far && Math.hypot(p.px - far.x, p.pz - far.z) > Math.max(COURSE_LIMIT, far.s - prevS + 40)) return this._fail('ABANDONED', 'OFF COURSE');
    // the gantry moves to the finish arch once the player is past 60% of the line
    if (this.ps > C.total * 0.6 && !this.gantryAtFinish && !C.round.loop) {
      const f = C.finishPose();
      this._gantryAt(f.x, f.z, f.h);
      this.gantryAtFinish = true;
    }
    // rivals
    const ctx = { playerS: this.ps, player: { x: p.px, z: p.pz }, vehicles: w.vehicles.list, time: this.raceT, frozen: false };
    for (const r of this.racers) {
      r.update(dt, ctx);
      if (r.finished && this.dnfT === null) this.dnfT = DNF_AFTER_WINNER;
    }
    if (this.dnfT !== null) {
      this.dnfT -= dt;
      if (this.dnfT <= 0) return this._fail('RACE_FAILED', 'DNF');
    }
    this._rank(dt);
    return undefined;
  }

  _rank(dt) {
    const w = this.world, C = this.course, p = w.player;
    const ahead = this.racers.filter((r) => r.progress > this.ps).length;
    const place = 1 + ahead;
    if (place !== this.place) {
      this.cues.push({ k: 'pos', v: place < this.place ? 1 : -1 });
      this.place = place;
    }
    const sp = Math.max(12, Math.abs(p.vehicle?.speedF ?? 0));
    let up = null, down = null;
    for (const r of this.racers) {
      const d = r.progress - this.ps;
      if (d > 0 && (!up || d < up.d)) up = { r, d };
      if (d <= 0 && (!down || d > down.d)) down = { r, d };
    }
    this.clock += dt;
    if (!this.splitT || this.clock - this.splitT >= 0.1) {
      this.splitT = this.clock;
      this.split = {
        ahead: up && { short: up.r.p.short, num: up.r.p.num, gap: -up.d / sp, color: up.r.p.color },
        behind: down && { short: down.r.p.short, num: down.r.p.num, gap: -down.d / sp, color: down.r.p.color },
      };
    }
    // nearest rival for the Doppler engine cue
    let best = null;
    for (const r of this.racers) {
      const d = Math.hypot(r.v.x - p.px, r.v.z - p.pz);
      if (!best || d < best.d) best = { d, rel: r.v.speedF - (p.vehicle?.speedF ?? 0) };
    }
    this.audioView = { dist: best ? best.d : 99, closing: best ? -best.rel : 0 };
    void C;
  }

  // The player crossed the last gate: build the result and open the podium.
  _finish() {
    this.playerDone = this.raceT;
    this.pylons.visible = false; // the gates are cleared: only the finish arch and the confetti remain
    const order = this._order();
    this._resolve(order, Math.round(this.raceT * 1000));
  }

  // Result for a finishing order (ids best to worst): purse now, points on commit (Continue / timeout).
  _resolve(order, ms) {
    const w = this.world, cfg = this.cfg;
    const place = order.indexOf('player') + 1;
    const purse = cfg.purse[place - 1];
    w.cash += purse;
    const add = {};
    order.forEach((id, i) => { add[id] = POINTS[i]; });
    this.pend = { place, purse, order, add, ms, round: this.round };
    const best = this.st.bestTimesMs[this.round];
    this.pend.record = best === null || ms < best;
    for (const r of this.racers) r.finished = true; // the pack rolls out
    this.lastOrder = order;
    this._burst();
    const f = this.course.finishPose();
    if (!this.course.round.loop) this._gantryAt(f.x, f.z, f.h);
    this.cues.push({ k: 'fanfare', v: place });
    this._enter('PODIUM_SUMMARY');
    this._buildModal();
  }

  _commit() {
    const st = this.st, pend = this.pend;
    if (!pend) return;
    for (const id of Object.keys(pend.add)) st.points[id] += pend.add[id];
    if (pend.record) st.bestTimesMs[pend.round] = pend.ms;
    st.tourActive = true;
    st.currentRound = pend.round + 1;
    this.world.saveRequested = true;
    if (pend.round === 2) return this._finale();
    this.cleanup(true);
    this._enter('IDLE_BEACON');
    this._gantryAt(this.course.gantry.x, this.course.gantry.z, this.course.gantry.h);
    this.pend = null;
    return undefined;
  }

  _finale() {
    const st = this.st, w = this.world;
    const table = standings(st.points, this.lastOrder);
    const rank = table.findIndex((r) => r.id === 'player') + 1;
    let bonus = 0, unlocked = false;
    if (rank === 1) {
      bonus = st.unlockedVentoApex ? 10000 : 8500;
      unlocked = !st.unlockedVentoApex;
      st.toursWon++;
      st.unlockedVentoApex = true;
    } else if (rank === 2) bonus = 2500;
    w.cash += bonus;
    this.final = { rank, bonus, unlocked, table };
    this.cleanup(true);
    this._ensureVento(true);
    this._enter('SERIES_FINALE');
    this._buildModal();
    w.saveRequested = true;
    this.pend = null;
  }

  _endFinale() {
    const st = this.st;
    st.points = { player: 0, cruz: 0, takahashi: 0, bellini: 0 };
    st.currentRound = 0;
    st.tourActive = false;
    this.final = null;
    this.modal = null;
    this._enter('IDLE_BEACON');
    this._gantryAt(this.course.gantry.x, this.course.gantry.z, this.course.gantry.h);
    this.world.saveRequested = true;
  }

  // Rematch from the podium: hand the purse back, pay the buy-in again, line up on the grid.
  _rematch() {
    const w = this.world, pend = this.pend;
    if (!pend || pend.round > 1 || w.cash - pend.purse < this.cfg.fee) return;
    w.cash -= pend.purse;
    this.pend = null;
    this.modal = null;
    this._enterGrid();
  }

  _fail(state, why) {
    this.cleanup(true);
    this.pend = null;
    this.modal = null;
    this.cooldown = COOLDOWN;
    this.failWhy = why;
    this._enter(state);
    this.cues.push({ k: 'fail', v: 0 });
    this.world.notify(`SUNSET GP: ${why} — BUY-IN LOST`, 'warn');
    this.world.saveRequested = true;
    return undefined;
  }

  // Remove everything a race created: rival cars, the pack mesh, pylons, confetti. keepBeacon=false is used by the next grid (no flicker).
  cleanup(hide) {
    const w = this.world;
    for (const r of this.racers) w.vehicles.remove(r.v);
    this.racers = [];
    if (this.pack) { this.pack.dispose(this.scene); this.pack = null; }
    this.pylons.visible = false;
    if (hide) { this.confetti.visible = false; this.confT = 0; }
    this.gantryAtFinish = false;
    this.playerDone = 0;
    this.mapView = null;
    this._lights('off');
    const pv = w.player.vehicle;
    if (pv) pv.frozen = false;
  }

  _buildModal() {
    const st = this.st, pend = this.pend;
    if (this.state === 'SERIES_FINALE') {
      const f = this.final;
      this.modal = { title: f.rank === 1 ? 'SUNSET GP CHAMPION' : `SERIES FINISHED  ${['', '1ST', '2ND', '3RD', '4TH'][f.rank]}`, rows: f.table.map((r, i) => ({ place: i + 1, name: NAME_OF[r.id], mine: r.id === 'player', time: '', pts: r.pts, add: 0 })), cash: f.bonus, cashLabel: f.rank === 1 ? "CHAMPION'S PURSE" : 'RUNNER-UP BONUS', unlock: f.unlocked, hint: f.unlocked ? 'VENTO APEX R UNLOCKED — HARBOR MARINA PADDOCK' : '' };
      return;
    }
    const pts = { ...st.points };
    for (const id of Object.keys(pend.add)) pts[id] += pend.add[id];
    const table = standings(pts, pend.order);
    const timeOf = (id) => (id === 'player' ? fmtTime(pend.ms / 1000) : (() => { const r = this.racers.find((x) => x.p.id === id); return r && r.finishTime > 0 ? fmtTime(r.finishTime) : '—'; })());
    this.modal = {
      title: `ROUND ${pend.round + 1} — ${this.cfg.name}`,
      rows: pend.order.map((id, i) => ({ place: i + 1, name: NAME_OF[id], mine: id === 'player', time: timeOf(id), pts: pts[id], add: pend.add[id], rank: table.findIndex((r) => r.id === id) + 1 })),
      cash: pend.purse, cashLabel: 'PURSE', record: pend.record, hint: pend.round < 2 ? `[SPACE] CONTINUE   [R] REMATCH ($${this.cfg.fee})` : '[SPACE] CONTINUE', unlock: false,
    };
  }

  // ---- per-frame ---------------------------------------------------------------------------------------------------------------------------------------------------
  update(dt) {
    if (this.shotFrozen) { this._publish(); return; }
    const w = this.world, p = w.player;
    this.t += dt;
    this._stepConfetti(dt);
    this.ventoT -= dt;
    if (this.ventoT <= 0) { this.ventoT = 5; this._ensureVento(false); }
    const st = this.state;
    if (st === 'IDLE_BEACON') this._idle(dt);
    else if (st === 'GRID_LOCK') {
      if (this.t >= GRID_TIME) { this._enter('COUNTDOWN'); this._lights('red'); this.cues.push({ k: 'count', v: 3 }); this.lastCount = 3; }
    } else if (st === 'COUNTDOWN') {
      const n = 3 - Math.floor(this.t);
      if (n !== this.lastCount && n >= 1) { this.lastCount = n; this.cues.push({ k: 'count', v: n }); }
      if (this.t >= GO_AT) {
        this.cues.push({ k: 'count', v: 0 });
        this._lights('green');
        this._enter('RACING');
        this.goBanner = 0.6;
        if (p.vehicle) p.vehicle.frozen = false;
        for (const r of this.racers) r.v.frozen = false;
      } else if (w.fx) this._fail('RACE_FAILED', 'WRECKED');
    } else if (st === 'RACING') {
      if (this.goBanner > 0) this.goBanner -= dt;
      this._race(dt);
    } else if (st === 'PODIUM_SUMMARY') {
      for (const r of this.racers) r.update(dt, { playerS: this.ps, player: { x: p.px, z: p.pz }, vehicles: w.vehicles.list, time: this.raceT, frozen: false });
      const inp = w._input;
      if (inp.pressed('KeyR')) this._rematch();
      else if (inp.pressed('Space') || this.t >= PODIUM_TIME) this._commit();
    } else if (st === 'SERIES_FINALE') {
      if (this.t >= FINALE_TIME || w._input.pressed('Space')) this._endFinale();
    } else if (st === 'ABANDONED' || st === 'RACE_FAILED') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) { this._enter('IDLE_BEACON'); this.failWhy = ''; }
      else if (w.prompt === '' && Math.hypot(p.px - this.course.gantry.x, p.pz - this.course.gantry.z) < 22) w.prompt = `REMATCH IN ${Math.ceil(this.cooldown)}s`;
    }
    if (this.pack) this.pack.sync(this.racers, w.camera);
    this.gantry.visible = true;
    this._publish();
  }

  // Data for the HUD, minimap and audio.
  _publish() {
    const w = this.world, C = this.course, st = this.state;
    const racing = st === 'RACING' || st === 'COUNTDOWN' || st === 'GRID_LOCK';
    if (racing || st === 'PODIUM_SUMMARY') {
      const lab = C.gateLabel(Math.min(this.gi, C.gates.length - 1));
      const rivals = this.racers.map((r) => ({ x: r.v.x, z: r.v.z, h: r.v.h, color: r.p.color }));
      const route = [];
      if (racing) {
        const g2 = C.gates[Math.min(this.gi + 2, C.gates.length - 1)];
        for (const q of C.pts) if (q.s >= this.ps - 4 && q.s <= g2.s + 2) route.push({ x: q.x, z: q.z });
      }
      const cur = C.gates[Math.min(this.gi, C.gates.length - 1)];
      this.mapView = { start: null, route, gate: racing ? { x: cur.x, z: cur.z } : null, finish: C.finishPose(), rivals };
      const count = st === 'COUNTDOWN' ? 3 - Math.floor(this.t) : st === 'RACING' && this.goBanner > 0 ? 0 : null;
      this.view = {
        active: true, state: st, round: this.round + 1, roundName: this.cfg.name, place: this.place, total: 4,
        gateText: C.laps > 1 ? `LAP ${lab.lap}/${lab.laps} • GATE ${String(lab.number).padStart(2, '0')}/${lab.total}` : `GATE ${String(lab.number).padStart(2, '0')} / ${lab.total}`,
        timer: fmtTime(this.raceT), best: this.st.bestTimesMs[this.round], split: this.split ?? {}, count, footLeft: this.footT > 0 ? FOOT_LIMIT - this.footT : null,
        dnf: this.dnfT, modal: st === 'PODIUM_SUMMARY' ? this.modal : null, fee: this.cfg.fee,
      };
    } else if (st === 'SERIES_FINALE') {
      this.view = { active: true, state: st, modal: this.modal, place: 1, total: 4, round: 3, roundName: '', gateText: '', timer: '', split: {}, count: null, footLeft: null, dnf: null };
      this.mapView = null;
    } else if (st === 'ABANDONED' || st === 'RACE_FAILED') {
      this.view = { active: false, failed: this.failWhy, cooldown: Math.ceil(this.cooldown) };
    }
  }

  // ---- ?shot=gp ---------------------------------------------------------------------------------------------------------------------------------------------------
  // Round 1 under way: 00:08.42, gate 02/12, the player 2nd of 4 in a pearl-white coupe, all three rivals around him, a police cruiser at the cross street, traffic and walkers.
  setupDeterministicShot(hud, ui) {
    const w = this.world, C = this.courses[0], net = w.net;
    ui.showTitle(false);
    hud.show(true);
    performance.now = () => 12345; // idle pedestrians sway on the wall clock; a pinned clock makes the frame identical on every load
    this.st = { ...defaultGp(), tourActive: true };
    this.state = 'RACING';
    this.shotFrozen = true; // the settle frames below tick the world (traffic, walkers) but not the race: the clock stays at 00:08.42
    this.t = 20; this.raceT = 8.42; this.clock = 10;
    this._spawnRivals();
    this.pack.mesh.visible = true;
    const S = C.gates[1].s - 26; // gate 1 is behind us, gate 2's magenta pylons stand 26 m ahead
    const at = (s, lat) => { const c = C.pointAt(s); return { x: c.x + c.nx * lat, z: c.z + c.nz * lat, h: Math.atan2(c.tx, c.tz), c }; };
    for (const v of [...w.vehicles.list]) if (v.kind === 'parked' && !v.driver) { const a = at(S, 0); if (Math.hypot(v.x - a.x, v.z - a.z) < 70) w.vehicles.remove(v); }
    const pp = at(S, 0.6);
    const car = w.vehicles.spawn('vesper', 0xf4f1ea, pp.x, pp.z, pp.h);
    car.stolen = true;
    w.placeInCar(car);
    car.speedF = 31; car.vx = Math.sin(pp.h) * 31; car.vz = Math.cos(pp.h) * 31;
    car.frozen = true; // pinned from the start: the settle frames must not move anyone
    w.rig.yaw = pp.h;
    w.cash = 3850;
    const sets = [[S + 2.8, 2.9], [S + 11.5, -3.1], [S - 6.5, -2.4]]; // Cruz just ahead on the right, Takahashi ahead on the left, Bellini behind-left
    this.racers.forEach((r, i) => {
      const a = at(sets[i][0], sets[i][1]);
      const v = r.v;
      v.x = a.x; v.z = a.z; v.h = a.h; v.vx = Math.sin(a.h) * 31; v.vz = Math.cos(a.h) * 31; v.speedF = 31; v.frozen = true; r.s = sets[i][0]; r.hint = 0;
    });
    this.ps = S; this.gi = 1; this.place = 2; this.pHint = 0;
    this._placeGates(1);
    this.gantryAtFinish = false;
    this._lights('green');
    this.split = { ahead: { short: 'TAKAHASHI', num: '22', gap: -0.36, color: PROFILES[1].color }, behind: { short: 'CRUZ', num: '07', gap: 0.09, color: PROFILES[0].color } };
    // civilians: three oncoming cars in the far lanes, a cruiser at the next cross street, four walkers
    const tan = C.pointAt(S);
    const dirOfSeg = Math.abs(tan.tx) > 0.5 ? (tan.tx > 0 ? 0 : 1) : (tan.tz > 0 ? 2 : 3);
    const opp = [1, 0, 3, 2][dirOfSeg];
    const gateNode = C.nodes[2]; // the intersection the gate 2 pylons stand on
    const beyond = net.step(gateNode[0], gateNode[1], dirOfSeg); // the next node: oncoming lanes start there and run back toward us
    if (beyond) {
      for (const [a, type] of [[20, 'pico'], [46, 'harborVan'], [66, 'marlin']]) {
        const q = net.lanePoint(beyond[0], beyond[1], opp, a);
        w.traffic.spawnAt(beyond[0], beyond[1], opp, q.x, q.z, type);
      }
    }
    // four walkers on the right-hand pavement between the previous node and the gate's intersection, turning toward the race
    const pn = C.nodes[1], sideZ = dirOfSeg < 2 ? -1 : 1;
    if (dirOfSeg < 2) {
      const A = { i: pn[0], j: pn[1], sx: dirOfSeg === 1 ? -1 : 1, sz: sideZ }, B = { i: gateNode[0], j: gateNode[1], sx: dirOfSeg === 1 ? 1 : -1, sz: sideZ };
      [[0, A, B, 0.74], [1, A, B, 0.82], [2, B, A, 0.12], [3, B, A, 0.22]].forEach(([k, a, b, t]) => w.peds.placeBetween(w.peds.list[k * 7 + 1], a, b, t));
    }
    const cross = [2, 3, 0, 1][dirOfSeg]; // a cross street leaving the gate's intersection: the cruiser waits on its far side
    if (net.step(gateNode[0], gateNode[1], cross)) w.police.spawnAt(gateNode[0], gateNode[1], cross, 16, false);
    w.wanted.heat = 1.2;
    for (let k = 0; k < 14; k++) { w.update(1 / 60, { down: () => false, pressed: () => false }, { dx: 0, dy: 0 }); hud.update(1 / 60, w); }
    w.wanted.heat = 1.2;
    w.wanted.stars = 1;
    w.messages.length = 0; hud.toastQueue.length = 0; hud.toastTimer = 0;
    for (const r of this.racers) { r.v.frozen = true; }
    car.frozen = true;
    // camera: C = P - 9.8F - 3.6R + 2.65U looking at P + 16F + 0.4R + 1.15U, FOV 54 (R = the right of travel)
    const F = { x: Math.sin(car.h), z: Math.cos(car.h) }, R = { x: -F.z, z: F.x };
    const cam = w.camera;
    cam.position.set(car.x - F.x * 13.5 - R.x * 3.6, car.y + 2.65, car.z - F.z * 13.5 - R.z * 3.6); // 13.5 m back, not the brief's 9.8: at 9.8 the Enforcer (6.5 m behind) filled the lens
    cam.fov = 54;
    cam.updateProjectionMatrix();
    cam.lookAt(car.x + F.x * 16 + R.x * 0.4, car.y + 1.15, car.z + F.z * 16 + R.z * 0.4);
    w.env.update(1 / 60, cam, w.focusPoint);
    cam.updateMatrixWorld(true);
    w.district = w.layout.districtAt(car.x, car.z);
    this.pack.sync(this.racers, cam);
    this._publish();
    const still = document.createElement('style'); // freeze CSS pops/pulses so the HUD is identical on every load
    still.textContent = '*{animation:none!important;transition:none!important}';
    document.head.appendChild(still);
  }
}
