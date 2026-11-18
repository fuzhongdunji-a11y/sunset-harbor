// rivalRacer: the Sunset GP rivals. RivalRacer steers one physics car along a gpCourse line (lane offset, traffic lookahead, corner braking, rubber band, mistakes, unstuck);
// RivalPack draws all three rivals as ONE mesh (one draw call): a merged body+wheels geometry with a per-vertex rival index, a 512x512 canvas livery atlas and a tiny vertex hook.
import * as THREE from '../vendor/three.module.min.js';
import { rivalParts } from './vehicleModels.js';
import { wrapAngle } from './roadDriver.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CORNER_REF = 17; // m/s a 12 m corner arc can really be taken at; a rival's cornerMult scales this (the brief's 0.76-0.86 is of a speed no road corner allows)
const BRAKE_DECEL = 20; // m/s^2 planned for corner braking
const SMOKE_TIME = 1.6; // seconds a mistake keeps the speed penalty

// Speed multiplier from the signed gap to the player (delta > 0: the player is ahead, so the rival catches up).
// Final 200 m of the race: tighter [0.94, 1.06] so a clean lead is never thrown away by last-second slingshotting.
export function rubberMultiplier(delta, remaining) {
  const m = 1 + (delta > 0 ? 0.0015 : 0.001) * delta;
  return remaining < 200 ? clamp(m, 0.94, 1.06) : clamp(m, 0.84, 1.18);
}

// ---- livery atlas -----------------------------------------------------------------------------------------------------------------------------------------------
// Quadrant q (0 Cruz, 1 Takahashi, 2 Bellini) is 256x256: top 128 rows = top-down (bonnet at the top), bottom rows = side view (front at the left), a 6px white patch in the corner
// for every vertex that is not body paint (so the vertex colour shows unchanged).
function drawQuadrant(g, q, p) {
  const ox = (q % 2) * 256, oy = Math.floor(q / 2) * 256;
  g.save();
  g.translate(ox, oy);
  g.fillStyle = p.base;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 6, 6);
  const top = (fn) => { g.save(); g.beginPath(); g.rect(8, 8, 240, 112); g.clip(); fn(); g.restore(); };
  const side = (fn) => { g.save(); g.beginPath(); g.rect(8, 130, 240, 118); g.clip(); fn(); g.restore(); };
  if (p.key === 'cruz') {
    top(() => { g.fillStyle = '#ff6b57'; g.fillRect(96, 8, 18, 112); g.fillRect(142, 8, 18, 112); });
    side(() => { g.fillStyle = '#ff6b57'; g.fillRect(8, 205, 240, 14); g.fillRect(8, 225, 240, 7); });
  } else if (p.key === 'takahashi') {
    top(() => { g.fillStyle = '#ffc531'; g.beginPath(); g.moveTo(60, 120); g.lineTo(100, 120); g.lineTo(200, 8); g.lineTo(160, 8); g.fill(); });
    side(() => { g.fillStyle = '#ffc531'; g.beginPath(); g.moveTo(70, 248); g.lineTo(122, 248); g.lineTo(190, 130); g.lineTo(138, 130); g.fill(); });
  } else {
    top(() => { g.fillStyle = '#ffffff'; g.fillRect(70, 8, 116, 40); g.fillStyle = '#9d1620'; g.fillRect(122, 8, 12, 40); });
    side(() => { g.fillStyle = '#ffffff'; g.fillRect(8, 238, 240, 6); });
  }
  // number roundels: on the doors (side view) and the roof (top view)
  const roundel = (cx, cy, r) => {
    g.fillStyle = p.roundel[0];
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = p.roundel[1];
    g.font = `900 ${Math.round(r * 1.15)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(p.num, cx, cy + 1);
  };
  side(() => roundel(128, 184, 30));
  top(() => roundel(128, 74, 24));
  g.restore();
}

export function buildLiveryAtlas(profiles) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  profiles.forEach((p, q) => drawQuadrant(g, q, p.livery));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Texture coordinate of one vertex of rival q's body.
function liveryUv(q, parts, i) {
  const ox = (q % 2) * 256, oy = Math.floor(q / 2) * 256;
  let cx, cy;
  if (!parts.paint[i]) {
    cx = ox + 3;
    cy = oy + 3;
  } else {
    const x = parts.pos[i * 3], y = parts.pos[i * 3 + 1], z = parts.pos[i * 3 + 2];
    const nx = parts.nrm[i * 3], ny = parts.nrm[i * 3 + 1];
    if (Math.abs(nx) > 0.5 && ny < 0.5) {
      // body side: front on the left of the picture as seen from outside (mirrored on the other flank)
      const u = nx > 0 ? 0.5 - z / (2 * parts.hl) : 0.5 + z / (2 * parts.hl);
      cx = ox + 8 + clamp(u, 0, 1) * 240;
      cy = oy + 248 - clamp((y - 0.3) / 1.1, 0, 1) * 118;
    } else {
      cx = ox + 8 + clamp(x / (2 * parts.hw) + 0.5, 0, 1) * 240;
      cy = oy + 8 + clamp(0.5 - z / (2 * parts.hl), 0, 1) * 112;
    }
  }
  return [cx / 512, 1 - cy / 512];
}

// ---- one draw call for all rivals ---------------------------------------------------------------------------------------------------------------------------------
export class RivalPack {
  constructor(scene, profiles) {
    const parts = profiles.map((p) => rivalParts(p.carType));
    const total = parts.reduce((s, p) => s + p.count, 0);
    const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = new Float32Array(total * 2), idx = new Float32Array(total);
    let o = 0;
    parts.forEach((p, q) => {
      pos.set(p.pos, o * 3);
      nrm.set(p.nrm, o * 3);
      col.set(p.col, o * 3);
      for (let i = 0; i < p.count; i++) {
        const [u, v] = liveryUv(q, p, i);
        uv[(o + i) * 2] = u;
        uv[(o + i) * 2 + 1] = v;
        idx[o + i] = q;
      }
      o += p.count;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aRival', new THREE.BufferAttribute(idx, 1));
    this.triangles = total / 3;
    this.matrices = profiles.map(() => new THREE.Matrix4().makeScale(0, 0, 0)); // a collapsed matrix hides a rival
    this.atlas = buildLiveryAtlas(profiles);
    const mat = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRival = { value: this.matrices };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRival;\nuniform mat4 uRival[3];')
        .replace('#include <beginnormal_vertex>', 'mat4 rivalM = uRival[int(aRival + 0.5)];\nvec3 objectNormal = mat3(rivalM) * normal;')
        .replace('#include <begin_vertex>', 'vec3 transformed = (rivalM * vec4(position, 1.0)).xyz;');
    };
    mat.customProgramCacheKey = () => 'sunsetGpRivalPack';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; // the vertex hook moves the cars; the stored bounds are meaningless
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  // Copy every rival car's pose into the shader's matrix array.
  sync(racers, camera) {
    racers.forEach((r, q) => {
      const v = r.v;
      const far = (v.x - camera.position.x) ** 2 + (v.z - camera.position.z) ** 2 > 420 * 420;
      if (far) {
        this.matrices[q].makeScale(0, 0, 0);
        return;
      }
      this._e.set(v.pitch, v.h, v.roll);
      this._q.setFromEuler(this._e);
      this.matrices[q].compose(this._p.set(v.x, v.y, v.z), this._q, this._s);
    });
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.atlas.dispose();
  }
}

// ---- the driver ---------------------------------------------------------------------------------------------------------------------------------------------------
export class RivalRacer {
  // profile: {name, short, top, cornerMult, mistake, lane, aggr, mass}; v: a VehicleManager.spawnRival car; rng: seeded for mistake rolls
  constructor(profile, v, course, rng) {
    this.p = profile;
    this.v = v;
    this.course = course;
    this.rng = rng;
    v.massMul = profile.mass ?? 1;
    v.topSpeed = profile.top * 1.3; // head room: the throttle controller regulates speed to the target
    this.s = 0; // arc position on the course (race progress D_i)
    this.hint = 0;
    this.lat = 0;
    this.avoid = 0; // lateral shift (m) from traffic avoidance, smoothed
    this.mult = 1; // last rubber-band multiplier
    this.target = 0; // target speed (m/s)
    this.mistakeT = 0; // seconds of mistake penalty left
    this.wide = 0; // extra outward offset (m) during a mistake
    this.lateT = 0; // brake delay left (0.35 s late braking)
    this.cornerSeen = -1; // last corner index a mistake was rolled for
    this.stuckT = 0;
    this.finished = false;
    this.finishTime = 0;
    this.mistakes = 0;
    this.resets = 0;
  }

  // Put the car on the course at arc position s with a lateral offset, at speed sp.
  place(s, lat, sp) {
    const c = this.course.pointAt(s);
    const v = this.v;
    v.x = c.x + c.nx * lat;
    v.z = c.z + c.nz * lat;
    v.h = Math.atan2(c.tx, c.tz);
    v.vx = c.tx * sp;
    v.vz = c.tz * sp;
    v.speedF = sp;
    v.steer = 0;
    v.wake = true;
    this.s = s;
    this.hint = Math.max(0, this.course.project(v.x, v.z, 0).i - 1);
    this.stuckT = 0;
  }

  // One AI step. ctx: {playerS (the player's race progress), player {x, z}, vehicles, time, frozen}
  update(dt, ctx) {
    const v = this.v, C = this.course, P = this.p;
    v.frozen = !!ctx.frozen;
    if (ctx.frozen) return;
    const pr = C.project(v.x, v.z, this.hint);
    this.hint = Math.max(0, pr.i - 1);
    this.s = Math.max(this.s, pr.s);
    this.lat = pr.lat;
    const sp = Math.max(0, v.speedF);
    if (!this.finished && this.s >= C.total) {
      this.finished = true;
      this.finishTime = ctx.time;
    }

    // rubber band against the player, then the mistake penalty
    this.mult = rubberMultiplier(ctx.playerS - this.s, C.total - this.s);
    if (this.mistakeT > 0) this.mistakeT -= dt;
    if (this.lateT > 0) this.lateT -= dt;
    const penalty = this.mistakeT > 0 ? 0.78 : 1;
    let target = P.top * this.mult * penalty;

    // corner planning: slow for the next corner arc, roll a mistake the first time a corner comes inside braking range
    const corner = C.corners.findIndex((c) => c.s1 > this.s);
    let inCorner = false;
    if (!this.finished && corner >= 0) {
      const c = C.corners[corner];
      const vc = CORNER_REF * P.cornerMult;
      const gap = c.s0 - this.s;
      inCorner = gap <= 0;
      const brakeDist = (Math.max(0, sp * sp - vc * vc)) / (2 * BRAKE_DECEL) + 4 - (this.lateT > 0 ? sp * 0.35 : 0);
      if (gap < brakeDist + 30 && corner !== this.cornerSeen) {
        this.cornerSeen = corner;
        const behind = this.s - ctx.playerS; // metres the player trails this rival by
        const pressure = behind > 0 && behind < 15 ? 2 : 1; // the player on the rival's bumper doubles the odds
        if (this.rng() < P.mistake * pressure) {
          this.mistakes++;
          this.lateT = 0.35;
          this.mistakeT = SMOKE_TIME;
          this.wide = c.right ? -2.5 : 2.5; // out toward the outer curb
        }
      }
      if (gap < brakeDist || inCorner) target = Math.min(target, vc * penalty);
    }
    if (this.mistakeT <= 0) this.wide *= Math.exp(-3 * dt);
    if (this.finished) {
      // roll out and stop inside the tail of the line
      const room = C.pts[C.pts.length - 1].s - this.s - 8;
      target = Math.min(14, Math.max(0, room * 0.6));
    }

    // lane + traffic lookahead: cars in an 18 m, +-20 degree cone are passed on the side with more room
    let want = P.lane + this.wide;
    let blockSpeed = Infinity;
    let shift = 0;
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    for (const o of ctx.vehicles) {
      if (o === v || o.kind === 'parked' || o.kind === 'target' || o.airborne) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > 18) continue;
      const side = -dx * fz + dz * fx; // lateral offset of o: positive = to our right
      if (Math.abs(Math.atan2(side, along)) > 0.35 || Math.abs(side) > 3.2) continue;
      shift += side > 0 ? -3.2 : 3.2;
      if (o.speedF < sp - 2 || o.kind !== 'rival') blockSpeed = Math.min(blockSpeed, Math.max(6, o.speedF) + (along - 6) * 0.5);
    }
    this.avoid += (clamp(shift, -3.2, 3.2) - this.avoid) * Math.min(1, 4 * dt);
    // the Enforcer sideswipes: a player within 3.5 m alongside pulls his line over
    if (P.aggr && ctx.player) {
      const dx = ctx.player.x - v.x, dz = ctx.player.z - v.z;
      const along = dx * fx + dz * fz, side = -dx * fz + dz * fx;
      if (Math.abs(along) < 3.5 && Math.abs(side) < 3.5) want = this.lat + clamp(side, -1.2, 1.2) * 1.5;
    }
    want = clamp(want + this.avoid, -6, 6);
    target = Math.min(target, blockSpeed);

    // steer at a look-ahead point on the (offset) line
    const L = clamp(5 + sp * 0.5, 8, 26);
    const q = C.pointAt(this.s + L);
    const tx = q.x + q.nx * want, tz = q.z + q.nz * want;
    const err = wrapAngle(Math.atan2(tx - v.x, tz - v.z) - v.h);
    v.input.steer = clamp(err * 1.9, -1, 1);
    v.input.hand = false;
    const dv = target - v.speedF;
    v.input.throttle = dv < -1.5 ? -1 : clamp(dv * 0.5, -0.2, 1);
    if (this.finished && sp < 0.5 && target < 0.5) v.input.throttle = 0;

    // wedged on something: after 3.0 s below 2 m/s, and out of the player's sight, drop back onto the line 15 m before the next gate at 18 m/s
    if (sp < 2 && !this.finished) this.stuckT += dt;
    else this.stuckT = 0;
    const far = ctx.player ? Math.hypot(ctx.player.x - v.x, ctx.player.z - v.z) > 35 : true;
    if (this.stuckT >= 3 && (far || this.stuckT >= 9)) this.recover();
  }

  recover() {
    const g = this.course.gateAhead(this.s);
    this.place(Math.max(0, Math.min(g.s - 15, this.course.total - 1)), this.p.lane * 0.5, 18);
    this.v.impact = 0;
    this.resets++;
  }

  // Race progress for the HUD and rank: arc position (a finished rival counts as the full length).
  get progress() {
    return this.finished ? this.course.total + 1 : this.s;
  }
}
