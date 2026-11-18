// police: patrol cruisers that spawn at 1-5 stars, chase the player along the roads, ram when close, and arrest ("busted") on contact.
import { RoadDriver } from './roadDriver.js';
import { DIRS, LANE } from './roadNet.js';
import { spotFree } from './traffic.js';

const COPS_FOR_STARS = [0, 2, 2, 3, 4, 5];
const BUST_TIME = 2.2;
const BUST_RANGE = 7;

export class Police {
  constructor(vm, net, rng, collision) {
    this.vm = vm;
    this.net = net;
    this.rng = rng;
    this.collision = collision;
    this.cops = []; // {v, drv, chasing}
    this.spawnT = 0.4;
    this.bust = 0;
    this.time = 0;
    this.nearest = Infinity;
    this.chaseCruise = 26;
    this.sealed = false; // the player is inside the Solaris Customs bay: no arrests, no ramming
    this.suppress = false; // Signal Intercept in progress: the first star draws a single, distant patrol (see update)
  }

  get bustProgress() {
    return Math.min(1, this.bust / BUST_TIME);
  }

  _lineClear = (x0, z0, x1, z1) => {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / 3);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (this.collision.pushOut(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 1.3)) return false;
    }
    return true;
  };

  // Place a cruiser on the lane of the segment leaving (i, j) in direction d.
  spawnAt(i, j, d, along, chasing = true) {
    const p = this.net.lanePoint(i, j, d, along, LANE);
    const v = this.vm.spawn('patrol', 0xf4f1ea, p.x, p.z, DIRS[d].h, 'police');
    v.locked = true;
    const drv = new RoadDriver(v, this.net, this.rng, { cruise: chasing ? 26 : 12, chase: chasing });
    drv.place(i, j, d, along);
    const cop = { v, drv, chasing };
    this.cops.push(cop);
    return cop;
  }

  _spawnNearPlayer(player, camFwd, minDist = 90) {
    const px = player.px, pz = player.pz;
    let best = null, bs = -Infinity;
    for (let t = 0; t < 24; t++) {
      const s = this.net.randomLane(this.rng);
      const dx = px - s.x, dz = pz - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist || dist > minDist + 80 || !spotFree(this.vm.list, s.x, s.z, 12)) continue;
      const toward = (DIRS[s.d].x * dx + DIRS[s.d].z * dz) / dist;
      const behindCam = camFwd ? (-(dx * camFwd.x + dz * camFwd.z)) / dist : 0; // spot behind the camera is unseen
      const score = toward * 2 + behindCam * 1.4 - Math.abs(dist - (minDist + 30)) / 60;
      if (score > bs) { bs = score; best = s; }
    }
    if (best) {
      const along = (best.x - this.net.xs[best.i]) * DIRS[best.d].x + (best.z - this.net.zs[best.j]) * DIRS[best.d].z;
      this.spawnAt(best.i, best.j, best.d, along);
    }
  }

  _remove(cop) {
    this.vm.remove(cop.v);
    this.cops.splice(this.cops.indexOf(cop), 1);
  }

  // ctx: {vehicles, points}; returns 'busted' when the player was arrested this frame.
  update(dt, ctx, player, wanted, camFwd) {
    this.time += dt;
    const stars = wanted.stars;
    // the hotter the chase the harder they push (25.8 m/s at 1 star .. 33 m/s at 5, always under the player's Marlin top speed)
    this.chaseCruise = 24 + 1.8 * stars;
    const px = player.px, pz = player.pz;
    const pv = player.vehicle;
    const target = {
      x: px, z: pz,
      vx: pv ? pv.vx : player.vx, vz: pv ? pv.vz : player.vz,
      speed: pv ? Math.abs(pv.speedF) : Math.hypot(player.vx, player.vz),
    };
    const cctx = { ...ctx, target, lineClear: this._lineClear, ignore: pv };

    // spawn / stand down
    const chasing = this.cops.filter((c) => c.chasing).length;
    this.spawnT -= dt;
    // while a Signal Intercept runs, one star means a single patrol that arrives late; from two stars the job fails anyway
    const copsWanted = this.suppress && stars <= 1 ? 1 : COPS_FOR_STARS[stars];
    if (stars > 0 && chasing < copsWanted && this.spawnT <= 0) {
      this.spawnT = this.suppress ? 6 : Math.max(1.2, 2.5 - 0.3 * stars); // reinforcements arrive faster at high levels
      this._spawnNearPlayer(player, camFwd, this.suppress ? 130 : 90);
    }
    this.nearest = Infinity;
    let close = 0;
    for (const cop of [...this.cops]) {
      const v = cop.v;
      const dist = Math.hypot(v.x - px, v.z - pz);
      if (stars > 0 && !cop.chasing) {
        cop.chasing = true;
        cop.drv.chase = true;
        cop.drv.cruise = this.chaseCruise;
        cop.drv.snapToRoad();
      } else if (stars === 0 && cop.chasing) {
        cop.chasing = false;
        cop.drv.chase = false;
        cop.drv.direct = false;
        cop.drv.cruise = 12;
        cop.drv.snapToRoad();
      } else if (cop.chasing) {
        cop.drv.cruise = this.chaseCruise;
      }
      if (cop.chasing && dist > 330) {
        this._remove(cop);
        continue;
      }
      if (!cop.chasing && dist > 130) {
        this._remove(cop);
        continue;
      }
      cop.drv.update(dt, cctx);
      this.nearest = Math.min(this.nearest, dist);
      if (cop.chasing && dist < BUST_RANGE) close++;

      // siren
      const on = cop.chasing;
      const ph = Math.floor((this.time + cop.v.x * 0.01) * 7) % 2 === 0;
      v.lights.red.material.color.setHex(on && ph ? 0xff2a2a : 0x4a0d0d);
      v.lights.blue.material.color.setHex(on && !ph ? 0x3a78ff : 0x0e1f4a);

      // contact with the player: shove and slow them down
      if (pv && v.contact === pv && !this.sealed) {
        pv.vx *= Math.exp(-1.1 * dt * pv.ramMul);
        pv.vz *= Math.exp(-1.1 * dt * pv.ramMul);
        if (v.impact + pv.impact > 3.5) wanted.commit('ramPolice');
      }
    }

    // arrest: surrounded and slow
    const slow = pv ? Math.abs(pv.speedF) < 6.5 : true;
    if (stars > 0 && close > 0 && slow && !this.sealed) this.bust += dt * (1 + 0.3 * (close - 1));
    else this.bust = Math.max(0, this.bust - dt * 1.2);
    if (this.bust >= BUST_TIME) {
      this.bust = 0;
      return 'busted';
    }
    return null;
  }

  // Put `n` extra cruisers on the road around the player right now (an interception), without waiting for the spawn timer.
  scramble(player, n, camFwd) {
    for (let k = 0; k < n; k++) this._spawnNearPlayer(player, camFwd, 75);
    this.spawnT = 2;
  }

  // Remove every cruiser (after a bust/wasted respawn).
  clearAll() {
    for (const c of [...this.cops]) this._remove(c);
    this.bust = 0;
  }
}
