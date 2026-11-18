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
    case 6:
      return raceMission('Costa Circuit', 1800, [[-240, -200], [-80, -200], [80, -200], [240, -200], [240, 40], [80, 40], [-80, 40], [-240, 40]], world, 'Street race');
    case 7:
      return patrolMission('Seaside Patrol', 1400, [[-160, 200], [0, 200], [160, 200], [240, 280], [-80, 280]], world);
    case 8:
      return interceptMission('Signal Intercept', [80, 120], world);
    case 9:
      return armoredMission('Armored Shakedown', [-240, 120], world);
    default:
      return null;
  }
}

// Signal Intercept: meet the fixer at the beacon, then shadow the syndicate sedan (see signalIntercept.js). The payout is worked out when it ends.
function interceptMission(title, spot, world) {
  return {
    title,
    reward: 1400,
    rewardText: '$1,400+',
    steps: [
      { kind: 'reach', x: spot[0], z: spot[1], r: 6, needs: 'any', color: CYAN, text: `Meet the fixer at the beacon outside the cafe in ${world.layout.districtAt(spot[0], spot[1])}` },
      { kind: 'intercept', color: CYAN, text: 'Tail the black sedan: stay 15-45 m behind it' },
    ],
  };
}

// Armored Shakedown: meet the tipster at the beacon, then run the transport down (see armoredTruck.js). The payout is worked out when it ends.
function armoredMission(title, spot, world) {
  return {
    title,
    reward: 2800,
    rewardText: '$2,800+',
    steps: [
      { kind: 'reach', x: spot[0], z: spot[1], r: 6, needs: 'any', color: GOLD, text: `Meet the tipster at the beacon in ${world.layout.districtAt(spot[0], spot[1])}` },
      { kind: 'armored', color: GOLD, text: 'Ram the armored truck and grab the gold' },
    ],
  };
}

const RACE_PINK = 0xff5fa2;
const PATROL_GREEN = 0x62e08a;

// Checkpoint race: drive through every gate in order. One clock runs the whole race; each gate adds time back.
function raceMission(title, reward, spots, world, label) {
  const steps = spots.map((s, i) => {
    const leg = i === 0 ? 0 : dist(spots[i - 1], s);
    const first = i === 0;
    return {
      kind: 'reach', x: s[0], z: s[1], r: 9, needs: 'car', color: RACE_PINK,
      time: first ? Math.round(40 + dist([world.player?.px ?? 0, world.player?.pz ?? 0], s) / 8) : undefined, bonus: first ? 0 : Math.round(7 + leg / 9),
      text: `${label}: gate ${i + 1}/${spots.length} in ${world.layout.districtAt(s[0], s[1])}`,
    };
  });
  return { title, reward, steps, race: true };
}

// Timed patrol: check in at every post on foot or by car before the shift clock runs out.
function patrolMission(title, reward, spots, world) {
  let total = 0;
  for (let i = 1; i < spots.length; i++) total += dist(spots[i - 1], spots[i]);
  const steps = spots.map((s, i) => ({
    kind: 'reach', x: s[0], z: s[1], r: 7, needs: 'any', color: PATROL_GREEN,
    text: `Patrol post ${i + 1}/${spots.length}: ${world.layout.districtAt(s[0], s[1])}`,
  }));
  steps[0].time = Math.round(40 + total / 7);
  return { title, reward, steps };
}

// Order spots into a loop by always visiting the nearest unvisited one.
function loopFrom(rng, n, minLeg) {
  const pool = COURIER_SPOTS.slice();
  const out = [pool.splice(rng.int(0, pool.length - 1), 1)[0]];
  while (out.length < n) {
    const last = out[out.length - 1];
    pool.sort((a, b) => dist(a, last) - dist(b, last));
    const k = pool.findIndex((p) => dist(p, last) >= minLeg);
    out.push(pool.splice(k < 0 ? 0 : k, 1)[0]);
  }
  return out;
}

// Endless jobs after the scripted chain, in a repeating cycle: courier, checkpoint race, patrol, signal intercept, armored shakedown.
const CYCLE = 5;
function generated(index, world) {
  const n = index - 10; // scripted jobs 0-9 come first
  const kind = n % CYCLE;
  const round = Math.floor(n / CYCLE);
  if (kind === 1) {
    const rng = makeRng(index * 331 + 17);
    return raceMission(`Circuit Race #${round + 1}`, 1500 + round * 100, loopFrom(rng, 6, 100), world, 'Street race');
  }
  if (kind === 2) {
    const rng = makeRng(index * 463 + 9);
    return patrolMission(`Harbor Patrol #${round + 1}`, 1200 + round * 100, loopFrom(rng, 4, 80), world);
  }
  if (kind === 3) {
    const rng = makeRng(index * 719 + 3);
    return interceptMission(`Signal Intercept #${round + 2}`, COURIER_SPOTS[rng.int(0, COURIER_SPOTS.length - 1)], world);
  }
  if (kind === 4) {
    const rng = makeRng(index * 829 + 7);
    return armoredMission(`Armored Shakedown #${round + 2}`, COURIER_SPOTS[rng.int(0, COURIER_SPOTS.length - 1)], world);
  }
  return courier(index, n, world);
}

// Courier jobs: deterministic per index so a reload gives the same order.
function courier(index, n, world) {
  const rng = makeRng(index * 977 + 5);
  const a = COURIER_SPOTS[rng.int(0, COURIER_SPOTS.length - 1)];
  let b = a;
  while (b === a || dist(a, b) < 150) b = COURIER_SPOTS[rng.int(0, COURIER_SPOTS.length - 1)];
  const d = dist(a, b);
  const area = (p) => world.layout.districtAt(p[0], p[1]);
  return {
    title: `Courier Job #${Math.floor(n / CYCLE) + 1}`,
    reward: Math.round((350 + d * 1.7 + Math.floor(n / CYCLE) * 40) / 10) * 10,
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
    this.world.intercept?.cancel(); // a restart or a new job always removes the quarry
    this.world.armored?.cancel(); // ... and the armored truck
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
    else if (s.bonus && this.timeLeft !== null) this.timeLeft += s.bonus;
    const c = s.color ?? GOLD;
    this.beamMat.color.setHex(c);
    this.ringMat.color.setHex(c);
  }

  // Where the marker (and minimap blip) currently points.
  get target() {
    if (this.world.contraband?.active) return this.world.contraband.target; // the boat job points at its next crate / the slip
    if (this.world.gp?.isBusy()) return null; // the race draws its own route on the minimap
    const s = this.step;
    if (s.kind === 'steal') return this.vehicle ? { x: this.vehicle.x, z: this.vehicle.z } : null;
    if (s.kind === 'intercept') return this.world.intercept.position;
    if (s.kind === 'armored') return this.world.armored.target;
    return { x: s.x, z: s.z };
  }

  // Data for the HUD panel.
  get view() {
    if (this.world.contraband?.active) return this.world.contraband.missionView;
    const s = this.step;
    const t = this.target;
    const p = this.world.player;
    let objective = s.text;
    if (s.requireClean && this.world.wanted.stars > 0) objective = 'Lose the cops first!';
    if (s.kind === 'intercept' && this.world.intercept.upload >= 100) objective = 'UPLOAD COMPLETE: break away past 80 m';
    if (s.kind === 'armored') objective = this.world.armored.phaseText;
    return {
      title: this.mission.title,
      objective,
      reward: this.mission.reward,
      rewardText: this.mission.rewardText,
      dist: t ? Math.hypot(t.x - p.px, t.z - p.pz) : 0,
      time: this.timeLeft,
      step: `${this.stepIndex + 1}/${this.mission.steps.length}`,
    };
  }

  fail(reason) {
    this.world.notify(`MISSION FAILED: ${reason}`, 'warn');
    this.world.emit('failed');
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
    if (w.contraband?.active || w.gp?.isBusy()) {
      this.marker.visible = false; // the Contraband Drop or a Sunset GP race is the only job running; the street chain waits
      return null;
    }
    const t = this.target;
    this.marker.visible = !!t && s.kind !== 'armored'; // the truck has its chevron, the cases their pillars, the drop-off its beacon
    if (t) this.marker.position.set(t.x, 0.1, t.z);

    if (s.kind === 'intercept') {
      // the intercept runs its own 150 s clock and its own win / fail rules
      const ic = w.intercept;
      if (!ic.active && !ic.start()) return null; // no free lane near us yet: try again next frame
      const r = ic.update(dt);
      this.timeLeft = ic.timeLeft;
      if (!r) return null;
      if (r.fail) {
        this.fail(r.fail);
        return null;
      }
      const done = { title: this.mission.title, reward: r.reward, note: `${r.secs}s left${r.ghost ? ' + GHOST BONUS $400' : ''}` };
      this.completed++;
      this.begin(this.index + 1);
      return done;
    }
    if (s.kind === 'armored') {
      // the job runs its own 165 s clock and its own win / fail rules
      const ar = w.armored;
      if (!ar.active && !ar.start()) return null; // no free lane in range yet: try again next frame
      const r = ar.update(dt);
      this.timeLeft = ar.timeLeft;
      if (!r) return null;
      if (r.fail) {
        this.fail(r.fail);
        return null;
      }
      const done = { title: this.mission.title, reward: r.reward, lines: r.lines, note: `${r.secs}s left` };
      this.completed++;
      this.begin(this.index + 1);
      return done;
    }
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
