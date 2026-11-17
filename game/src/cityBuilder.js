// cityBuilder: turns the city layout into a handful of merged meshes (ground, roads, markings, sidewalks, buildings).
import * as THREE from '../vendor/three.module.min.js';
import { WORLD, HEIGHTS } from './config.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeFacadeTextures } from './textures.js';

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

  // ---- buildings: walls (window texture) and roofs/details (plain vertex colours)
  const walls = new MeshBuilder();
  const tex = makeFacadeTextures(seed);
  walls.setUvTile(tex.tileMetres);
  const tops = new MeshBuilder();
  for (const b of layout.buildings) addBuilding(walls, tops, b);

  const wallMat = new THREE.MeshLambertMaterial({ map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.85, vertexColors: true });
  const plainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
  make(walks, plainMat, true, true);
  make(walls, wallMat, true, true);
  make(tops, plainMat, true, true);
  return group;
}

function addBuilding(walls, tops, b) {
  const color = b.color;
  const shade = (c, k) => {
    const col = new THREE.Color(c);
    return col.multiplyScalar(k);
  };
  const fullRect = [b.x0, b.z0, b.x1, b.z1];
  const sy = HEIGHTS.sidewalk;
  if (b.podium > 0) {
    // podium + setback tower
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const ix = w * b.inset, iz = d * b.inset;
    const tr = [b.x0 + ix, b.z0 + iz, b.x1 - ix, b.z1 - iz];
    walls.slab(fullRect, fullRect, sy, b.podium, { side: color });
    tops.flat(b.x0, b.z0, b.x1, b.z1, b.podium + 0.02, b.roof);
    walls.slab(tr, tr, b.podium, b.h, { side: shade(color, 0.96) });
    tops.box(tr[0] - 0.4, b.h, tr[1] - 0.4, tr[2] + 0.4, b.h + 0.7, tr[3] + 0.4, b.roof);
    // antenna on the tallest towers
    if (b.h > 60) tops.box((tr[0] + tr[2]) / 2 - 0.2, b.h + 0.7, (tr[1] + tr[3]) / 2 - 0.2, (tr[0] + tr[2]) / 2 + 0.2, b.h + 9, (tr[1] + tr[3]) / 2 + 0.2, 0xdd4444);
    addUnits(tops, b, tr, b.h + 0.7);
  } else {
    walls.slab(fullRect, fullRect, sy, b.h, { side: color });
    tops.box(b.x0 - 0.35, b.h, b.z0 - 0.35, b.x1 + 0.35, b.h + 0.6, b.z1 + 0.35, b.roof); // cornice
    addUnits(tops, b, fullRect, b.h + 0.6);
  }
  // shopfront band and canopy at street level
  const e = 0.12;
  const bandTop = 3.4;
  const sc = new THREE.Color(b.shop);
  tops.slab([b.x0 - e, b.z0 - e, b.x1 + e, b.z1 + e], [b.x0 - e, b.z0 - e, b.x1 + e, b.z1 + e], sy, bandTop, { side: shade(b.color, 0.82), top: sc });
  // dark storefront glazing and a coloured sign strip wrap the ground floor
  const g = e + 0.04;
  tops.box(b.x0 - g, sy + 0.5, b.z0 - g, b.x1 + g, sy + 2.6, b.z1 + g, 0x2f4358, { top: false });
  tops.box(b.x0 - g, sy + 2.75, b.z0 - g, b.x1 + g, bandTop, b.z1 + g, sc, { top: false });
  const c = 1.5;
  tops.box(b.x0 - c, bandTop, b.z0 - c, b.x1 + c, bandTop + 0.22, b.z1 + c, sc);
}

function addUnits(tops, b, rect, y) {
  for (const u of b.units) {
    const ux0 = Math.min(Math.max(u.x, rect[0] + 0.5), rect[2] - u.w - 0.5);
    const uz0 = Math.min(Math.max(u.z, rect[1] + 0.5), rect[3] - u.d - 0.5);
    if (ux0 < rect[0] || uz0 < rect[1]) continue;
    tops.box(ux0, y, uz0, ux0 + u.w, y + u.h, uz0 + u.d, 0xb9b4aa);
  }
}
