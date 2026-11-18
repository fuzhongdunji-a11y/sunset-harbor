// characters: jointed low-poly humanoids (head, torso, upper/lower arms, thighs/shins) for the player and the townsfolk.
// One rig serves both; people vary by build, clothes and hair. Far-away people drop elbows/knees (setDetail) to save draw calls.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeRng } from './rng.js';

const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });

const SHIRTS = [0xe4572e, 0x2e86ab, 0xf2a541, 0x7bc47f, 0xc1366b, 0xf4f1ea, 0x6a4c93, 0x17a398, 0xf6d55c, 0x3d6fd6];
const PANTS = [0x2b3a55, 0x4a4036, 0x1d2a44, 0x7a6a58, 0x3d405b, 0xd9c9a3, 0x55606e];
const SKINS = [0xf1c9a5, 0xe0ac84, 0xc68863, 0x8d5a3b, 0x6b4430];
const HAIRS = [0x2a1d17, 0x4a3020, 0xb88a4a, 0x151515, 0x8c8c8c, 0x7a2e1e];
const SHOES = [0xf4f1ea, 0x2a2d33, 0x8d4b2b, 0xd9392b];
const HAIR_STYLES = ['short', 'long', 'bun', 'cap', 'short', 'bald', 'long'];

export const PLAYER_LOOK = {
  skin: 0xe0ac84, hair: 0x2a1d17, hairStyle: 'short', shirt: 0xff6f4e, trim: 0xf4f1ea, longSleeve: false,
  pants: 0x2b3a55, shorts: false, shoes: 0xf4f1ea, shades: true, bag: null, height: 1, build: 1, watch: true,
};

// Deterministic look for pedestrian variant k.
export function lookFor(k) {
  const r = makeRng(k * 977 + 31);
  const shirt = r.pick(SHIRTS);
  return {
    skin: r.pick(SKINS), hair: r.pick(HAIRS), hairStyle: r.pick(HAIR_STYLES), shirt,
    trim: r() < 0.5 ? 0xf4f1ea : darken(shirt, 0.7), longSleeve: r() < 0.35,
    pants: r.pick(PANTS), shorts: r() < 0.25, shoes: r.pick(SHOES), shades: r() < 0.18,
    bag: r() < 0.3 ? r.pick([0x8d4b2b, 0x2a2d33, 0xd9392b, 0xf2a541]) : null,
    height: r.range(0.92, 1.08), build: r.range(0.9, 1.15), watch: false,
  };
}

function darken(c, k) {
  return new THREE.Color(c).multiplyScalar(k);
}

const geoCache = new Map();
function limbs(look, key, headSeparate) {
  let g = geoCache.get(key);
  if (g) return g;
  const sleeve = look.shirt;
  const forearm = look.longSleeve ? look.shirt : look.skin;
  const shin = look.shorts ? look.skin : look.pants;
  const dark = 0x15161a;

  // torso (+ neck, and the head when it does not need its own joint); origin = hips centre, +y up
  const torso = new MeshBuilder();
  torso.slab([-0.17, -0.1, 0.17, 0.1], [-0.2, -0.12, 0.2, 0.12], 0, 0.3, { side: look.pants, top: look.pants }); // hips
  torso.slab([-0.2, -0.12, 0.2, 0.12], [-0.25, -0.135, 0.25, 0.135], 0.3, 0.7, { side: look.shirt, top: look.shirt }); // chest (wider at the shoulders)
  torso.box(-0.205, 0.27, -0.125, 0.205, 0.31, 0.125, darken(look.pants, 0.6)); // belt
  torso.box(-0.07, 0.7, -0.05, 0.07, 0.78, 0.05, look.skin); // neck
  torso.box(-0.13, 0.66, -0.08, 0.13, 0.72, 0.1, look.trim); // collar / shoulder yoke
  if (look.bag) torso.box(0.2, 0.2, -0.16, 0.27, 0.62, 0.08, look.bag); // shoulder bag strap + bag
  if (look.bag) torso.box(0.26, 0.12, -0.2, 0.42, 0.4, 0.1, look.bag);
  const head = new MeshBuilder();
  const hy = headSeparate ? 0 : 0.76;
  head.slab([-0.115, -0.115, 0.115, 0.12], [-0.125, -0.125, 0.125, 0.125], hy, hy + 0.27, { side: look.skin, top: look.skin }); // skull
  head.box(-0.025, hy + 0.09, 0.12, 0.025, hy + 0.15, 0.15, darken(look.skin, 0.9)); // nose
  if (look.shades) head.box(-0.115, hy + 0.14, 0.12, 0.115, hy + 0.19, 0.14, dark);
  else for (const s of [-1, 1]) head.box(s * 0.055 - 0.02, hy + 0.15, 0.12, s * 0.055 + 0.02, hy + 0.18, 0.135, dark); // eyes
  head.box(-0.035, hy + 0.05, 0.12, 0.035, hy + 0.065, 0.13, darken(look.skin, 0.75)); // mouth
  for (const s of [-1, 1]) head.box(s * 0.125 - 0.01, hy + 0.1, -0.02, s * 0.125 + 0.015, hy + 0.17, 0.05, darken(look.skin, 0.92)); // ears
  addHair(head, look, hy);
  let torsoGeo, headGeo = null;
  if (headSeparate) {
    torsoGeo = torso.build();
    headGeo = head.build();
  } else {
    const all = new MeshBuilder();
    all.pos = torso.pos.concat(head.pos);
    all.nrm = torso.nrm.concat(head.nrm);
    all.col = torso.col.concat(head.col);
    all.uv = torso.uv.concat(head.uv);
    torsoGeo = all.build();
  }

  // arms: origin at the shoulder; upper arm 0.28 long, forearm 0.27 + hand
  const upper = new MeshBuilder();
  upper.box(-0.065, -0.28, -0.07, 0.065, 0.04, 0.07, sleeve);
  if (!look.longSleeve) upper.box(-0.062, -0.29, -0.067, 0.062, -0.22, 0.067, look.trim);
  const lower = new MeshBuilder();
  lower.box(-0.055, -0.22, -0.06, 0.055, 0, 0.06, forearm);
  lower.box(-0.05, -0.3, -0.055, 0.05, -0.22, 0.055, look.skin);
  if (look.watch) lower.box(-0.058, -0.19, -0.063, 0.058, -0.15, 0.063, 0xe6a100);
  const armFull = new MeshBuilder(); // far LOD: both segments straight in one mesh
  armFull.box(-0.065, -0.28, -0.07, 0.065, 0.04, 0.07, sleeve);
  armFull.box(-0.055, -0.5, -0.06, 0.055, -0.28, 0.06, forearm);
  armFull.box(-0.05, -0.58, -0.055, 0.05, -0.5, 0.055, look.skin);

  // legs: origin at the hip joint; thigh 0.43, shin 0.43 with the shoe
  const thigh = new MeshBuilder();
  thigh.box(-0.095, -0.43, -0.1, 0.095, 0.03, 0.1, look.pants);
  const shinB = new MeshBuilder();
  shinB.box(-0.08, -0.34, -0.085, 0.08, 0, 0.085, shin);
  shinB.box(-0.09, -0.43, -0.09, 0.09, -0.34, 0.2, look.shoes);
  shinB.box(-0.092, -0.43, -0.092, 0.092, -0.4, 0.202, 0xf4f1ea); // sole
  const legFull = new MeshBuilder();
  legFull.box(-0.095, -0.43, -0.1, 0.095, 0.03, 0.1, look.pants);
  legFull.box(-0.08, -0.77, -0.085, 0.08, -0.43, 0.085, shin);
  legFull.box(-0.09, -0.86, -0.09, 0.09, -0.77, 0.2, look.shoes);

  g = {
    torso: torsoGeo, head: headGeo, upper: upper.build(), lower: lower.build(), armFull: armFull.build(),
    thigh: thigh.build(), shin: shinB.build(), legFull: legFull.build(),
  };
  geoCache.set(key, g);
  return g;
}

function addHair(h, look, hy) {
  const c = look.hair;
  const top = hy + 0.27;
  switch (look.hairStyle) {
    case 'bald':
      break;
    case 'long':
      h.box(-0.13, top - 0.06, -0.13, 0.13, top + 0.04, 0.125, c);
      h.box(-0.13, hy - 0.08, -0.14, 0.13, top, -0.095, c);
      for (const s of [-1, 1]) h.box(s * 0.12 - 0.02, hy - 0.02, -0.13, s * 0.12 + 0.02, top - 0.05, 0.02, c); // side locks
      break;
    case 'bun':
      h.box(-0.13, top - 0.06, -0.13, 0.13, top + 0.04, 0.125, c);
      h.box(-0.13, hy + 0.1, -0.135, 0.13, top, -0.1, c);
      h.box(-0.05, top + 0.02, -0.14, 0.05, top + 0.12, -0.05, c);
      break;
    case 'cap': {
      const cap = 0xd9392b;
      h.box(-0.13, top - 0.06, -0.13, 0.13, top + 0.05, 0.13, cap);
      h.box(-0.11, top - 0.02, 0.12, 0.11, top + 0.01, 0.25, cap); // brim
      h.box(-0.13, hy + 0.17, -0.135, 0.13, top - 0.06, -0.1, c);
      break;
    }
    default:
      h.box(-0.13, top - 0.07, -0.13, 0.13, top + 0.04, 0.125, c);
      h.box(-0.13, hy + 0.12, -0.135, 0.13, top - 0.06, -0.1, c);
      h.box(-0.13, top - 0.1, 0.1, 0.13, top - 0.06, 0.13, c);
  }
}

function mesh(geo, parent, x, y, z) {
  const m = new THREE.Mesh(geo, lambert);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Builds a person. Returns {group, animate(dt, speed), fall(t), setDetail(near)}; faces +Z and stands on y = 0.
function buildRig(look, key, { headSeparate, castShadow }) {
  const geo = limbs(look, key, headSeparate);
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const body = new THREE.Group(); // scaled for height/build; fall() tilts the whole group
  body.scale.set(look.build, look.height, look.build);
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  body.add(hips);
  const torso = mesh(geo.torso, hips, 0, 0, 0);
  const head = headSeparate ? new THREE.Group() : null;
  if (head) {
    head.position.y = 0.76;
    hips.add(head);
    mesh(geo.head, head, 0, 0, 0);
  }

  const legs = [], shins = [], arms = [], forearms = [];
  for (const s of [-1, 1]) {
    const leg = mesh(geo.thigh, hips, s * 0.1, 0, 0);
    const shin = mesh(geo.shin, leg, 0, -0.43, 0);
    legs.push(leg);
    shins.push(shin);
    const arm = mesh(geo.upper, hips, s * 0.3, 0.6, 0);
    const fore = mesh(geo.lower, arm, 0, -0.28, 0);
    arms.push(arm);
    forearms.push(fore);
  }
  if (castShadow) group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  let near = true;
  let phase = 0;
  let fallT = 0;
  const setDetail = (n) => {
    if (n === near) return;
    near = n;
    for (let i = 0; i < 2; i++) {
      shins[i].visible = n;
      forearms[i].visible = n;
      legs[i].geometry = n ? geo.thigh : geo.legFull;
      arms[i].geometry = n ? geo.upper : geo.armFull;
      if (!n) {
        shins[i].rotation.set(0, 0, 0);
        forearms[i].rotation.set(0, 0, 0);
      }
    }
  };

  return {
    group,
    setDetail,
    // speed in m/s drives stride rate, swing, lean and bounce; 0 settles into a relaxed idle
    animate(dt, speed, rate = 1) {
      if (fallT > 0.001) return; // lying down: fall() owns the pose
      const moving = Math.min(1, speed / 0.8);
      phase += dt * (2.6 + speed * 1.25) * rate;
      const run = Math.min(1, Math.max(0, (speed - 2) / 5)); // 0 walking, 1 sprinting
      const amp = (0.38 + run * 0.62) * Math.min(1, 0.3 + speed * 0.2) * moving;
      const s0 = Math.sin(phase), s1 = -s0;
      legs[0].rotation.x = s0 * amp;
      legs[1].rotation.x = s1 * amp;
      arms[0].rotation.x = -s0 * amp * 0.9;
      arms[1].rotation.x = -s1 * amp * 0.9;
      arms[0].rotation.z = 0.05;
      arms[1].rotation.z = -0.05;
      if (near) {
        // knees fold while the leg swings forward; elbows stay bent, more when running
        shins[0].rotation.x = Math.max(0, -Math.cos(phase)) * amp * 1.35;
        shins[1].rotation.x = Math.max(0, Math.cos(phase)) * amp * 1.35;
        const elbow = -(0.12 + run * 0.9) * moving - 0.1;
        forearms[0].rotation.x = elbow - Math.max(0, s0) * 0.3 * amp;
        forearms[1].rotation.x = elbow - Math.max(0, s1) * 0.3 * amp;
      }
      hips.position.y = 0.86 - Math.abs(Math.cos(phase)) * (0.02 + run * 0.035) * moving + (1 - moving) * Math.sin(performance.now() * 0.002 + phase) * 0.004;
      body.rotation.x = run * 0.22 * moving; // lean into the sprint
      hips.rotation.y = s0 * 0.1 * amp; // hips counter-rotate against the shoulders
      torso.rotation.y = -s0 * 0.12 * amp;
      if (head) head.rotation.y = Math.sin(phase * 0.5) * 0.05 * moving;
    },
    // 0 = upright, 1 = lying on its back, limbs flung out and knees folded
    fall(t) {
      fallT = t;
      group.rotation.x = -t * 1.5;
      group.position.y = t * 0.12;
      if (t <= 0.001) return;
      body.rotation.x = 0;
      hips.rotation.y = 0;
      torso.rotation.y = 0;
      hips.position.y = 0.86;
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        legs[i].rotation.set(-t * 0.5 * (i ? 1 : 0.4), 0, s * t * 0.28);
        shins[i].rotation.x = t * (i ? 0.9 : 0.35);
        arms[i].rotation.set(-t * (i ? 1.9 : 1.3), 0, s * t * 1.0);
        forearms[i].rotation.x = -t * (i ? 0.6 : 0.2);
      }
      if (head) head.rotation.set(t * 0.35, 0, 0);
    },
  };
}

// The player: always detailed, own head joint, casts a real shadow.
export function buildPerson(look = PLAYER_LOOK) {
  return buildRig(look, 'player', { headSeparate: true, castShadow: true });
}

// A townsperson; variant picks the clothes/build, geometry is shared per variant.
export function buildPedestrian(variant = 0) {
  const k = variant % 24;
  return buildRig(lookFor(k), `ped${k}`, { headSeparate: false, castShadow: false });
}
