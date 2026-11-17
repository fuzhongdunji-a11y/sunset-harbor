// player: on-foot character control (walk, sprint, jump, collisions) plus entering and leaving vehicles.
import { buildPerson } from './characters.js';

const RADIUS = 0.4;
const WALK = 4.6;
const SPRINT = 8.2;

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Player {
  constructor(scene, x, z, heading) {
    this.x = x;
    this.z = z;
    this.y = 0.16;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.jump = 0; // height above ground
    this.vy = 0;
    this.mode = 'foot'; // 'foot' | 'car'
    this.vehicle = null;
    this.speed = 0;
    this.person = buildPerson();
    this.person.group.position.set(x, this.y, z);
    scene.add(this.person.group);
  }

  get inCar() {
    return this.mode === 'car';
  }

  // Position used by the camera, HUD and minimap whichever mode we are in.
  get px() {
    return this.vehicle ? this.vehicle.x : this.x;
  }

  get pz() {
    return this.vehicle ? this.vehicle.z : this.z;
  }

  get facing() {
    return this.vehicle ? this.vehicle.h : this.heading;
  }

  enter(vehicle) {
    this.mode = 'car';
    this.vehicle = vehicle;
    vehicle.driver = this;
    this.person.group.visible = false;
    this.vx = this.vz = 0;
  }

  // Step out next to the car on the first free side; returns false when boxed in.
  exit(collision, vehicles) {
    const v = this.vehicle;
    if (!v) return false;
    const hw = v.type.wid / 2 + 0.85;
    const hl = v.type.len / 2 + 0.9;
    const lx = Math.cos(v.h), lz = -Math.sin(v.h); // left
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const spots = [
      [lx * hw, lz * hw], [-lx * hw, -lz * hw], [fx * hl, fz * hl], [-fx * hl, -fz * hl],
      [lx * (hw + 1), lz * (hw + 1)], [-lx * (hw + 1), -lz * (hw + 1)],
    ];
    for (const [ox, oz] of spots) {
      const x = v.x + ox, z = v.z + oz;
      if (collision.isFree(x, z, RADIUS) && !vehicles.pushOutCircle(x, z, RADIUS)) {
        this.x = x;
        this.z = z;
        this.heading = Math.atan2(ox, oz);
        this.y = v.y;
        v.driver = null;
        v.input.throttle = 0;
        v.input.hand = false;
        this.vehicle = null;
        this.mode = 'foot';
        this.person.group.visible = true;
        return true;
      }
    }
    return false;
  }

  updateFoot(dt, input, camYaw, collision, vehicles, groundHeightAt) {
    const fwd = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    const side = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const s = Math.sin(camYaw), c = Math.cos(camYaw);
    let dx = s * fwd + -c * side; // camera forward + camera right (-cos, sin)
    let dz = c * fwd + s * side;
    const len = Math.hypot(dx, dz);
    const top = input.down('ShiftLeft', 'ShiftRight') ? SPRINT : WALK;
    let tx = 0, tz = 0;
    if (len > 0.01) {
      tx = (dx / len) * top;
      tz = (dz / len) * top;
      this.heading = angleLerp(this.heading, Math.atan2(dx, dz), Math.min(1, 14 * dt));
    }
    const k = Math.min(1, 16 * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    for (let i = 0; i < 3; i++) {
      const hit = collision.pushOut(this.x, this.z, RADIUS) || vehicles.pushOutCircle(this.x, this.z, RADIUS);
      if (!hit) break;
      this.x += hit.nx * hit.depth;
      this.z += hit.nz * hit.depth;
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        this.vx -= vn * hit.nx;
        this.vz -= vn * hit.nz;
      }
    }
    const wall = collision.constrain(this.x, this.z, RADIUS);
    if (wall.hit) {
      this.x = wall.x;
      this.z = wall.z;
    }

    const ground = groundHeightAt(this.x, this.z);
    if (this.jump <= 0 && input.pressed('Space')) this.vy = 6.4;
    if (this.vy !== 0 || this.jump > 0) {
      this.vy -= 20 * dt;
      this.jump += this.vy * dt;
      if (this.jump <= 0) {
        this.jump = 0;
        this.vy = 0;
      }
    }
    this.y += (ground - this.y) * Math.min(1, 18 * dt);
    this.speed = Math.hypot(this.vx, this.vz);
    this.person.animate(dt, this.speed);
    this.person.group.position.set(this.x, this.y + this.jump, this.z);
    this.person.group.rotation.y = this.heading;
  }

  // Keyboard -> vehicle controls while driving.
  updateDriving(input) {
    const v = this.vehicle;
    v.input.throttle = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    v.input.steer = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
    v.input.hand = input.down('Space');
    this.x = v.x;
    this.z = v.z;
    this.y = v.y;
  }
}
