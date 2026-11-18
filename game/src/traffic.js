// traffic: civilian cars that cruise the lanes of Costa Serena. The fleet is recycled around the player so density stays constant.
import { RoadDriver } from './roadDriver.js';
import { PAINTS } from './vehicleModels.js';
import { DIRS } from './roadNet.js';

const TYPES = [['marlin', 0.3], ['pico', 0.26], ['dune', 0.18], ['harborVan', 0.16], ['vesper', 0.1]];
const RECYCLE = 240;

export function spotFree(vehicles, x, z, radius) {
  for (const v of vehicles) {
    const r = v.kind === 'parked' ? 2.8 : radius; // curb-parked cars sit beside the lane, not in it
    if (Math.hypot(v.x - x, v.z - z) < r) return false;
  }
  return true;
}

export class Traffic {
  constructor(vm, net, rng) {
    this.vm = vm;
    this.net = net;
    this.rng = rng;
    this.cars = []; // {v, drv}
  }

  _pickType() {
    let r = this.rng();
    for (const [k, w] of TYPES) if ((r -= w) <= 0) return k;
    return 'marlin';
  }

  // Driver temperament: vans and pickups dawdle, the coupe runs hot, and about one in six sedans/hatches are in a hurry.
  _pickCruise(type) {
    const r = this.rng;
    if (type === 'harborVan') return r.range(8, 11);
    if (type === 'dune') return r.range(9, 13);
    if (type === 'vesper') return r.range(13.5, 17.5);
    const k = r();
    if (k < 0.18) return r.range(7.5, 9.5); // cautious
    if (k > 0.84) return r.range(15, 18); // in a hurry
    return r.range(10, 14.5);
  }

  // Find a free lane spot between minD and maxD metres from the focus.
  findSpot(focus, minD, maxD) {
    for (let t = 0; t < 40; t++) {
      const s = this.net.randomLane(this.rng);
      const d = Math.hypot(s.x - focus.x, s.z - focus.z);
      if (d < minD || d > maxD) continue;
      if (!spotFree(this.vm.list, s.x, s.z, 11)) continue;
      return s;
    }
    return null;
  }

  populate(count, focus) {
    for (let n = 0; n < count; n++) {
      const s = this.findSpot(focus, 25, 230);
      if (s) this.spawnAt(s.i, s.j, s.d, s.x, s.z);
    }
  }

  spawnAt(i, j, d, x, z, type = this._pickType()) {
    const v = this.vm.spawn(type, this.rng.pick(PAINTS), x, z, DIRS[d].h, 'traffic');
    const drv = new RoadDriver(v, this.net, this.rng, { cruise: this._pickCruise(type) });
    const along = (x - this.net.xs[i]) * DIRS[d].x + (z - this.net.zs[j]) * DIRS[d].z;
    drv.place(i, j, d, along);
    this.cars.push({ v, drv });
    return v;
  }

  // Move every car to a fresh spot around the focus (after the player teleported, e.g. loading a save).
  scatter(focus) {
    for (const c of this.cars) {
      const s = this.findSpot(focus, 25, 200);
      if (s) c.drv.place(s.i, s.j, s.d, (s.x - this.net.xs[s.i]) * DIRS[s.d].x + (s.z - this.net.zs[s.j]) * DIRS[s.d].z);
    }
  }

  // Take a car out of traffic (the player hijacked it). Returns true when it was an AI civilian.
  release(vehicle) {
    const k = this.cars.findIndex((c) => c.v === vehicle);
    if (k < 0) return false;
    this.cars.splice(k, 1);
    vehicle.driver = null;
    vehicle.kind = 'parked';
    vehicle.input.throttle = 0;
    vehicle.input.steer = 0;
    return true;
  }

  update(dt, ctx, focus) {
    for (const c of this.cars) {
      c.drv.update(dt, ctx);
      const v = c.v;
      if (Math.abs(v.x - focus.x) > RECYCLE || Math.abs(v.z - focus.z) > RECYCLE) {
        const s = this.findSpot(focus, 110, 210);
        if (s) {
          c.drv.place(s.i, s.j, s.d, (s.x - this.net.xs[s.i]) * DIRS[s.d].x + (s.z - this.net.zs[s.j]) * DIRS[s.d].z);
          v.steer = 0;
        }
      }
    }
  }
}
