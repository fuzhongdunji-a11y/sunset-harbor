// skyline: distant city silhouette (clustered towers with stepped crowns and spires) ringing the playable town, hazed by layer for depth.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './meshBuilder.js';
import { makeRng } from './rng.js';

// Tower cluster centres (x, z, strength): the tallest blocks gather here, so the outline has peaks and gaps instead of a flat fence.
const CLUSTERS = [
  [-620, -560, 1.0], [-150, -780, 0.85], [330, -640, 1.0], [780, -420, 0.8],
  [-860, -150, 0.7], [900, 60, 0.75], [-720, 240, 0.55], [650, 250, 0.5],
];

const LAYERS = [
  { rMin: 430, rMax: 700, side: 0x9d8fb0, top: 0xc3a9b8 }, // nearest: dusky violet, warm tops catching the sun
  { rMin: 700, rMax: 1000, side: 0xb3a0b8, top: 0xd2b4b8 },
];

export function buildSkyline() {
  const rng = makeRng(4242);
  const b = new MeshBuilder();
  for (const layer of LAYERS) {
    const count = layer.rMin < 600 ? 46 : 54;
    for (let n = 0; n < count; n++) {
      // sample a point in the ring outside the town (town ≈ |x| < 330, -290 < z < 345); the south is open sea
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(layer.rMin, layer.rMax);
      const x = Math.cos(a) * r * 1.25;
      const z = Math.sin(a) * r * 0.9;
      if (z > 330) continue;
      if (Math.abs(x) < 400 && z > -340) continue;
      let near = 0;
      for (const [cx, cz, s] of CLUSTERS) near = Math.max(near, s * Math.exp(-(((x - cx) / 330) ** 2 + ((z - cz) / 330) ** 2)));
      const reach = layer.rMin < 600 ? 0.6 : 1; // nearer towers stay shorter so they never wall off the sky
      const h = 26 + rng.range(0, 34) + near * rng.range(50, 170) * reach;
      const w = rng.range(16, 34), d = rng.range(16, 34);
      tower(b, x, z, w, d, h, layer, rng);
    }
  }
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.name = 'skyline';
  return mesh;
}

// A podium, a shaft, optionally a setback crown and a spire.
function tower(b, x, z, w, d, h, layer, rng) {
  const hw = w / 2, hd = d / 2;
  b.box(x - hw * 1.25, -2, z - hd * 1.25, x + hw * 1.25, h * 0.22, z + hd * 1.25, { side: layer.side, top: layer.top });
  b.box(x - hw, 0, z - hd, x + hw, h, z + hd, { side: layer.side, top: layer.top });
  const crown = rng();
  if (crown < 0.55) {
    b.box(x - hw * 0.6, h, z - hd * 0.6, x + hw * 0.6, h * 1.12, z + hd * 0.6, { side: layer.side, top: layer.top });
    if (crown < 0.25) b.box(x - 0.5, h * 1.12, z - 0.5, x + 0.5, h * 1.12 + h * 0.18, z + 0.5, layer.side); // antenna
  } else if (crown < 0.7) {
    b.slab([x - hw, z - hd, x + hw, z + hd], [x - 1, z - 1, x + 1, z + 1], h, h + hw * 1.4, layer.side); // pointed roof
  }
}
