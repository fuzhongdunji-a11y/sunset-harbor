// cameraRig: third-person camera with mouse look on foot and a speed-aware chase camera in cars.
import * as THREE from '../vendor/three.module.min.js';
import { angleLerp } from './player.js';

const LOOK_SENS = 0.0024;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI; // direction the camera looks along (forward = (sin yaw, cos yaw))
    this.pitch = 0.3;
    this.dist = 5;
    this.carYaw = Math.PI;
    this.yawOffset = 0;
    this.idle = 0;
    this.blend = 0;
    this.lastMode = 'foot';
    this.shake = 0;
    this.time = 0;
    this.lead = 0; // smoothed corner / slide look-ahead, radians
    this.fov = 64;
    this.aid = null; // {x, z}: a point to keep in frame while driving (the Signal Intercept quarry); set by the world every frame
    this.aidW = 0; // how strongly the aid applies, eased in and out
    this.lastAid = null;
    this.pos = new THREE.Vector3(0, 5, 0);
    this.target = new THREE.Vector3();
  }

  // Jump straight to the position the rig would settle at (used by shot mode and teleports).
  snap(player, collision) {
    this.blend = 0;
    for (let i = 0; i < 90; i++) this.update(1 / 60, player, { dx: 0, dy: 0 }, collision, true);
  }

  update(dt, player, mouse, collision, instant = false) {
    const cam = this.camera;
    const mode = player.mode;
    if (mode !== this.lastMode) {
      this.blend = 0.7;
      if (mode === 'car') {
        this.carYaw = this.yaw;
        this.yawOffset = 0;
      } else {
        this.yaw = this.carYaw + this.yawOffset;
      }
      this.lastMode = mode;
    }
    this.blend = Math.max(0, this.blend - dt);
    this.time += dt;
    const lookX = mouse.dx * LOOK_SENS;
    const lookY = mouse.dy * LOOK_SENS;
    const desired = new THREE.Vector3();
    let focusY = 1.5;
    let pivot;
    let dist;
    let fovTarget = 64;

    if (mode === 'car') {
      const v = player.vehicle;
      const speed = Math.abs(v.speedF);
      // look where the car is going: lean into the steering and follow the slide, faded in with speed so crawling stays steady
      const fast = Math.min(1, speed / 14);
      let slide = 0;
      if (v.speedF > 3) slide = angleLerp(0, Math.atan2(v.vx, v.vz) - v.h, 1);
      const leadTarget = (v.steer * 0.45 + Math.max(-0.5, Math.min(0.5, slide)) * 0.5) * fast;
      this.lead += (leadTarget - this.lead) * Math.min(1, 3 * dt);
      this.carYaw = angleLerp(this.carYaw, v.h + this.lead, Math.min(1, 4.2 * dt));
      if (lookX !== 0 || lookY !== 0) {
        this.yawOffset -= lookX;
        this.pitch = Math.min(1.1, Math.max(0.02, this.pitch + lookY * 0.7));
        this.idle = 0;
      } else {
        this.idle += dt;
        if (this.idle > 1.4) {
          this.yawOffset *= Math.exp(-2.5 * dt);
          this.pitch += ((v.isBoat ? 0.3 : 0.2) - this.pitch) * Math.min(1, 2 * dt);
        }
      }
      this.yaw = this.carYaw + this.yawOffset;
      dist = v.isBoat ? 11.5 + Math.min(speed, 40) * 0.03 : 5.6 + Math.min(speed, 40) * 0.05; // a boat needs more room: long hull, wide wake
      focusY = v.isBoat ? 1.5 : 1.3;
      pivot = new THREE.Vector3(v.x + Math.sin(v.h) * 3, v.y + focusY, v.z + Math.cos(v.h) * 3);
      fovTarget = v.isBoat ? 62 + 9 * Math.min(1, speed / 34) + (v.boostT > 0 ? 4 : 0) : 62 + 17 * (1 - Math.exp(-speed / 24)); // eases out: the first burst of speed widens the view most; boats kick +9 deg at full plane
      // tailing a target: slide the pivot toward it so it stays on screen, and pull back / widen when it is close so both cars fit
      if (this.aid) this.lastAid = this.aid;
      this.aidW += ((this.aid ? 1 : 0) - this.aidW) * Math.min(1, 2.5 * dt);
      if (this.lastAid && this.aidW > 0.01) {
        const ax = this.lastAid.x - v.x, az = this.lastAid.z - v.z;
        const ad = Math.max(0.5, Math.hypot(ax, az));
        const shift = Math.min(3.5, ad * 0.1) * this.aidW;
        pivot.x += (ax / ad) * shift;
        pivot.z += (az / ad) * shift;
        const close = (1 - Math.min(1, ad / 40)) * this.aidW;
        dist += close * 2.4;
        fovTarget += close * 5;
      }
      // small, capped, smoothly decaying knock on a real hit (no per-frame random jitter)
      if (v.impact > 3) this.shake = Math.max(this.shake, Math.min(0.16, (v.impact - 2) * 0.012));
    } else {
      this.yaw -= lookX;
      this.pitch = Math.min(1.2, Math.max(-0.15, this.pitch + lookY));
      const run = Math.min(1, player.speed / 7.5);
      dist = 4.6 + run * 0.35;
      fovTarget = 64 + run * 4;
      pivot = new THREE.Vector3(player.x, player.y + player.jump * 0.6 + focusY, player.z);
    }

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    // pull the camera in when buildings are in the way
    let useDist = dist;
    for (let t = 0.15; t <= 1.001; t += 0.1) {
      const px = pivot.x + dir.x * dist * t, pz = pivot.z + dir.z * dist * t, py = pivot.y + dir.y * dist * t;
      const hit = collision.pushOut(px, pz, 0.45);
      if (hit && hit.h > py) {
        useDist = Math.max(1.4, dist * (t - 0.1));
        break;
      }
    }
    this.dist += (useDist - this.dist) * (useDist < this.dist ? 1 : Math.min(1, 6 * dt));
    desired.copy(pivot).addScaledVector(dir, this.dist);
    desired.y = Math.max(desired.y, 0.6);

    const k = instant ? 1 : 1 - Math.exp(-dt * (this.blend > 0 ? 5 : mode === 'car' ? 16 : 22));
    this.pos.lerp(desired, k);
    this.target.lerp(pivot, instant ? 1 : 1 - Math.exp(-dt * 20));
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      cam.position.x += Math.sin(this.time * 47) * this.shake;
      cam.position.y += Math.sin(this.time * 61 + 1.3) * this.shake * 0.6;
      this.shake *= Math.exp(-9 * dt);
    }
    cam.lookAt(this.target);
    this.fov += (fovTarget - this.fov) * Math.min(1, 2.5 * dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
