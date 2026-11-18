// AmbientDirector: schedules the free-roam city events. One event at a time, a 60 s first delay then 240 s between events, only while the player is not on a job
// and has at most 1 star. Picks a straight stretch of road 110-160 m ahead of the player's heading and hands it to the event (see TunerBreakdownEvent.js).
// Events register themselves by name (TUNER and HAULER today); the first pick is 50/50, after that the other event comes up 80% of the time (see _pickKind).
import { DIRS, rightOf } from '../roadNet.js';

export const FIRST_DELAY = 60;
export const COOLDOWN = 240;
const CHECK_EVERY = 1; // seconds between gate checks once the timer has run out
const RETRY_NO_ROAD = 2; // ... and when no road fits the cone
const AFTER_MISSION = 5; // spawning waits this long after a job ends
const MIN_AHEAD = 110;
const MAX_AHEAD = 160;
const CONE_COS = Math.cos((35 * Math.PI) / 180);
const ALONG = [20, 28, 36, 44, 52, 60]; // metres from the junction: at least 18 m clear of both ends of an 80 m block
const SEA_LIMIT = 345 + 30; // not further than 30 m into the water
const ALIGNED_COS = Math.cos((25 * Math.PI) / 180); // an event flagged `aligned` needs a road within 25 degrees of the player's heading

// A curb spot on the right-hand side of the segment leaving node (i, j) in direction d, `along` metres from the node.
export function makeSpot(net, i, j, d, along, curb) {
  const p = net.lanePoint(i, j, d, along, curb);
  return { i, j, d, along, x: p.x, z: p.z, h: DIRS[d].h, right: rightOf(d) };
}

export class AmbientDirector {
  constructor(world, scene, rng) {
    this.world = world;
    this.scene = scene;
    this.rng = rng;
    this.kinds = new Map(); // name -> {create(world, scene, spot, rng), curb, fits(world, spot)}
    this.timer = FIRST_DELAY;
    this.checkT = 0;
    this.holdoff = 0;
    this.wasBusy = false;
    this.active = null;
    this.activeName = null;
    this.last = null;
  }

  register(name, def) {
    this.kinds.set(name, def);
  }

  // True while the player is committed to a job (a running clock, a later step, the intercept or the armored truck).
  get missionBusy() {
    const w = this.world, m = w.missions;
    return m.stepIndex > 0 || m.timeLeft !== null || w.intercept.active || w.armored.active;
  }

  get event() {
    return this.active;
  }

  // Heading the player is moving or looking along, as a unit vector.
  _heading() {
    const w = this.world, p = w.player;
    if (p.vehicle) return { x: Math.sin(p.vehicle.h), z: Math.cos(p.vehicle.h) };
    return { x: Math.sin(w.rig.yaw), z: Math.cos(w.rig.yaw) };
  }

  _pickKind() {
    const names = [...this.kinds.keys()];
    if (names.length < 2 || !this.last) return names[this.rng.int(0, names.length - 1)];
    const others = names.filter((n) => n !== this.last);
    return this.rng() < 0.8 ? others[this.rng.int(0, others.length - 1)] : this.last;
  }

  // A fitting curb spot inside the forward cone, or null.
  findSpot(def) {
    const w = this.world, p = w.player, net = w.net;
    const H = this._heading();
    const px = p.px, pz = p.pz;
    const found = [];
    for (let i = 0; i < net.ni; i++) {
      for (let j = 0; j < net.nj; j++) {
        for (let d = 0; d < 4; d++) {
          if (!net.step(i, j, d)) continue;
          if (def.aligned && DIRS[d].x * H.x + DIRS[d].z * H.z < ALIGNED_COS) continue; // the Stunt Hauler drives away along the player's own heading
          for (const along of ALONG) {
            const s = makeSpot(net, i, j, d, along, def.curb);
            const dx = s.x - px, dz = s.z - pz;
            const dist = Math.hypot(dx, dz);
            if (dist < MIN_AHEAD || dist > MAX_AHEAD || (dx * H.x + dz * H.z) / dist < CONE_COS) continue;
            found.push(s);
          }
        }
      }
    }
    // shuffle (seeded), then take the first that fits the ground
    for (let k = found.length - 1; k > 0; k--) {
      const r = this.rng.int(0, k);
      [found[k], found[r]] = [found[r], found[k]];
    }
    return found.find((s) => def.fits(w, s)) ?? null;
  }

  _trySpawn() {
    const w = this.world;
    if (w.wanted.stars > 1 || w.player.pz > SEA_LIMIT) return 'gate';
    const name = this._pickKind();
    const def = this.kinds.get(name);
    if (!def) return 'gate';
    const spot = this.findSpot(def);
    if (!spot) return 'road';
    this._start(name, spot);
    return 'ok';
  }

  _start(name, spot) {
    const def = this.kinds.get(name);
    this.active = def.create(this.world, this.scene, spot, this.rng);
    this.activeName = name;
    this.last = name;
  }

  // Showcase and test hook: spawn an event right now on a given spot, ignoring every gate.
  forceSpawn(name, spot) {
    if (this.active) this._finish();
    this._start(name, spot);
    return this.active;
  }

  _finish() {
    if (this.active) this.active.dispose();
    this.active = null;
    this.activeName = null;
    this.timer = COOLDOWN;
    this.checkT = 0;
  }

  // AI hook (game time, before the physics sub-steps) and per-sub-step hook for the active event, if it has them.
  drive(dt, ctx) {
    this.active?.drive?.(dt, ctx);
  }

  step(h) {
    this.active?.step?.(h);
  }

  // dt is real time: the cooldown and the events' own clocks do not slow down with the stunt slow-motion (events read world.timeScale when they need game time).
  update(dt, input) {
    const w = this.world;
    const busy = this.missionBusy;
    if (this.wasBusy && !busy) this.holdoff = AFTER_MISSION;
    if (busy && !this.wasBusy && this.active) this._finish(); // a job started: the event cleans up (a tuner the player already took stays with them)
    this.wasBusy = busy;
    if (this.holdoff > 0) this.holdoff -= dt;

    if (this.active) {
      if (!this.active.update(dt, input)) this._finish();
      return;
    }
    if (busy || w.fx) return; // the cooldown only runs in free roam, not while arrested or wasted
    if (this.timer > 0) {
      this.timer -= dt;
      return;
    }
    if (this.holdoff > 0) return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    const r = this._trySpawn();
    this.checkT = r === 'road' ? RETRY_NO_ROAD : CHECK_EVERY;
  }
}
