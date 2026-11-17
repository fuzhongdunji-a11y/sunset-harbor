// characters: low-poly humanoid model with a walk cycle (used for the player now, pedestrians in Stage 2).
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';

const matCache = new Map();
function mat(color) {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

function part(w, h, d, color, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = y;
  m.castShadow = true;
  return m;
}

export const PLAYER_LOOK = { skin: 0xe0ac84, shirt: 0xff6f4e, pants: 0x2b3a55, hair: 0x2a1d17, shoes: 0xf4f1ea, shades: true };

// Returns {group, animate(dt, speed)}; the model faces +Z and stands on y = 0.
export function buildPerson(look = PLAYER_LOOK) {
  const group = new THREE.Group();
  const legs = [];
  const arms = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.13, 0.86, 0);
    const thigh = part(0.2, 0.86, 0.22, look.pants, -0.43);
    const shoe = part(0.22, 0.12, 0.34, look.shoes, -0.82);
    shoe.position.z = 0.05;
    leg.add(thigh, shoe);
    group.add(leg);
    legs.push(leg);

    const arm = new THREE.Group();
    arm.position.set(s * 0.33, 1.5, 0);
    arm.add(part(0.14, 0.58, 0.16, look.shirt, -0.2), part(0.13, 0.2, 0.15, look.skin, -0.6));
    group.add(arm);
    arms.push(arm);
  }
  const torso = part(0.46, 0.66, 0.26, look.shirt, 1.18);
  group.add(torso);
  group.add(part(0.48, 0.1, 0.28, 0xf4f1ea, 1.34)); // shirt stripe
  const head = new THREE.Group();
  head.position.y = 1.62;
  head.add(part(0.26, 0.28, 0.26, look.skin, 0.14));
  head.add(part(0.29, 0.1, 0.29, look.hair, 0.3));
  head.add(part(0.29, 0.2, 0.06, look.hair, 0.2)).children[2].position.z = -0.12;
  if (look.shades) {
    const s = part(0.27, 0.07, 0.04, 0x15161a, 0.17);
    s.position.z = 0.135;
    head.add(s);
  }
  group.add(head);

  let phase = 0;
  const api = {
    group,
    // speed in m/s drives stride frequency and amplitude; 0 settles into idle
    animate(dt, speed) {
      const moving = Math.min(1, speed / 3);
      phase += dt * (3.2 + speed * 1.15);
      const amp = Math.min(0.95, 0.35 + speed * 0.09) * moving;
      const sw = Math.sin(phase) * amp;
      legs[0].rotation.x = sw;
      legs[1].rotation.x = -sw;
      arms[0].rotation.x = -sw * 0.9;
      arms[1].rotation.x = sw * 0.9;
      group.position.y = 0;
      torso.rotation.z = Math.sin(phase) * 0.03 * moving;
      head.rotation.y = Math.sin(phase * 0.5) * 0.04 * moving;
    },
  };
  return api;
}

// ---- pedestrians: five merged meshes per person (body, two legs, two arms) sharing cached geometry per look ----
const SHIRTS = [0xe4572e, 0x2e86ab, 0xf2a541, 0x7bc47f, 0xc1366b, 0xf4f1ea, 0x6a4c93, 0x17a398];
const PANTS = [0x2b3a55, 0x4a4036, 0x1d2a44, 0x7a6a58, 0x3d405b, 0xd9c9a3];
const SKINS = [0xe0ac84, 0xc68863, 0x8d5a3b, 0xf1c9a5, 0x6b4430];
const HAIRS = [0x2a1d17, 0x4a3020, 0xb88a4a, 0x151515, 0x8c8c8c, 0x7a2e1e];
const pedGeoCache = new Map();
const pedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

function pedGeometry(k) {
  let g = pedGeoCache.get(k);
  if (g) return g;
  const look = { shirt: SHIRTS[k % SHIRTS.length], pants: PANTS[(k * 3) % PANTS.length], skin: SKINS[(k * 5) % SKINS.length], hair: HAIRS[(k * 7) % HAIRS.length] };
  const body = new MeshBuilder();
  body.box(-0.23, 0.85, -0.13, 0.23, 1.51, 0.13, look.shirt);
  body.box(-0.13, 1.51, -0.13, 0.13, 1.79, 0.13, look.skin);
  body.box(-0.145, 1.72, -0.145, 0.145, 1.84, 0.145, look.hair);
  body.box(-0.145, 1.62, -0.15, 0.145, 1.78, -0.1, look.hair);
  const leg = new MeshBuilder();
  leg.box(-0.1, -0.86, -0.11, 0.1, 0, 0.11, look.pants);
  leg.box(-0.11, -0.86, -0.1, 0.11, -0.74, 0.17, 0xf4f1ea);
  const arm = new MeshBuilder();
  arm.box(-0.07, -0.42, -0.08, 0.07, 0, 0.08, look.shirt);
  arm.box(-0.065, -0.62, -0.075, 0.065, -0.42, 0.075, look.skin);
  g = { body: body.build(), leg: leg.build(), arm: arm.build() };
  pedGeoCache.set(k, g);
  return g;
}

// Returns {group, animate(dt, speed), fall(t)}; faces +Z, stands on y = 0.
export function buildPedestrian(variant = 0) {
  const geo = pedGeometry(variant % 24);
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  group.add(new THREE.Mesh(geo.body, pedMaterial));
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(geo.leg, pedMaterial);
    l.position.set(s * 0.13, 0.86, 0);
    const a = new THREE.Mesh(geo.arm, pedMaterial);
    a.position.set(s * 0.31, 1.46, 0);
    group.add(l, a);
    legs.push(l);
    arms.push(a);
  }
  let phase = variant * 1.7;
  return {
    group,
    animate(dt, speed) {
      const moving = Math.min(1, speed / 0.8);
      phase += dt * (2.2 + speed * 2.4);
      const amp = Math.min(1.0, 0.25 + speed * 0.16) * moving;
      const sw = Math.sin(phase) * amp;
      legs[0].rotation.x = sw;
      legs[1].rotation.x = -sw;
      arms[0].rotation.x = -sw * 0.9;
      arms[1].rotation.x = sw * 0.9;
    },
    // 0 = upright, 1 = lying on its back
    fall(t) {
      group.rotation.x = -t * 1.5;
      group.position.y = t * 0.12;
    },
  };
}
