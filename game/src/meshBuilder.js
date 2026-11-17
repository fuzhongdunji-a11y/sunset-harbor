// MeshBuilder: accumulates flat-shaded, vertex-coloured triangles so a whole city layer merges into one draw call.
import * as THREE from '../vendor/three.module.min.js';

const colorCache = new Map();
export function toColor(c) {
  if (c && c.isColor) return c;
  let col = colorCache.get(c);
  if (!col) {
    col = new THREE.Color(c);
    colorCache.set(c, col);
  }
  return col;
}

const _t = new THREE.Vector3();

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.uv = [];
    this.matrix = null; // optional transform applied to every vertex
    this.uvTile = 0; // >0: generate wall UVs, one texture tile per uvTile metres
  }

  setTransform(matrix) {
    this.matrix = matrix;
    return this;
  }

  setUvTile(tile) {
    this.uvTile = tile;
    return this;
  }

  tri(a, b, c, color) {
    const col = toColor(color);
    let pa = a, pb = b, pc = c;
    if (this.matrix) {
      pa = this._xf(a);
      pb = this._xf(b);
      pc = this._xf(c);
    }
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
    const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    for (const p of [pa, pb, pc]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(col.r, col.g, col.b);
      if (this.uvTile > 0) {
        const u = Math.abs(nx) > Math.abs(nz) ? p[2] : p[0];
        this.uv.push(u / this.uvTile, p[1] / this.uvTile);
      } else {
        this.uv.push(0, 0);
      }
    }
  }

  _xf(p) {
    _t.set(p[0], p[1], p[2]).applyMatrix4(this.matrix);
    return [_t.x, _t.y, _t.z];
  }

  // Quad a-b-c-d; `hint` is an approximate outward direction used to fix the winding.
  quad(a, b, c, d, color, hint) {
    if (hint) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const n0 = uy * vz - uz * vy, n1 = uz * vx - ux * vz, n2 = ux * vy - uy * vx;
      if (n0 * hint[0] + n1 * hint[1] + n2 * hint[2] < 0) [b, d] = [d, b];
    }
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  // Frustum between a bottom rect and a top rect ([x0, z0, x1, z1]); colors: Color | {side, top, bottom}.
  slab(bottom, top, y0, y1, colors, opts = {}) {
    const c = colors && (colors.side !== undefined || colors.top !== undefined) ? colors : { side: colors, top: colors, bottom: colors };
    const bl = [
      [bottom[0], y0, bottom[1]],
      [bottom[2], y0, bottom[1]],
      [bottom[2], y0, bottom[3]],
      [bottom[0], y0, bottom[3]],
    ];
    const tl = [
      [top[0], y1, top[1]],
      [top[2], y1, top[1]],
      [top[2], y1, top[3]],
      [top[0], y1, top[3]],
    ];
    const cx = (bottom[0] + bottom[2] + top[0] + top[2]) / 4;
    const cz = (bottom[1] + bottom[3] + top[1] + top[3]) / 4;
    const cy = (y0 + y1) / 2;
    if (opts.sides !== false && c.side !== undefined) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const mx = (bl[i][0] + bl[j][0] + tl[i][0] + tl[j][0]) / 4 - cx;
        const mz = (bl[i][2] + bl[j][2] + tl[i][2] + tl[j][2]) / 4 - cz;
        this.quad(bl[i], bl[j], tl[j], tl[i], c.side, [mx, 0, mz]);
      }
    }
    if (opts.top !== false && c.top !== undefined) this.quad(tl[0], tl[1], tl[2], tl[3], c.top, [0, 1, 0]);
    if (opts.bottom && c.bottom !== undefined) this.quad(bl[0], bl[1], bl[2], bl[3], c.bottom, [0, -1, 0]);
    void cy;
  }

  box(x0, y0, z0, x1, y1, z1, colors, opts) {
    this.slab([x0, z0, x1, z1], [x0, z0, x1, z1], y0, y1, colors, opts);
  }

  // Horizontal rectangle facing up.
  flat(x0, z0, x1, z1, y, color) {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], color, [0, 1, 0]);
  }

  // Merge an indexed or non-indexed three.js geometry (flat shaded) with a single colour.
  addGeometry(geometry, color) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      this.tri([p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)], color);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
