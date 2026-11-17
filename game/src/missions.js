// missions: scripted job chain (reach, delivery, car theft, escape) followed by endless generated courier jobs; owns the world marker.
import * as THREE from '../vendor/three.module.min.js';
import { makeRng } from './rng.js';

const GOLD = 0xffd23f;
const CYAN = 0x5ee0ff;

// Intersections and spots the generated courier jobs pick from.
const COURIER_SPOTS = [
  [-240, -200], [-160, -120], [-80, -200], [0, -120], [80, -200], [160, -120], [240, -200], [-240, -40], [-80, 40], [80, 40],
  [240, 40], [-240, 120], [-160, 200], [0, 200], [160, 200], [240, 280], [-80, 280], [80, 120],
];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Scripted missions are plain data; steps run in order. `time` starts a countdown that lasts until the mission ends.
function scripted(index, world) {
  const area = (x, z) => world.layout.districtAt(x, z);
  switch (index) {
    case 0:
      return { title: 'First Day in Costa', reward: 500, steps: [{ kind: 'reach', x: -160, z: 200, r: 6, needs: 'car', text: 'Drive to the Harbor Line Garage' }] };
    case 1:
      return { title: 'Dock Run', reward: 800, steps: [{ kind: 'reach', x: 178, z: 350, r: 6, needs: 'car', text: 'Take a car to the container crane at Harbor Docks' }] };
    case 2:
      return { title: 'Last Light', reward: 1200, steps: [{ kind: 'reach', x: -110, z: 408, r: 6, needs: 'foot', text: 'Walk out to the Lantern Pier lighthouse' }] };
    case 3:
      return {
        title: 'Package Run',
        reward: 900,
        steps: [
          { kind: 'reach', x: 80, z: -40, r: 5.5, needs: 'any', text: `Pick up the parcel in ${area(80, -40)}` },
          { kind: 'reach', x: -240, z: 200, r: 6, needs: 'car', time: 115, text: `Deliver it to ${area(-240, 200)} before the buyer leaves` },
        ],
      };
    case 4:
      return {
        title: 'Borrowed Wheels',
        reward: 1500,
        setup(m) {
          if (!m.vehicle || m.vehicle.wrecked || !world.vehicles.list.includes(m.vehicle)) {
            m.vehicle = world.vehicles.spawn('vesper', 0x17a398, 160 - 7.65, -80, 0);
          }
        },
        steps: [
          { kind: 'steal', text: 'Steal the teal Vesper GT parked in Old Quarter', color: CYAN },
          { kind: 'reach', x: -80, z: -200, r: 7, needs: 'mcar', time: 105, text: `Bring the Vesper GT to the garage in ${area(-80, -200)}` },
        ],
      };
    case 5:
      return {
        title: 'Heat Check',
        reward: 2500,
        steps: [
          {
            kind: 'reach', x: 178, z: 350, r: 6, needs: 'any', text: 'Grab the cash bag at Harbor Docks',
            onDone(w) {
              w.wanted.commit('jobHeat', 5.6, 0);
              w.notify('The bag was marked! Cops are on you', 'warn');
            },
          },
          { kind: 'reach', x: -240, z: -200, r: 8, needs: 'any', requireClean: true, text: 'Shake the police, then reach the safehouse' },
        ],
      };
    default:
      return null;
  }
}

// Endless courier jobs: deterministic per index so a reload gives the same order.
function generated(index, world) {
  const rng = makeRng(index * 977 + 5);
  const a = COURIER_SPOTS[rng.int(0, COURIER_SPOTS.length - 1)];
  let b = a;
  while (b === a || dist(a, b) < 150) b = COURIER_SPOTS[rng.int(0, COURIER_SPOTS.length - 1)];
  const d = dist(a, b);
  const area = (p) => world.layout.districtAt(p[0], p[1]);
  return {
    title: `Courier Job #${index - 5}`,
    reward: Math.round((350 + d * 1.7 + (index - 6) * 40) / 10) * 10,
    steps: [
      { kind: 'reach', x: a[0], z: a[1], r: 5.5, needs: 'any', text: `Pick up the package in ${area(a)}` },
      { kind: 'reach', x: b[0], z: b[1], r: 6, needs: 'car', time: Math.round(30 + d / 7.5), text: `Deliver it to ${area(b)}` },
    ],
  };
}

export class MissionTracker {
  constructor(world, scene) {
    this.world = world;
    this.marker = this._buildMarker();
    scene.add(this.marker);
    this.vehicle = null; // car the current mission is about (steal / bring-it-here jobs)
    this.index = 0;
    this.completed = 0;
    this.begin(0);
  }

  _buildMarker() {
    const g = new THREE.Group();
    this.beamMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.ringMat = new THREE.MeshBasicMaterial({ color: GOLD });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 90, 12, 1, true), this.beamMat);
    beam.position.y = 45;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.22, 6, 20).rotateX(Math.PI / 2), this.ringMat);
    ring.position.y = 0.4;
    g.add(beam, ring);
    this.ring = ring;
    return g;
  }

  // Start (or restart) mission number `index`.
  begin(index) {
    this.index = index;
    this.mission = scripted(index, this.world) ?? generated(index, this.world);
    this.mission.setup?.(this);
    this.stepIndex = 0;
    this.timeLeft = null;
    this._enterStep();
  }

  restore(completed) {
    this.completed = completed;
    this.begin(completed);
  }

  get step() {
    return this.mission.steps[this.stepIndex];
  }

  _enterStep() {
    const s = this.step;
    if (s.time) this.timeLeft = s.time;
    const c = s.color ?? GOLD;
    this.beamMat.color.setHex(c);
    this.ringMat.color.setHex(c);
  }

  // Where the marker (and minimap blip) currently points.
  get target() {
    const s = this.step;
    if (s.kind === 'steal') return this.vehicle ? { x: this.vehicle.x, z: this.vehicle.z } : null;
    return { x: s.x, z: s.z };
  }

  // Data for the HUD panel.
  get view() {
    const s = this.step;
    const t = this.target;
    const p = this.world.player;
    let objective = s.text;
    if (s.requireClean && this.world.wanted.stars > 0) objective = 'Lose the cops first!';
    return {
      title: this.mission.title,
      objective,
      reward: this.mission.reward,
      dist: t ? Math.hypot(t.x - p.px, t.z - p.pz) : 0,
      time: this.timeLeft,
      step: `${this.stepIndex + 1}/${this.mission.steps.length}`,
    };
  }

  fail(reason) {
    this.world.notify(`MISSION FAILED: ${reason}`, 'warn');
    this.begin(this.index);
  }

  // Called when the player was arrested or killed: the job restarts from its first step.
  onPlayerDown() {
    this.begin(this.index);
  }

  // Returns {title, reward} when a mission was completed this frame.
  update(dt) {
    this.ring.rotation.y += dt * 1.5;
    this.ring.position.y = 0.5 + Math.sin(performance.now() / 300) * 0.15;
    const w = this.world, p = w.player, s = this.step;
    const t = this.target;
    this.marker.visible = !!t;
    if (t) this.marker.position.set(t.x, 0.1, t.z);

    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.fail('out of time');
        return null;
      }
    }
    let ok = false;
    if (s.kind === 'steal') {
      const v = this.vehicle;
      if (!v || v.wrecked || !w.vehicles.list.includes(v)) {
        this.fail('the car is gone');
        return null;
      }
      ok = p.vehicle === v;
    } else {
      const near = Math.hypot(s.x - p.px, s.z - p.pz) < s.r;
      const need = s.needs;
      const mode = need === 'any' || (need === 'car' && p.inCar) || (need === 'foot' && !p.inCar) || (need === 'mcar' && p.vehicle === this.vehicle && !!p.vehicle);
      ok = near && mode && !(s.requireClean && w.wanted.stars > 0);
      if (need === 'mcar' && this.vehicle && (this.vehicle.wrecked || !w.vehicles.list.includes(this.vehicle))) {
        this.fail('the car is gone');
        return null;
      }
    }
    if (!ok) return null;

    s.onDone?.(w);
    this.stepIndex++;
    if (this.stepIndex < this.mission.steps.length) {
      this._enterStep();
      w.notify(this.step.text, 'info');
      return null;
    }
    const done = { title: this.mission.title, reward: this.mission.reward };
    this.completed++;
    this.begin(this.index + 1);
    return done;
  }
}
