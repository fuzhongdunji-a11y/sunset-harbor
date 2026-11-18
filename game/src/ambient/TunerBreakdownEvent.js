// TunerBreakdownEvent: the Roadside Tuner Breakdown. A neon-violet street tuner sits on the curb with its hood propped open, steam rising, amber hazards blinking,
// and its driver waving beside a cyan ring. On foot, hold E in the ring for 3 s to fix it: +$600 and a Police Vouch. Or steal the car: faster, but the owner calls the cops (+1 star).
// Ignore it and it goes away on its own (90 s or 220 m). The Wanted system locks the repair out at 2+ stars; stealing stays possible.
import * as THREE from '../../vendor/three.module.min.js';
import { MeshBuilder } from '../meshBuilder.js';
import { buildNpc } from '../characters.js';
import { TUNER_VIOLET } from '../vehicleModels.js';
import { angleLerp } from '../player.js';

export const TUNER_CURB = 7.9; // car centre, metres from the road centre line (the kerb is at 9)
const TILT = 0.314; // 18 degrees: nose toward the sidewalk
const REPAIR_TIME = 3;
const RING_R = 1.0;
const LIFETIME = 90;
const LEAVE_DIST = 220;
export const NOTICE_DIST = 140;
const PAY = 600;
const HOOD_OPEN = 0.785;
const STEAM_N = 10;
const STEAM_LIFE = 2.2;

const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
const hazardMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const steamGeo = new THREE.BoxGeometry(1, 1, 1);
const steamMat = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0.65, depthWrite: false });
const ringGeo = new THREE.RingGeometry(0.84, 1.0, 24).rotateX(-Math.PI / 2);
const DRIVER_LOOK = {
  skin: 0xe0ac84, hair: 0x2a1d17, hairStyle: 'cap', shirt: 0x00d8ff, trim: 0xf4f1ea, longSleeve: true,
  pants: 0x1c1c28, shorts: false, shoes: 0xf4f1ea, shades: false, bag: null, height: 1, build: 1, watch: false,
};
const dummy = new THREE.Object3D();
const smooth = (u) => u * u * (3 - 2 * u);

// Where everything stands, from the curb spot alone: the car (nose angled to the sidewalk), the ring ahead of the right front wheel, the driver beside it.
export function tunerGeometry(spot) {
  const h = spot.h - TILT;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = -Math.cos(h), rz = Math.sin(h); // the car's right: toward the sidewalk
  return {
    h, fx, fz, rx, rz,
    ring: { x: spot.x + fx * 2.2 + rx * 2.3, z: spot.z + fz * 2.2 + rz * 2.3 },
    npc: { x: spot.x + fx * 0.5 + rx * 2.4, z: spot.z + fz * 0.5 + rz * 2.4 },
  };
}

// Does a tuner fit at this curb spot? The car, the ring and the driver need open ground (no palms, lamps or walls).
export function tunerFits(world, spot) {
  const g = tunerGeometry(spot);
  const c = world.collision;
  return c.isFree(spot.x, spot.z, 2.3) && c.isFree(g.ring.x, g.ring.z, 1.3) && c.isFree(g.npc.x, g.npc.z, 0.6);
}

export class TunerBreakdownEvent {
  constructor(world, scene, spot) {
    this.world = world;
    this.scene = scene;
    this.spot = spot;
    const g = (this.g = tunerGeometry(spot));
    this.state = 'idle'; // idle -> repaired | stolen
    this.t = 0;
    this.age = 0;
    this.progress = 0;
    this.dist = Infinity;
    this.announced = false;
    this.panicked = false;
    this.steaming = true;
    this.steamAmt = 1;
    this.hazardOn = true;
    this.hazardLit = false; // hazard lamps currently lit (read by the audio for the relay clicks)
    this.ringAlpha = 1;
    this.hood = HOOD_OPEN; // current opening angle
    this.hoodTarget = HOOD_OPEN;
    this.hoodSpeed = 0;
    this.phaseT = 0; // seconds since the repair / theft
    this.merged = false;
    this.npcMode = 'wave'; // wave | hop | shake | flee | gone
    this.npcT = 0;
    this.prompt = '';
    this.promptBar = -1;
    this.axisX = spot.d < 2; // the road runs east-west (the driver flees along x) or north-south (along z)

    // make room: no curb-parked cars on the spot, no civilian traffic within 12 m
    for (const v of [...world.vehicles.list]) {
      if (v.kind === 'parked' && !v.driver && Math.hypot(v.x - spot.x, v.z - spot.z) < 7) world.vehicles.remove(v);
    }
    world.traffic.clearArea(spot.x, spot.z, 12, world.focusPoint);

    const car = (this.car = world.vehicles.spawn('tuner', TUNER_VIOLET, spot.x, spot.z, g.h, 'parked'));
    car.ambientEvent = this;
    this._buildProps(car);

    const y = world.layout.groundHeightAt(g.ring.x, g.ring.z);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x00f6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.position.set(g.ring.x, y + 0.06, g.ring.z);
    this.ring.renderOrder = 2;
    scene.add(this.ring);

    this.steam = new THREE.InstancedMesh(steamGeo, steamMat, STEAM_N);
    this.steam.frustumCulled = false;
    this.steam.renderOrder = 3;
    scene.add(this.steam);

    this.npc = buildNpc(DRIVER_LOOK, 'tunerDriver');
    this.npcPos = { x: g.npc.x, z: g.npc.z, h: Math.atan2(world.player.px - g.npc.x, world.player.pz - g.npc.z) };
    scene.add(this.npc.group);
    this._placeNpc(0);
    this._updateSteam(0);
  }

  // Hood panel on a hinge at the cowl, the engine bay under it, and the amber hazard lamps. All children of the chassis so they roll and pitch with the car.
  _buildProps(car) {
    const hb = new MeshBuilder();
    hb.box(-0.72, 0.0, 0.0, 0.72, 0.05, 1.45, TUNER_VIOLET);
    hb.box(-0.68, -0.03, 0.04, 0.68, 0.0, 1.4, 0x2a2d34);
    this.hoodMesh = new THREE.Mesh(hb.build(), lambert);
    this.hoodMesh.position.set(0, 0.87, 0.5);

    const eb = new MeshBuilder();
    eb.box(-0.66, 0.84, 0.55, 0.66, 0.87, 1.95, 0x1a1c20);
    eb.box(-0.3, 0.87, 1.0, 0.3, 1.22, 1.6, 0x2a2d34);
    eb.box(-0.22, 1.22, 1.05, 0.22, 1.27, 1.55, new THREE.Color(3.0, 1.1, 0.2)); // hot manifold
    eb.box(0.36, 0.87, 0.65, 0.62, 1.0, 0.95, 0x3a5fd0); // coolant tank
    this.engineMesh = new THREE.Mesh(eb.build(), lambert);

    const hl = car.type.len / 2, w = car.type.wid / 2;
    const zb = new MeshBuilder();
    for (const sx of [-1, 1]) {
      zb.box(sx * 0.75 - 0.16, 0.7, hl + 0.18, sx * 0.75 + 0.16, 0.86, hl + 0.22, 0xffaa00);
      zb.box(sx * 0.75 - 0.16, 0.78, -hl - 0.22, sx * 0.75 + 0.16, 0.94, -hl - 0.18, 0xffaa00);
      zb.box(sx * (w + 0.02) - 0.02, 0.62, 0.9, sx * (w + 0.02) + 0.02, 0.72, 1.2, 0xffaa00); // side repeaters
    }
    this.hazardMesh = new THREE.Mesh(zb.build(), hazardMat);
    car.chassis.add(this.hoodMesh, this.engineMesh, this.hazardMesh);
    this.hoodMesh.rotation.x = -HOOD_OPEN;
  }

  // Minimap marker: only while the tuner still needs help and is within notice range.
  get mapIcon() {
    return this.state === 'idle' && this.dist <= NOTICE_DIST ? { x: this.car.x, z: this.car.z } : null;
  }

  get ringCenter() {
    return this.g.ring;
  }

  _placeNpc(jump) {
    const n = this.npcPos;
    this.npc.group.position.set(n.x, this.world.layout.groundHeightAt(n.x, n.z) + jump, n.z);
    this.npc.group.rotation.y = n.h;
  }

  _updateSteam(dt) {
    const car = this.car, g = this.g;
    this.steamAmt += ((this.steaming ? 1 : 0) - this.steamAmt) * Math.min(1, dt * 4);
    const vis = this.steamAmt > 0.02;
    this.steam.visible = vis;
    if (!vis) return;
    const ex = car.x + g.fx * 1.5, ez = car.z + g.fz * 1.5, ey = car.y + 1.25;
    for (let k = 0; k < STEAM_N; k++) {
      const u = ((this.t + k * (STEAM_LIFE / STEAM_N)) % STEAM_LIFE) / STEAM_LIFE;
      const grow = 0.25 + 0.6 * Math.min(1, u / 0.7);
      const fade = u > 0.7 ? 1 - smooth((u - 0.7) / 0.3) : 1;
      dummy.position.set(ex + Math.sin(this.t * 1.7 + k * 1.3) * 0.25 * u, ey + u * 3.6, ez + Math.cos(this.t * 1.3 + k * 2.1) * 0.25 * u);
      dummy.rotation.set(0, this.t * 0.5 + k, 0);
      dummy.scale.setScalar(Math.max(0.001, grow * fade * this.steamAmt));
      dummy.updateMatrix();
      this.steam.setMatrixAt(k, dummy.matrix);
    }
    this.steam.instanceMatrix.needsUpdate = true;
  }

  _closeHood(seconds) {
    this.hoodTarget = 0;
    this.hoodSpeed = HOOD_OPEN / seconds;
  }

  // The player takes the keys (or rams it hard): the owner phones the cops and runs.
  onStolen(entered = true) {
    if (this.state !== 'idle') return;
    const w = this.world;
    this.state = 'stolen';
    this.phaseT = 0;
    this.steaming = false;
    this.hazardOn = false;
    this.progress = 0;
    this._closeHood(0.2);
    this.npcMode = 'shake';
    this.npcT = 0;
    this.car.ambientEvent = null;
    w.wanted.raiseTo(Math.min(5, w.wanted.stars + 1)); // a banked Police Vouch forgives this star 0.6 s later (see wanted.js)
    w.notify(entered ? 'The owner is calling the cops!' : 'You wrecked his ride! The owner is calling the cops!', 'warn');
    w.emit('ambSteal');
  }

  _complete() {
    const w = this.world;
    this.state = 'repaired';
    this.phaseT = 0;
    this.steaming = false;
    this.hazardOn = false;
    this.progress = 1;
    this._closeHood(0.35);
    this.npcMode = 'hop';
    this.npcT = 0;
    this.car.ambientEvent = null; // from here on it is an ordinary parked car until it merges into traffic
    w.cash += PAY;
    w.saveRequested = true;
    w.notify(`ROADSIDE ASSIST  +$${PAY}`, 'escape');
    w.emit('ambRepair');
    const r = w.wanted.grantVouch();
    if (r === 'cleared') {
      w.notify('POLICE VOUCH USED: HEAT CLEARED', 'vouch');
      w.emit('escaped');
    } else if (r === 'banked') {
      w.notify('POLICE VOUCH x1: your next star is forgiven', 'vouch');
    }
  }

  _panic() {
    this.panicked = true;
    this.progress = 0;
    this.npcMode = 'flee';
    this.npcT = 0;
  }

  // Waiting for help: caption, ram check, hold-to-repair with its prompt.
  _waiting(dt, input) {
    const w = this.world, p = w.player, car = this.car;
    if (w.wanted.stars >= 2 && !this.panicked) this._panic();
    if (!this.announced && this.dist <= NOTICE_DIST) {
      this.announced = true;
      w.ambientCaption = { text: '[AMBIENT] Stranded Street Tuner', t: 3 };
    }
    if (car.hitSpeed >= 15 && car.hitBy?.driver?.isPlayer) {
      this.onStolen(false); // rammed hard: same as a theft
      return;
    }
    car.hitSpeed = 0;
    car.hitBy = null;

    const c = this.g.ring;
    const dr = Math.hypot(p.x - c.x, p.z - c.z);
    const inRing = !p.inCar && dr <= RING_R && p.speed < 1.0 && !this.panicked;
    if (inRing && input.down('KeyE')) this.progress = Math.min(1, this.progress + dt / REPAIR_TIME);
    else this.progress = Math.max(0, this.progress - dt);
    if (!this.panicked && !p.inCar && dr < 4.5) {
      if (this.progress > 0.01) {
        this.prompt = `[E] Fix coolant line  ${Math.round(this.progress * 100)}%`;
        this.promptBar = this.progress;
      } else {
        this.prompt = dr <= RING_R ? '[E] Hold to fix the coolant line   +$600 +Police Vouch' : 'Step into the cyan ring to help';
      }
    }
    if (this.progress >= 1) this._complete();
  }

  _animateNpc(dt) {
    const n = this.npcPos, rig = this.npc, p = this.world.player;
    const toPlayer = Math.atan2(p.px - n.x, p.pz - n.z);
    this.npcT += dt;
    let jump = 0;
    rig.animate(dt, this.npcMode === 'flee' ? 4.6 : 0);
    const a = rig.arms;
    if (this.npcMode === 'wave') {
      n.h = angleLerp(n.h, toPlayer, Math.min(1, 5 * dt));
      a[1].rotation.set(0, 0, 2.31 + 0.39 * Math.sin(this.t * 4.5)); // shoulder roll 110..155 degrees: an overhead wave
    } else if (this.npcMode === 'hop') {
      n.h = angleLerp(n.h, toPlayer, Math.min(1, 6 * dt));
      jump = Math.abs(Math.sin(this.npcT * 7)) * 0.34 * Math.max(0, 1 - this.npcT / 1.2);
      a[0].rotation.set(0, 0, -2.6);
      a[1].rotation.set(0, 0, 2.6);
      if (this.npcT >= 1.2) this._npcGone(); // he climbs into the driver's seat
    } else if (this.npcMode === 'shake') {
      n.h = angleLerp(n.h, toPlayer, Math.min(1, 8 * dt));
      a[1].rotation.set(0, 0, 2.1 + 0.28 * Math.sin(this.npcT * 16)); // fist in the air
      a[0].rotation.set(-1.7, 0, -0.3); // phone at the ear
      if (this.npcT >= 2) {
        this.npcMode = 'flee';
        this.npcT = 0;
      }
    } else if (this.npcMode === 'flee') {
      const away = this.axisX ? Math.sign(n.x - p.px) || 1 : Math.sign(n.z - p.pz) || 1;
      n.x += (this.axisX ? away : 0) * 4.6 * dt;
      n.z += (this.axisX ? 0 : away) * 4.6 * dt;
      n.h = angleLerp(n.h, Math.atan2(this.axisX ? away : 0, this.axisX ? 0 : away), Math.min(1, 10 * dt));
      if (this.npcT >= 5) this._npcGone();
    }
    if (this.npcMode !== 'gone') {
      this._placeNpc(jump);
      this.npc.group.visible = this.dist < 150; // a speck at that range: save its 5 draw calls
    }
  }

  _npcGone() {
    this.npcMode = 'gone';
    this.npc.group.visible = false;
  }

  _merge() {
    if (this.merged) return;
    this.merged = true;
    this.world.traffic.adopt(this.car, this.spot.i, this.spot.j, this.spot.d);
  }

  // Per-frame update. Returns false once the event is over and can be disposed.
  update(dt, input) {
    const w = this.world, p = w.player, car = this.car;
    this.t += dt;
    this.dist = Math.hypot(p.px - car.x, p.pz - car.z);
    this.prompt = '';
    this.promptBar = -1;
    if (!w.vehicles.list.includes(car)) return false; // removed by somebody else

    if (this.state === 'idle') {
      this._waiting(dt, input);
      if (this.state === 'idle') {
        if (this.progress <= 0) this.age += dt; // the 90 s clock waits while somebody is repairing
        if (this.dist > LEAVE_DIST || this.age >= LIFETIME) return false;
      }
    } else {
      this.phaseT += dt;
      // after the cheer the owner drives off with the other traffic; the event lingers 8 s
      if (this.state === 'repaired' && this.phaseT >= 1.2) this._merge();
      if (this.state === 'repaired' && this.phaseT >= 8) return false;
      if (this.state === 'stolen' && this.npcMode === 'gone' && this.hood <= 0.001) return false;
    }

    if (this.hood !== this.hoodTarget) {
      this.hood = Math.max(this.hoodTarget, this.hood - this.hoodSpeed * dt);
      this.hoodMesh.rotation.x = -this.hood;
    }
    this.hoodMesh.visible = this.engineMesh.visible = this.hood > 0.001;
    this.hazardLit = this.hazardOn && this.t % 0.5 < 0.25;
    this.hazardMesh.visible = this.hazardLit && this.dist <= NOTICE_DIST;

    // ring: pulses while on offer, fades when the repair is done, locked out or taken
    const ringOn = this.state === 'idle' && !this.panicked;
    this.ringAlpha += ((ringOn ? 1 : 0) - this.ringAlpha) * Math.min(1, dt * 7);
    this.ring.visible = this.ringAlpha > 0.02;
    const pulse = 0.95 + 0.1 * (0.5 + 0.5 * Math.sin(this.t * 3));
    this.ring.scale.set(pulse, 1, pulse);
    this.ringMat.opacity = 0.85 * this.ringAlpha * (this.progress > 0 ? 0.6 + 0.4 * Math.sin(this.t * 14) ** 2 : 1);

    this._updateSteam(dt);
    this._animateNpc(dt);
    return true;
  }

  // Remove the event's props. A car the player already took (or that has merged into traffic) stays; an untouched one goes away with the event.
  dispose() {
    const w = this.world, car = this.car;
    if (this.state === 'repaired') this._merge();
    this.scene.remove(this.ring, this.steam, this.npc.group);
    this.ringMat.dispose();
    this.steam.dispose();
    if (this.state === 'idle' && !car.driver) w.vehicles.remove(car);
    car.ambientEvent = null;
    car.chassis.remove(this.hoodMesh, this.engineMesh, this.hazardMesh);
    this.hoodMesh.geometry.dispose();
    this.engineMesh.geometry.dispose();
    this.hazardMesh.geometry.dispose();
  }
}

export const TUNER_DEF = {
  curb: TUNER_CURB,
  fits: tunerFits,
  create: (world, scene, spot) => new TunerBreakdownEvent(world, scene, spot),
};
