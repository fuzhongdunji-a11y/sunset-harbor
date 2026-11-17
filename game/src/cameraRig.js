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
    this.fov = 64;
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
    const lookX = mouse.dx * LOOK_SENS;
    const lookY = mouse.dy * LOOK_SENS;
    const desired = new THREE.Vector3();
    let focusY = 1.5;
    let pivot;
    let dist;
    let fovTarget = 64;

    if (mode === 'car') {
      const v = player.vehicle;
      this.carYaw = angleLerp(this.carYaw, v.h, Math.min(1, 4.5 * dt));
      if (lookX !== 0 || lookY !== 0) {
        this.yawOffset -= lookX;
        this.pitch = Math.min(1.1, Math.max(0.02, this.pitch + lookY * 0.7));
        this.idle = 0;
      } else {
        this.idle += dt;
        if (this.idle > 1.4) {
          this.yawOffset *= Math.exp(-2.5 * dt);
          this.pitch += (0.2 - this.pitch) * Math.min(1, 2 * dt);
        }
      }
      this.yaw = this.carYaw + this.yawOffset;
      const speed = Math.abs(v.speedF);
      dist = 5.6 + Math.min(speed, 40) * 0.05;
      focusY = 1.3;
      pivot = new THREE.Vector3(v.x + Math.sin(v.h) * 3, v.y + focusY, v.z + Math.cos(v.h) * 3);
      fovTarget = 62 + Math.min(speed, 45) * 0.38;
      this.shake = Math.max(this.shake, Math.min(0.5, v.impact * 0.035));
    } else {
      this.yaw -= lookX;
      this.pitch = Math.min(1.2, Math.max(-0.15, this.pitch + lookY));
      dist = 4.6;
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
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-7 * dt);
    }
    cam.lookAt(this.target);
    this.fov += (fovTarget - this.fov) * Math.min(1, 3 * dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
