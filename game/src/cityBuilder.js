// cityBuilder: turns the city layout into a handful of merged meshes (ground, roads, markings, sidewalks, buildings).
import * as THREE from '../vendor/three.module.min.js';
import { WORLD, HEIGHTS } from './config.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeFacadeTextures } from './textures.js';
import { makeSignAtlas, signUV } from './signage.js';
import { makeRng } from './rng.js';

const ASPHALT = 0x5b616b;
const SIDEWALK = 0xd9d3c7;
const CURB = 0xbdb7ab;
const GRASS_PARK = 0x79b862;
const MARK_WHITE = 0xf4f1e6;
const MARK_YELLOW = 0xf2c230;

export function buildCity(layout, seed) {
  const group = new THREE.Group();
  group.name = 'city';
  const { xs, zs } = layout;
  const W = WORLD.road;
  const x0 = xs[0] - W / 2, x1 = xs[xs.length - 1] + W / 2;
  const z0 = zs[0] - W / 2, z1 = zs[zs.length - 1] + W / 2;

  // ---- roads + markings
  const roads = new MeshBuilder();
  const marks = new MeshBuilder();
  for (const x of xs) roads.flat(x - W / 2, z0, x + W / 2, z1, HEIGHTS.road, ASPHALT);
  for (const z of zs) roads.flat(x0, z - W / 2, x1, z + W / 2, HEIGHTS.road, ASPHALT);
  const my = HEIGHTS.mark;
  for (const x of xs) {
    for (let j = 0; j < zs.length - 1; j++) {
      const a = zs[j] + W / 2 + 1.5, b = zs[j + 1] - W / 2 - 1.5;
      marks.flat(x - 0.28, a, x - 0.1, b, my, MARK_YELLOW); // double yellow centre line
      marks.flat(x + 0.1, a, x + 0.28, b, my, MARK_YELLOW);
      marks.flat(x - W / 2 + 2.4, a, x - W / 2 + 2.55, b, my, MARK_WHITE); // parking edge lines
      marks.flat(x + W / 2 - 2.55, a, x + W / 2 - 2.4, b, my, MARK_WHITE);
    }
  }
  for (const z of zs) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i] + W / 2 + 1.5, b = xs[i + 1] - W / 2 - 1.5;
      marks.flat(a, z - 0.28, b, z - 0.1, my, MARK_YELLOW);
      marks.flat(a, z + 0.1, b, z + 0.28, my, MARK_YELLOW);
      marks.flat(a, z - W / 2 + 2.4, b, z - W / 2 + 2.55, my, MARK_WHITE);
      marks.flat(a, z + W / 2 - 2.55, b, z + W / 2 - 2.4, my, MARK_WHITE);
    }
  }
  // zebra crossings on all four arms of every intersection
  for (const x of xs) {
    for (const z of zs) {
      for (const dir of [-1, 1]) {
        const zc = z + dir * (W / 2 + 1.1);
        for (let s = -W / 2 + 1.4; s < W / 2 - 1; s += 1.3) marks.flat(x + s, zc - 1.2, x + s + 0.65, zc + 1.2, my, MARK_WHITE);
        const xc = x + dir * (W / 2 + 1.1);
        for (let s = -W / 2 + 1.4; s < W / 2 - 1; s += 1.3) marks.flat(xc - 1.2, z + s, xc + 1.2, z + s + 0.65, my, MARK_WHITE);
      }
    }
  }

  // ---- sidewalks, parks
  const walks = new MeshBuilder();
  const sy = HEIGHTS.sidewalk;
  for (const b of layout.blocks) {
    const h = b.size / 2;
    walks.slab([b.cx - h, b.cz - h, b.cx + h, b.cz + h], [b.cx - h, b.cz - h, b.cx + h, b.cz + h], 0, sy, { side: CURB, top: SIDEWALK });
    if (b.park) {
      const g = h - 1.8;
      walks.box(b.cx - g, sy, b.cz - g, b.cx + g, sy + 0.08, b.cz + g, { side: GRASS_PARK, top: GRASS_PARK });
      walks.box(b.cx - 1.6, sy + 0.08, b.cz - g, b.cx + 1.6, sy + 0.1, b.cz + g, { side: SIDEWALK, top: 0xe9e2d2 });
      walks.box(b.cx - g, sy + 0.08, b.cz - 1.6, b.cx + g, sy + 0.1, b.cz + 1.6, { side: SIDEWALK, top: 0xe9e2d2 });
      // fountain basin
      walks.slab([b.cx - 3.2, b.cz - 3.2, b.cx + 3.2, b.cz + 3.2], [b.cx - 3, b.cz - 3, b.cx + 3, b.cz + 3], sy, sy + 0.9, { side: 0xd8d2c6, top: 0x56c7d6 });
      walks.box(b.cx - 0.3, sy, b.cz - 0.3, b.cx + 0.3, sy + 2.2, b.cz + 0.3, 0xe9e2d2);
    } else {
      // dark pavement under the lots so gaps between buildings read as alleys
      walks.flat(b.cx - h + 3.4, b.cz - h + 3.4, b.cx + h - 3.4, b.cz + h - 3.4, sy + 0.01, 0xa8a398);
    }
  }
  for (const bn of layout.benches) {
    const sx = bn.rot ? 0.5 : 1.8;
    const sz = bn.rot ? 1.8 : 0.5;
    walks.box(bn.x - sx / 2, sy + 0.1 + 0.4, bn.z - sz / 2, bn.x + sx / 2, sy + 0.1 + 0.5, bn.z + sz / 2, 0x8d6a45);
    walks.box(bn.x - sx / 2 + 0.05, sy + 0.1, bn.z - sz / 2 + 0.05, bn.x - sx / 2 + 0.2, sy + 0.1 + 0.4, bn.z + sz / 2 - 0.05, 0x44464d);
  }

  // ---- buildings: walls (one mesh per window pattern), roofs/details (plain vertex colours) and shop signs (atlas texture)
  const tex = makeFacadeTextures(seed);
  const walls = tex.styles.map(() => new MeshBuilder().setUvTile(tex.tileMetres));
  const tops = new MeshBuilder();
  const signs = new MeshBuilder();
  const fronts = new MeshBuilder(); // awnings, display windows, doors: small shopfront details that do not cast shadows
  const nz = zs.length - 1;
  for (const b of layout.buildings) {
    const bi = Math.floor(((b.x0 + b.x1) / 2 - xs[0]) / WORLD.period);
    const bj = Math.floor(((b.z0 + b.z1) / 2 - zs[0]) / WORLD.period);
    addBuilding(walls[b.facade], tops, signs, fronts, b, layout.blocks[bi * nz + bj]);
  }
  for (const wh of layout.warehouses) addWarehouseSign(signs, wh, layout.docks[1].top);

  const wallMats = tex.styles.map((st) => new THREE.MeshLambertMaterial({ map: st.map, emissiveMap: st.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.85, vertexColors: true }));
  const signAtlas = makeSignAtlas();
  const signMat = new THREE.MeshLambertMaterial({ map: signAtlas, emissiveMap: signAtlas, emissive: 0xffffff, emissiveIntensity: 0.4, vertexColors: true });
  const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const markMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  const make = (builder, mat, cast, receive) => {
    const m = new THREE.Mesh(builder.build(), mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    group.add(m);
    return m;
  };
  make(roads, roadMat, false, true);
  make(marks, markMat, false, true);
  make(walks, solidMat, true, true);
  walls.forEach((w, i) => make(w, wallMats[i], true, true));
  make(tops, plainMat, true, true); // double-sided: awnings and roof panels are single quads
  make(signs, signMat, false, true);
  make(fronts, plainMat, false, true);
  return group;
}

const shade = (c, k) => new THREE.Color(c).multiplyScalar(k);
const WARM = new THREE.Color(1.45, 1.12, 0.68);
const COOL = new THREE.Color(0.62, 0.98, 1.2);
const E = 0.12; // how far the shopfront stands proud of the wall

function addBuilding(walls, tops, signs, fronts, b, block) {
  const color = b.color;
  const fullRect = [b.x0, b.z0, b.x1, b.z1];
  const sy = HEIGHTS.sidewalk;
  let baseTop = b.h;
  if (b.podium > 0) {
    // podium + setback tower
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const ix = w * b.inset, iz = d * b.inset;
    const tr = [b.x0 + ix, b.z0 + iz, b.x1 - ix, b.z1 - iz];
    baseTop = b.podium;
    walls.slab(fullRect, fullRect, sy, b.podium, { side: color });
    tops.flat(b.x0, b.z0, b.x1, b.z1, b.podium + 0.02, b.roof);
    walls.slab(tr, tr, b.podium, b.h, { side: shade(color, 0.96) });
    tops.box(tr[0] - 0.4, b.h, tr[1] - 0.4, tr[2] + 0.4, b.h + 0.7, tr[3] + 0.4, b.roof);
    // antenna on the tallest towers
    if (b.h > 60) {
      const ax = (tr[0] + tr[2]) / 2, az = (tr[1] + tr[3]) / 2;
      tops.box(ax - 0.2, b.h + 0.7, az - 0.2, ax + 0.2, b.h + 9, az + 0.2, 0xdd4444);
      tops.box(ax - 0.5, b.h + 6, az - 0.05, ax + 0.5, b.h + 6.3, az + 0.05, 0xdd4444);
    }
    addUnits(tops, b, tr, b.h + 0.7);
    addRoofKit(tops, b, tr, b.h + 0.7);
    for (const y of [b.h - 3.2 * 3]) tops.box(tr[0] - 0.12, y - 0.2, tr[1] - 0.12, tr[2] + 0.12, y + 0.15, tr[3] + 0.12, shade(b.accent, 0.95)); // crown band
    tops.box(b.x0 - 0.15, b.podium - 0.35, b.z0 - 0.15, b.x1 + 0.15, b.podium + 0.05, b.z1 + 0.15, shade(b.accent, 0.95)); // podium cornice
  } else {
    walls.slab(fullRect, fullRect, sy, b.h, { side: color });
    tops.box(b.x0 - 0.35, b.h, b.z0 - 0.35, b.x1 + 0.35, b.h + 0.6, b.z1 + 0.35, b.roof); // cornice
    addUnits(tops, b, fullRect, b.h + 0.6);
    addRoofKit(tops, b, fullRect, b.h + 0.6);
    // belt course half-way up and a coloured parapet band under the cornice
    if (b.h >= 12.8) {
      const y = Math.round(b.h / 2 / 3.2) * 3.2;
      tops.box(b.x0 - 0.12, y - 0.2, b.z0 - 0.12, b.x1 + 0.12, y + 0.15, b.z1 + 0.12, shade(b.accent, 0.96));
    }
    tops.box(b.x0 - 0.12, b.h - 0.5, b.z0 - 0.12, b.x1 + 0.12, b.h - 0.05, b.z1 + 0.12, shade(b.accent, 0.9));
  }
  // corner pilasters
  for (const [cx, cz, sx, sz] of [[b.x0, b.z0, 1, 1], [b.x1, b.z0, -1, 1], [b.x0, b.z1, 1, -1], [b.x1, b.z1, -1, -1]]) {
    tops.box(Math.min(cx - sx * 0.14, cx + sx * 0.55), 3.4, Math.min(cz - sz * 0.14, cz + sz * 0.55), Math.max(cx - sx * 0.14, cx + sx * 0.55), baseTop, Math.max(cz - sz * 0.14, cz + sz * 0.55), shade(color, 0.9), { top: false });
  }

  // shopfront band and canopy at street level
  const bandTop = 3.4;
  const sc = new THREE.Color(b.shop);
  tops.slab([b.x0 - E, b.z0 - E, b.x1 + E, b.z1 + E], [b.x0 - E, b.z0 - E, b.x1 + E, b.z1 + E], sy, bandTop, { side: shade(b.color, 0.82), top: sc });
  // dark storefront glazing and a coloured sign strip wrap the ground floor
  const g = E + 0.04;
  tops.box(b.x0 - g, sy + 0.5, b.z0 - g, b.x1 + g, sy + 2.6, b.z1 + g, 0x2f4358, { top: false });
  tops.box(b.x0 - g, sy + 2.75, b.z0 - g, b.x1 + g, bandTop, b.z1 + g, sc, { top: false });
  const c = 1.5;
  tops.box(b.x0 - c, bandTop, b.z0 - c, b.x1 + c, bandTop + 0.22, b.z1 + c, sc);

  // signs, awnings and door glow on every side that faces a street
  if (!block) return;
  const half = block.size / 2 - WORLD.sidewalk;
  const near = (a, bb) => Math.abs(a - bb) < 0.6;
  const faces = [
    near(b.x0, block.cx - half) && { nx: -1, nz: 0, p: b.x0, a0: b.z0, a1: b.z1 },
    near(b.x1, block.cx + half) && { nx: 1, nz: 0, p: b.x1, a0: b.z0, a1: b.z1 },
    near(b.z0, block.cz - half) && { nx: 0, nz: -1, p: b.z0, a0: b.x0, a1: b.x1 },
    near(b.z1, block.cz + half) && { nx: 0, nz: 1, p: b.z1, a0: b.x0, a1: b.x1 },
  ].filter(Boolean);
  faces.forEach((f, k) => {
    const len = f.a1 - f.a0;
    const mid = (f.a0 + f.a1) / 2;
    // point on this face: s along the wall, y height, o outward offset
    const at = (s, y, o) => (f.nx !== 0 ? [f.p + f.nx * o, y, s] : [s, y, f.p + f.nz * o]);
    const out = [f.nx, 0, f.nz];
    const sw = Math.min(len - 1.2, 6.2);
    const idx = (b.sign + k * 5) % 16;
    const [u0, v0, u1, v1] = signUV(idx);
    signs.quad(at(mid - sw / 2, 2.6, g + 0.02), at(mid + sw / 2, 2.6, g + 0.02), at(mid + sw / 2, 3.38, g + 0.02), at(mid - sw / 2, 3.38, g + 0.02), 0xffffff, out, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    if (b.hasAwning && (k + b.sign) % 2 === 0 && len > 7) {
      const aw = Math.min(len - 1.5, 9);
      const n = Math.max(2, Math.floor(aw / 0.9));
      const step = aw / n;
      const sw0 = mid - aw / 2;
      for (let i = 0; i < n; i++) {
        const s0 = sw0 + i * step, s1 = s0 + step;
        fronts.quad(at(s0, 2.72, g), at(s1, 2.72, g), at(s1, 2.18, 1.5), at(s0, 2.18, 1.5), i % 2 ? b.awning[1] : b.awning[0], [f.nx, 0.6, f.nz]);
      }
      fronts.quad(at(sw0, 2.18, 1.5), at(sw0 + aw, 2.18, 1.5), at(sw0 + aw, 1.92, 1.5), at(sw0, 1.92, 1.5), b.awning[0], out); // valance
    }
    // lit display windows between mullions: warm interiors (glowing) or cool daylight glass
    const warm = (b.sign + k) % 3 !== 0;
    const glowCol = warm ? WARM : COOL;
    const dEnd = f.a1 - 0.8;
    let shown = 0;
    for (let s = f.a0 + 0.8; s + 2.2 < dEnd && shown < 4; s += 2.75) {
      if (Math.abs(s + 1.1 - (mid + Math.min(len * 0.28, 3.5))) < 1.8) continue; // keep the door clear
      fronts.quad(at(s, sy + 0.75, g + 0.012), at(s + 2.2, sy + 0.75, g + 0.012), at(s + 2.2, sy + 2.2, g + 0.012), at(s, sy + 2.2, g + 0.012), glowCol, out);
      shown++;
    }
    // doorway: a lighter door with a lit transom, offset from the sign centre
    const ds = Math.min(f.a1 - 1.4, mid + Math.min(len * 0.28, 3.5));
    fronts.quad(at(ds - 0.6, sy, g + 0.01), at(ds + 0.6, sy, g + 0.01), at(ds + 0.6, sy + 2.3, g + 0.01), at(ds - 0.6, sy + 2.3, g + 0.01), shade(b.shop, 0.7), out);
    fronts.quad(at(ds - 0.5, sy + 1.2, g + 0.02), at(ds + 0.5, sy + 1.2, g + 0.02), at(ds + 0.5, sy + 2.1, g + 0.02), at(ds - 0.5, sy + 2.1, g + 0.02), 0xbfe3ee, out);
  });
}

// A big harbour sign above the roller doors on the land-facing wall of a warehouse.
function addWarehouseSign(signs, wh, top) {
  const [u0, v0, u1, v1] = signUV(wh.sign);
  const w = 9.6, h = w / 8;
  const mid = (wh.x0 + wh.x1) / 2, y = top + wh.h - 1.9, z = wh.z0 - 0.06;
  signs.quad([mid - w / 2, y, z], [mid + w / 2, y, z], [mid + w / 2, y + h, z], [mid - w / 2, y + h, z], 0xffffff, [0, 0, -1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
}

// Roof furniture chosen per building: water tank, solar panels, vents or a stair bulkhead.
function addRoofKit(tops, b, rect, y) {
  const r = makeRng(b.roofSeed);
  const w = rect[2] - rect[0], d = rect[3] - rect[1];
  if (w < 9 || d < 9) return;
  const x = rect[0] + w * r.range(0.25, 0.75), z = rect[1] + d * r.range(0.25, 0.75);
  switch (b.roofKind) {
    case 'tank': {
      for (const [lx, lz] of [[-0.8, -0.8], [0.8, 0.8]]) tops.box(x + lx - 0.08, y, z + lz - 0.08, x + lx + 0.08, y + 1.4, z + lz + 0.08, 0x3b3f47);
      tops.addGeometry(new THREE.CylinderGeometry(1.15, 1.15, 2, 8).translate(x, y + 2.4, z), 0x8d6b48);
      tops.addGeometry(new THREE.ConeGeometry(1.3, 0.9, 8).translate(x, y + 3.85, z), 0x6b4a2b);
      break;
    }
    case 'solar': {
      for (let k = 0; k < 3; k++) {
        const px = rect[0] + 2.5 + k * 3.4, pz = z;
        if (px + 3 > rect[2] - 1) break;
        tops.quad([px, y + 0.3, pz], [px + 3, y + 0.3, pz], [px + 3, y + 1.3, pz + 2.2], [px, y + 1.3, pz + 2.2], 0x2a4a7a, [0, 1, -0.4]);
        tops.box(px, y, pz - 0.05, px + 3, y + 0.3, pz + 0.05, 0x9aa0a6);
        tops.quad([px + 0.05, y + 0.32, pz + 0.05], [px + 1.5, y + 0.32, pz + 0.05], [px + 1.5, y + 1.28, pz + 2.15], [px + 0.05, y + 1.28, pz + 2.15], 0x3d6ba6, [0, 1, -0.4]);
      }
      break;
    }
    case 'vent': {
      tops.box(x - 0.4, y, z - 0.4, x + 0.4, y + 2.6, z + 0.4, 0xb9b4aa);
      tops.box(x - 0.6, y + 2.6, z - 0.6, x + 0.6, y + 2.85, z + 0.6, 0x6b6f76);
      tops.box(x + 1.5, y, z - 0.25, x + 2.0, y + 1.6, z + 0.25, 0xcfc8bb);
      break;
    }
    default:
      tops.box(x - 1.4, y, z - 1.1, x + 1.4, y + 2.4, z + 1.1, 0xc9c4ba); // stair bulkhead
      tops.box(x - 0.5, y, z + 1.1, x + 0.5, y + 1.9, z + 1.14, 0x4a4f58);
  }
}

function addUnits(tops, b, rect, y) {
  for (const u of b.units) {
    const ux0 = Math.min(Math.max(u.x, rect[0] + 0.5), rect[2] - u.w - 0.5);
    const uz0 = Math.min(Math.max(u.z, rect[1] + 0.5), rect[3] - u.d - 0.5);
    if (ux0 < rect[0] || uz0 < rect[1]) continue;
    tops.box(ux0, y, uz0, ux0 + u.w, y + u.h, uz0 + u.d, 0xb9b4aa);
  }
}
