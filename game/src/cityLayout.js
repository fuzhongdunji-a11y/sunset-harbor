// cityLayout: pure-data procedural generation of Costa Serena (roads, blocks, lots, props, parking, colliders).
import { WORLD } from './config.js';
import { makeRng } from './rng.js';

const PASTELS = [0xf6c9b8, 0xf3e0b5, 0xbfe3dc, 0xf2b8c6, 0xd8d2f0, 0xfff1d0, 0xa9d6e5, 0xf7d9a0, 0xe9a89b, 0xcfe8b8];
const TOWER_TONES = [0xcfe4ee, 0xe8eef2, 0xb7d0e0, 0xf2e8dc, 0xd9c7b8, 0xc3d9d4];
const SHOP_COLORS = [0xe4572e, 0x17a398, 0xf2a541, 0x2e86ab, 0xc1366b, 0x6a4c93, 0x3d405b];
const PARK_BLOCKS = new Set(['1,1', '6,2', '2,4', '5,5', '4,1']);

export const DISTRICTS = { downtown: 'Downtown Costa', old: 'Old Quarter', palmera: 'Palmera Heights', marina: 'Marina Row', beach: 'Serena Beach', docks: 'Harbor Docks', pier: 'Lantern Pier' };

export function generateCity(seed = 1) {
  const rng = makeRng(seed * 7919 + 13);
  const { period: P, road: W, sidewalk: SW, blocksX: NX, blocksZ: NZ, halfX, halfZ, blockSize } = WORLD;
  const xs = [];
  const zs = [];
  for (let i = 0; i <= NX; i++) xs.push(-halfX + i * P);
  for (let j = 0; j <= NZ; j++) zs.push(-halfZ + j * P);

  const docks = [
    { name: DISTRICTS.pier, x0: -114, z0: 335, x1: -106, z1: 425, top: 0.45 },
    { name: DISTRICTS.docks, x0: 100, z0: 335, x1: 262, z1: 402, top: 0.45 },
  ];
  const bounds = [
    { x0: -337, z0: -297, x1: 337, z1: 341 },
    ...docks.map((d) => ({ x0: d.x0, z0: d.z0, x1: d.x1, z1: d.z1 })),
  ];

  function districtAt(x, z) {
    for (const d of docks) if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d.name;
    if (z > WORLD.sandZ) return DISTRICTS.beach;
    if (z > 150) return DISTRICTS.marina;
    if (Math.abs(x) < 140 && Math.abs(z + 20) < 140) return DISTRICTS.downtown;
    return x < 0 ? DISTRICTS.old : DISTRICTS.palmera;
  }

  const colliders = []; // {type:'aabb',x0,z0,x1,z1,h} | {type:'circle',x,z,r,h}
  const blocks = [];
  const buildings = [];
  const palms = [];
  const lamps = [];
  const umbrellas = [];
  const benches = [];

  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NZ; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      const district = districtAt(cx, cz);
      const park = PARK_BLOCKS.has(`${i},${j}`);
      const block = { i, j, cx, cz, size: blockSize, district, park };
      blocks.push(block);
      const half = blockSize / 2;
      if (park) {
        block.fountain = { x: cx, z: cz };
        colliders.push({ type: 'circle', x: cx, z: cz, r: 3.2, h: 1.2 });
        for (let k = 0; k < 14; k++) {
          const px = cx + rng.range(-half + 5, half - 5);
          const pz = cz + rng.range(-half + 5, half - 5);
          if (Math.hypot(px - cx, pz - cz) < 8) continue;
          palms.push({ x: px, z: pz, s: rng.range(0.9, 1.35), rot: rng() * 6.28, lean: rng.range(-0.5, 0.5) });
        }
        for (const [bx, bz, rot] of [[cx - 9, cz, 1], [cx + 9, cz, 1], [cx, cz - 9, 0], [cx, cz + 9, 0]]) benches.push({ x: bx, z: bz, rot });
      } else {
        const lots = makeLots(block);
        for (const b of lots) {
          buildings.push(b);
          colliders.push({ type: 'aabb', x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: b.h });
        }
      }
      // street trees and lamps along the four sidewalk edges
      const avenue = i === 3 || i === 4 || j === 3 || j === NZ - 1;
      const edge = half - 1.4;
      for (const side of [0, 1, 2, 3]) {
        const along = side < 2 ? 'z' : 'x';
        const fixed = side % 2 === 0 ? -edge : edge;
        let n = 0;
        for (let t = -half + 9; t <= half - 9; t += avenue ? 12 : 17) {
          n++;
          const x = along === 'z' ? cx + fixed : cx + t;
          const z = along === 'z' ? cz + t : cz + fixed;
          if (n % 2 === 0) {
            if (rng() < (avenue ? 0.9 : 0.5)) {
              palms.push({ x, z, s: rng.range(0.85, 1.2), rot: rng() * 6.28, lean: rng.range(-0.3, 0.3) });
            }
          } else if (rng() < 0.8) {
            const outward = along === 'z' ? [Math.sign(fixed), 0] : [0, Math.sign(fixed)];
            lamps.push({ x: x - outward[0] * 0.7, z: z - outward[1] * 0.7, dx: outward[0], dz: outward[1] });
          }
        }
      }
    }
  }
  for (const p of palms) colliders.push({ type: 'circle', x: p.x, z: p.z, r: 0.38, h: 2 });
  for (const l of lamps) colliders.push({ type: 'circle', x: l.x, z: l.z, r: 0.22, h: 2 });

  function makeLots(block) {
    const { cx, cz, district } = block;
    const half = blockSize / 2 - SW;
    const downtown = district === DISTRICTS.downtown;
    const nx = rng() < (downtown ? 0.55 : 0.4) ? 1 : 2;
    const nz = rng() < (downtown ? 0.55 : 0.4) ? 1 : 2;
    const splitX = rng.range(0.4, 0.6);
    const splitZ = rng.range(0.4, 0.6);
    const xe = [cx - half, cx - half + 2 * half * splitX, cx + half];
    const ze = [cz - half, cz - half + 2 * half * splitZ, cz + half];
    const out = [];
    const gap = 0.8;
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < nz; b++) {
        const x0 = nx === 1 ? xe[0] : xe[a] + (a === 1 ? gap : 0);
        const x1 = nx === 1 ? xe[2] : a === 0 ? xe[1] - gap : xe[2];
        const z0 = nz === 1 ? ze[0] : ze[b] + (b === 1 ? gap : 0);
        const z1 = nz === 1 ? ze[2] : b === 0 ? ze[1] - gap : ze[2];
        out.push(makeBuilding(x0, z0, x1, z1, district));
      }
    }
    return out;
  }

  function makeBuilding(x0, z0, x1, z1, district) {
    let h;
    if (district === DISTRICTS.downtown) h = rng() < 0.22 ? rng.range(62, 98) : rng.range(26, 56);
    else if (district === DISTRICTS.marina) h = rng.range(9, 20);
    else if (district === DISTRICTS.old) h = rng.range(10, 24);
    else h = rng.range(9, 28);
    h = Math.round(h / 3.2) * 3.2;
    const tower = h > 40;
    const color = tower ? rng.pick(TOWER_TONES) : rng.pick(PASTELS);
    const b = {
      x0, z0, x1, z1, h, color, district,
      roof: rng.pick([0xe9e3d6, 0xcfc8bb, 0xf0d9c0, 0xb7b2a8]),
      shop: rng.pick(SHOP_COLORS),
      podium: tower ? rng.pick([9.6, 12.8, 16]) : 0,
      inset: rng.range(0.14, 0.24),
      units: [],
    };
    const nUnits = rng.int(1, 3);
    for (let k = 0; k < nUnits; k++) {
      const w = rng.range(2.5, 5);
      const d = rng.range(2.5, 5);
      b.units.push({
        x: rng.range(x0 + w, Math.max(x0 + w + 0.1, x1 - w)) - w / 2,
        z: rng.range(z0 + d, Math.max(z0 + d + 0.1, z1 - d)) - d / 2,
        w, d, h: rng.range(1.2, 3),
      });
    }
    return b;
  }

  // Parking slots along the curbs, facing the direction of travel (right-hand traffic).
  const slots = [];
  const curb = W / 2 - 1.35;
  const nearIntersection = (v, lines) => lines.some((l) => Math.abs(v - l) < W / 2 + 7.5);
  for (const x of xs) {
    for (let z = zs[0] + 12; z < zs[NZ] - 10; z += 10) {
      if (nearIntersection(z, zs)) continue;
      slots.push({ x: x - curb, z, h: 0 });
      slots.push({ x: x + curb, z, h: Math.PI });
    }
  }
  for (const z of zs) {
    for (let x = xs[0] + 12; x < xs[NX] - 10; x += 10) {
      if (nearIntersection(x, xs)) continue;
      slots.push({ x, z: z + curb, h: Math.PI / 2 });
      slots.push({ x, z: z - curb, h: -Math.PI / 2 });
    }
  }

  // Beach umbrellas and a few beach props on the sand.
  for (let k = 0; k < 26; k++) {
    const x = rng.range(-300, 300);
    if (Math.abs(x + 110) < 14) continue;
    umbrellas.push({ x, z: rng.range(302, 332), color: rng.pick([0xe4572e, 0xffffff, 0x17a398, 0xf2a541, 0xc1366b]), rot: rng() * 6 });
  }
  for (const u of umbrellas) colliders.push({ type: 'circle', x: u.x, z: u.z, r: 0.25, h: 2.4 });

  // Shipping containers and crane legs on the east dock.
  const containers = [];
  const dockB = docks[1];
  const palette = [0xc0392b, 0x2471a3, 0x1e8449, 0xd4ac0d, 0xe67e22, 0x7d3c98, 0x95a5a6];
  for (const rowZ of [351, 356.5, 362, 375, 380.5]) {
    for (let x = dockB.x0 + 8; x < dockB.x1 - 14; x += 6.6) {
      if (x > 166 && x < 190) continue; // crane aisle
      if (rng() < 0.22) continue;
      const stack = rng.int(1, 3);
      const c = { x0: x, z0: rowZ, x1: x + 6.1, z1: rowZ + 2.5, stack, color: rng.pick(palette) };
      containers.push(c);
      colliders.push({ type: 'aabb', x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, h: stack * 2.6 });
    }
  }
  const craneLegs = [];
  for (const [x, z] of [[168, 366], [188, 366], [168, 392], [188, 392]]) {
    craneLegs.push({ x, z });
    colliders.push({ type: 'aabb', x0: x - 0.6, z0: z - 0.6, x1: x + 0.6, z1: z + 0.6, h: 24 });
  }

  colliders.push({ type: 'circle', x: -110, z: 419, r: 2.5, h: 18 });

  const boats = [
    { x: -124, z: 372, rot: 0.1, color: 0xf4f1ea, len: 11 },
    { x: -96, z: 392, rot: -0.05, color: 0xe4572e, len: 9 },
    { x: -125, z: 410, rot: 0.08, color: 0x2e86ab, len: 8 },
    { x: 150, z: 412, rot: 0.2, color: 0xf2a541, len: 12 },
  ];

  const start = { x: 11.6, z: 4, heading: Math.PI };
  const starterCar = { x: xs[4] + curb, z: -6, h: Math.PI, type: 'marlin' };

  function groundHeightAt(x, z) {
    for (const d of docks) if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d.top;
    if (z > WORLD.sandZ) return 0.02;
    const fx = (x + halfX) % P;
    const fz = (z + halfZ) % P;
    const gi = Math.floor((x + halfX) / P);
    const gj = Math.floor((z + halfZ) / P);
    if (gi >= 0 && gi < NX && gj >= 0 && gj < NZ && fx > W / 2 && fx < P - W / 2 && fz > W / 2 && fz < P - W / 2) return 0.16;
    return 0.04;
  }

  return {
    seed, xs, zs, blocks, buildings, palms, lamps, umbrellas, benches, containers, craneLegs, boats, docks,
    slots, colliders, bounds, start, starterCar, districtAt, groundHeightAt,
    spawnRng: makeRng(seed * 131 + 7),
  };
}
