// characters: low-poly humanoid model with a walk cycle (used for the player now, pedestrians in Stage 2).
import * as THREE from '../vendor/three.module.min.js';

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
