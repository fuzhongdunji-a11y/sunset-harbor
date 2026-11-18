// contrabandMission: the Harbor Contraband Run job. Start at the cyan bollard ring on Pier 1, pick up four crates under blinking buoys in the bay, then bring the boat into Smuggler's Cove Slip. States: IDLE -> BRIEF -> COLLECTING -> RETURN -> (paid | failed) -> 45 s cooldown.
import * as THREE from '../vendor/three.module.min.js';
import { seaHeight } from './environment.js';
import { buildBuoyGeometry, buildMarkerGeometry } from './boatModels.js';
import { makeRng } from './rng.js';

export const CRATES = 4;
export const TIME_LIMIT = 120.0;
const BRIEF_TIME = 2.0;
const PICKUP_R = 4.5;
const RING_R = 1.8;
const SLIP_R = 6.0;
const SLIP_SPEED = 8.0; // m/s: slower than this inside the slip ring secures the offload
const ABANDON_LIMIT = 25.0;
const COOLDOWN = 45.0;
const BASE_PAY = 3200; // 4 crates x $800
const SECOND_PAY = 25;
const CLEAN_BONUS = 650;
const CLEAN_HP = 200;
const MIN_SPACING = 95;
const BUOY_NEAR = 140, BUOY_FAR = 420;

export class ContrabandRun {
  constructor(world, scene) {
    this.world = world;
    this.pier = world.layout.marina.piers[0];
    this.slip = world.layout.marina.slip;
    this.state = 'IDLE';
    this.cooldown = 8; // a short grace at the start of the game
    this.runs = 0;
    this.collected = 0;
    this.buoys = [];
    this.timeLeft = TIME_LIMIT;
    this.briefT = 0;
    this.abandonT = 0;
    this.boarded = false;
    this.boat = null;
    this.seen = false; // the "contraband contact" caption has shown for this cooldown
    this.time = 0;
    this.result = null; // {lines, total} for the HUD toast after a payout
    this._buildMeshes(scene);
  }

  _buildMeshes(scene) {
    this.imBuoy = new THREE.InstancedMesh(buildBuoyGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), CRATES);
    this.imBuoy.frustumCulled = false;
    this.imBuoy.count = 0;
    this.imBuoy.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.imBuoy);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.imMark = new THREE.InstancedMesh(buildMarkerGeometry(), mat, 2);
    this.imMark.frustumCulled = false;
    this.imMark.count = 0;
    this.imMark.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.imMark);
  }

  get active() {
    return this.state === 'BRIEF' || this.state === 'COLLECTING' || this.state === 'RETURN';
  }

  // True while the main mission chain, a Signal Intercept or an Armored Shakedown is in progress.
  get _otherJob() {
    const w = this.world, m = w.missions;
    return m.stepIndex > 0 || m.timeLeft !== null || w.intercept.active || w.armored.active;
  }

  get available() {
    return this.state === 'IDLE' && this.cooldown <= 0 && !this._otherJob && !this.world.fx;
  }

  get clean() {
    return !!this.boat && this.boat.hp >= CLEAN_HP;
  }

  get payout() {
    const secs = Math.max(0, Math.floor(this.timeLeft));
    const lines = [['4 crates', BASE_PAY], [`${secs}s left x $${SECOND_PAY}`, secs * SECOND_PAY], ['Clean hull', this.clean ? CLEAN_BONUS : 0]];
    return { lines, total: lines.reduce((a, l) => a + l[1], 0) };
  }

  // Nearest thing the player should head for (crate or slip).
  get target() {
    const p = this.world.player;
    if (this.state === 'RETURN') return { x: this.slip.x, z: this.slip.z };
    let best = null, bd = Infinity;
    for (const b of this.buoys) {
      if (b.got) continue;
      const d = Math.hypot(b.x - p.px, b.z - p.pz);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best && { x: best.x, z: best.z };
  }

  get view() {
    return {
      active: this.active,
      state: this.state,
      collected: this.collected,
      total: CRATES,
      timeLeft: this.timeLeft,
      clean: this.clean,
      abandon: this.abandonT > 0 ? Math.max(0, ABANDON_LIMIT - this.abandonT) : null,
      brief: this.state === 'BRIEF',
    };
  }

  // What the left mission panel shows while the job runs.
  get missionView() {
    const t = this.target, p = this.world.player;
    const near = this.state === 'RETURN' && t && Math.hypot(t.x - p.px, t.z - p.pz) < 70;
    return {
      title: 'Contraband Drop',
      objective: this.state === 'RETURN' ? (near ? 'Ease off under 15 kts and glide into the slip' : "Run the crates to Smuggler's Cove Slip") : 'Collect the crates under the blinking buoys',
      reward: BASE_PAY,
      rewardText: `$${BASE_PAY.toLocaleString('en-US')}+`,
      dist: t ? Math.hypot(t.x - p.px, t.z - p.pz) : 0,
      time: this.timeLeft,
      step: `${this.collected}/${CRATES} crates`,
    };
  }

  get mapView() {
    return {
      ring: this.available ? { x: this.pier.ring.x, z: this.pier.ring.z } : null,
      buoys: this.buoys.filter((b) => !b.got).map((b) => ({ x: b.x, z: b.z })),
      slip: this.state === 'RETURN' ? { x: this.slip.x, z: this.slip.z, r: SLIP_R } : null,
    };
  }

  // Screen label anchor above Pier 1's bollard (null when the job is not on offer).
  get labelPos() {
    return this.available ? { x: this.pier.ring.x, y: 2.6, z: this.pier.ring.z } : null;
  }

  // Called when the player climbs into a boat: boarding Pier 1's Sunrunner is the second way to start the job.
  onBoard(b) {
    if (this.active) {
      this.boarded = true;
      this.boat = b;
      this.abandonT = 0;
    } else if (b.pier === 0 && this.available) {
      this.start();
      this.boarded = true;
      this.boat = b;
    }
  }

  start() {
    const w = this.world;
    this.runs++;
    this.state = 'BRIEF';
    this.briefT = BRIEF_TIME;
    this.collected = 0;
    this.timeLeft = TIME_LIMIT;
    this.abandonT = 0;
    this.boarded = false;
    this.boat = w.player.inCar && w.player.vehicle.isBoat ? w.player.vehicle : this.world.boats.moored[0];
    this._placeBuoys();
    w.missions.marker.visible = false;
    w.emit('cbdStart');
    w.ambientCaption = { text: 'CONTRABAND DROP  -  find 4 crates under the buoys in 2:00', t: BRIEF_TIME + 0.6, color: '#5ee0ff' };
  }

  // Four buoys 140-420 m out to sea, one per sector of the bay, never closer than 95 m to each other.
  _placeBuoys() {
    const rng = makeRng(this.world.layout.seed * 7127 + this.runs * 131 + 3);
    const o = this.pier.ring;
    this.buoys = [];
    const arc = 150 * (Math.PI / 180);
    for (let i = 0; i < CRATES; i++) {
      let pick = null;
      for (let t = 0; t < 60 && !pick; t++) {
        const th = -arc / 2 + ((i + rng()) / CRATES) * arc;
        const d = BUOY_NEAR + rng() * (BUOY_FAR - BUOY_NEAR);
        const x = o.x + Math.sin(th) * d, z = o.z + Math.cos(th) * d;
        if (z < 400 || this.world.boats.shore.pushOut(x, z, 10)) continue;
        if (this.buoys.some((b) => Math.hypot(b.x - x, b.z - z) < MIN_SPACING)) continue;
        pick = { x, z };
      }
      if (!pick) pick = { x: o.x + (i - 1.5) * 110, z: 380 + 80 + i * 70 };
      this.buoys.push({ ...pick, got: false, phase: i * 1.3 });
    }
  }

  _end(ok) {
    this.state = 'IDLE';
    this.cooldown = COOLDOWN;
    this.seen = false;
    this.abandonT = 0;
    this.world.patrol.force = 0;
    this.buoys = [];
    this.imBuoy.count = 0;
  }

  fail(reason) {
    if (!this.active) return;
    this.world.notify(`CONTRABAND LOST: ${reason}`, 'warn');
    this.world.emit('failed');
    this._end(false);
  }

  complete() {
    const w = this.world;
    const pay = this.payout;
    w.cash += pay.total;
    w.wanted.dropStar();
    w.saveRequested = true;
    w.emit('mission');
    w.notify(`CONTRABAND DELIVERED  +$${pay.total.toLocaleString('en-US')}`, 'mission');
    w.armoredResult = { lines: pay.lines, total: pay.total, title: 'CONTRABAND DELIVERED' };
    this._end(true);
  }

  // Arrested or wasted: the job is off.
  onPlayerDown() {
    if (this.active) this.fail('you were taken in');
    this.boat = null;
  }

  _collect(b) {
    const w = this.world;
    b.got = true;
    this.collected++;
    w.emit('cratePing');
    w.notify(`CRATE ${this.collected}/${CRATES} SECURED`, 'info');
    if (this.collected === 1) w.wanted.raiseTo(1);
    if (this.collected === 2) {
      w.wanted.raiseTo(2);
      w.patrol.force = 1;
      w.patrol.spawn(160, 0);
      w.notify('Harbor Patrol has you on radar!', 'warn');
    }
    if (this.collected >= CRATES) {
      this.state = 'RETURN';
      w.wanted.raiseTo(3);
      w.patrol.force = 2;
      w.patrol.spawn(150, 1);
      w.notify("All crates aboard! Run for Smuggler's Cove Slip", 'info');
    }
  }

  update(dt) {
    this.time += dt;
    const w = this.world, p = w.player;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const pb = p.inCar && p.vehicle.isBoat ? p.vehicle : null;
    if (this.state === 'IDLE') {
      if (this.available) {
        const r = this.pier.ring;
        if (!p.inCar && Math.hypot(p.x - r.x, p.z - r.z) < RING_R && p.y < 1.5) this.start();
        else if (!this.seen && Math.hypot(p.px - r.x, p.pz - r.z) < 70) {
          this.seen = true;
          w.ambientCaption = { text: '[CONTRABAND] Pier 1: step into the cyan ring', t: 3.2, color: '#5ee0ff' };
        }
      }
    } else if (!w.fx) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.fail('time ran out');
      } else if (this.boat && this.boat.hp <= 0) {
        this.fail('the hull went down');
      }
      if (this.active && this.state === 'BRIEF') {
        this.briefT -= dt;
        if (this.briefT <= 0) this.state = 'COLLECTING';
      }
      if (this.active) {
        if (pb) {
          this.boarded = true;
          this.boat = pb;
          this.abandonT = 0;
        } else if (this.boarded) {
          this.abandonT += dt;
          if (this.abandonT >= ABANDON_LIMIT) this.fail('you left the boat');
        }
      }
      if (this.active && pb) {
        if (this.state !== 'RETURN') {
          for (const b of this.buoys) {
            if (!b.got && Math.hypot(b.x - pb.x, b.z - pb.z) < PICKUP_R) this._collect(b);
          }
        } else {
          const s = this.slip;
          if (Math.hypot(pb.x - s.x, pb.z - s.z) < SLIP_R && Math.abs(pb.speedF) < SLIP_SPEED) this.complete();
        }
      }
    }
    this._draw();
  }

  _draw() {
    const w = this.world;
    const t = this.time;
    const blink = 0.9 + 0.9 * (Math.sin(t * 6) * 0.5 + 0.5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    let nb = 0;
    for (const b of this.buoys) {
      if (b.got) continue;
      const y = seaHeight(b.x, b.z, w.env.time) + 0.1;
      e.set(Math.sin(t * 1.3 + b.phase) * 0.06, t * 0.2, Math.cos(t * 1.1 + b.phase) * 0.06);
      q.setFromEuler(e);
      m.compose(pos.set(b.x, y, b.z), q, sc.set(1, 1, 1));
      this.imBuoy.setMatrixAt(nb, m);
      const k = 0.85 + 0.9 * Math.max(0, Math.sin(t * 5 + b.phase));
      this.imBuoy.setColorAt(nb, col.setRGB(k, k, k * 1.05));
      nb++;
    }
    this.imBuoy.count = nb;
    this.imBuoy.visible = nb > 0;
    if (nb) {
      this.imBuoy.instanceMatrix.needsUpdate = true;
      this.imBuoy.instanceColor.needsUpdate = true;
    }
    let nm = 0;
    const pulse = 1 + Math.sin(t * 4) * 0.05;
    if (this.available) {
      const r = this.pier.ring;
      m.compose(pos.set(r.x, this.pier.top + 0.02, r.z), q.identity(), sc.set(RING_R * pulse, 0.35, RING_R * pulse));
      this.imMark.setMatrixAt(nm, m);
      this.imMark.setColorAt(nm, col.setRGB(0.35, 0.95, 1.1));
      nm++;
    }
    if (this.state === 'RETURN') {
      const s = this.slip;
      m.compose(pos.set(s.x, seaHeight(s.x, s.z, w.env.time) + 0.05, s.z), q.identity(), sc.set(SLIP_R * pulse, 1.6, SLIP_R * pulse));
      this.imMark.setMatrixAt(nm, m);
      this.imMark.setColorAt(nm, col.setRGB(1.2, 0.85, 0.2));
      nm++;
    }
    this.imMark.count = nm;
    this.imMark.visible = nm > 0;
    if (nm) {
      this.imMark.instanceMatrix.needsUpdate = true;
      this.imMark.instanceColor.needsUpdate = true;
    }
  }
}
