import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type PieceType = "p" | "r" | "n" | "b" | "q" | "k";

type Pt = [number, number];

function finish(g: THREE.BufferGeometry, shade = 1) {
  const out = g.index ? g.toNonIndexed() : g;
  if (!out.getAttribute("uv")) {
    out.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute("position").count * 2), 2));
  }
  const n = out.getAttribute("position").count;
  const colors = new Float32Array(n * 3).fill(shade);
  out.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  for (const name of Object.keys(out.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(name)) out.deleteAttribute(name);
  }
  return out;
}

function lathe(points: Pt[], segments = 96) {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  const smooth = curve.getPoints(points.length * 8);
  smooth[0].x = 0;
  const last = smooth[smooth.length - 1];
  last.x = Math.max(0, last.x);
  return new THREE.LatheGeometry(smooth, segments);
}

function arc(cy: number, r: number, from: number, to: number, steps = 10, cx = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function foot(r: number, h = 1): Pt[] {
  return [
    [0, 0],
    [r, 0],
    [r + 0.005, 0.02 * h],
    [r, 0.045 * h],
    [r * 0.95, 0.065 * h],
    [r * 0.9, 0.08 * h],
    [r * 0.92, 0.1 * h],
    [r * 0.86, 0.125 * h],
    [r * 0.74, 0.14 * h],
    [r * 0.77, 0.155 * h],
    [r * 0.68, 0.175 * h],
  ];
}

function collar(y: number, r: number, stem: number): Pt[] {
  return [
    [stem, y - 0.03],
    [r * 0.95, y - 0.012],
    [r, y],
    [r * 0.95, y + 0.012],
    [stem * 1.05, y + 0.03],
  ];
}

function pawn() {
  return finish(
    lathe([
      ...foot(0.27),
      [0.18, 0.22],
      [0.13, 0.3],
      [0.105, 0.38],
      ...collar(0.43, 0.175, 0.1),
      [0.085, 0.47],
      ...arc(0.575, 0.13, -55, 90, 12),
    ])
  );
}

function rook() {
  const body = finish(
    lathe([
      ...foot(0.31),
      [0.23, 0.24],
      [0.2, 0.34],
      [0.185, 0.48],
      [0.19, 0.58],
      [0.22, 0.64],
      ...collar(0.66, 0.265, 0.21),
      [0.25, 0.7],
      [0.255, 0.79],
      [0.19, 0.79],
      [0.19, 0.74],
      [0, 0.74],
    ])
  );
  const parts: THREE.BufferGeometry[] = [body];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const start = (i / count) * Math.PI * 2 + 0.16;
    const len = (Math.PI * 2) / count - 0.36;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.255, start, start + len, false);
    shape.absarc(0, 0, 0.19, start + len, start, true);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.008,
      bevelSegments: 2,
      curveSegments: 10,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.79, 0);
    parts.push(finish(g));
  }
  return mergeGeometries(parts)!;
}

function bishop() {
  const body = finish(
    lathe([
      ...foot(0.29),
      [0.19, 0.24],
      [0.135, 0.36],
      [0.11, 0.5],
      ...collar(0.56, 0.19, 0.105),
      [0.1, 0.6],
      [0.13, 0.65],
      [0.155, 0.72],
      [0.15, 0.8],
      [0.12, 0.87],
      [0.07, 0.93],
      [0.035, 0.955],
      ...arc(1.0, 0.045, -75, 90, 8),
    ])
  );
  const slit = new THREE.BoxGeometry(0.31, 0.11, 0.022);
  slit.rotateZ(0.6);
  slit.translate(0.02, 0.83, 0);
  return mergeGeometries([body, finish(slit, 0.32)])!;
}

function queen() {
  const body = finish(
    lathe([
      ...foot(0.33),
      [0.21, 0.26],
      [0.145, 0.42],
      [0.12, 0.6],
      ...collar(0.67, 0.21, 0.115),
      [0.115, 0.72],
      [0.14, 0.8],
      [0.2, 0.92],
      [0.215, 0.95],
      [0.17, 0.965],
      [0.12, 0.98],
      ...arc(1.03, 0.065, -60, 90, 8),
    ])
  );
  const parts: THREE.BufferGeometry[] = [body];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const ball = new THREE.SphereGeometry(0.034, 16, 10);
    ball.translate(Math.cos(a) * 0.2, 0.955, Math.sin(a) * 0.2);
    parts.push(finish(ball));
  }
  return mergeGeometries(parts)!;
}

function king() {
  const body = finish(
    lathe([
      ...foot(0.34),
      [0.215, 0.27],
      [0.15, 0.45],
      [0.125, 0.64],
      ...collar(0.71, 0.215, 0.12),
      [0.12, 0.76],
      [0.145, 0.85],
      [0.2, 0.97],
      [0.19, 1.0],
      [0.09, 1.02],
      [0.06, 1.04],
      [0, 1.05],
    ])
  );
  const shape = new THREE.Shape();
  const w = 0.032;
  const arm = 0.09;
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, 0.1);
  shape.lineTo(arm, 0.095);
  shape.lineTo(arm + 0.01, 0.16);
  shape.lineTo(w, 0.155);
  shape.lineTo(w, 0.24);
  shape.lineTo(-w, 0.24);
  shape.lineTo(-w, 0.155);
  shape.lineTo(-arm - 0.01, 0.16);
  shape.lineTo(-arm, 0.095);
  shape.lineTo(-w, 0.1);
  shape.closePath();
  const cross = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 3,
  });
  cross.translate(0, 1.03, -0.025);
  return mergeGeometries([body, finish(cross)])!;
}

function len(x: number, y: number, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}

function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function scut(a: number, b: number, k: number) {
  return -smin(-a, b, k);
}

function ellipsoid(x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) {
  const px = (x - cx) / rx;
  const py = (y - cy) / ry;
  const pz = (z - cz) / rz;
  const k0 = len(px, py, pz);
  const k1 = len(px / rx, py / ry, pz / rz);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function cone(
  x: number, y: number, z: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  ra: number, rb: number, sx = 1, sz = 1
) {
  const px = (x - ax) / sx, py = y - ay, pz = (z - az) / sz;
  const dx = (bx - ax) / sx, dy = by - ay, dz = (bz - az) / sz;
  const t = Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
  const d = len(px - dx * t, py - dy * t, pz - dz * t) - (ra + (rb - ra) * t);
  return d * Math.min(1, sx, sz);
}

const PROFILE: Pt[] = [
  [0.155, 0.06], [0.16, 0.2], [0.19, 0.26], [0.205, 0.32], [0.195, 0.37], [0.165, 0.42], [0.125, 0.46], [0.095, 0.5],
  [0.085, 0.535], [0.09, 0.565], [0.115, 0.58], [0.16, 0.565], [0.21, 0.545], [0.255, 0.525], [0.284, 0.515],
  [0.298, 0.524], [0.302, 0.536], [0.32, 0.544], [0.337, 0.562], [0.345, 0.59], [0.338, 0.62], [0.315, 0.64],
  [0.26, 0.67], [0.19, 0.715], [0.13, 0.765], [0.085, 0.805], [0.04, 0.835], [-0.01, 0.85], [-0.06, 0.845],
  [-0.11, 0.815], [-0.155, 0.76], [-0.185, 0.68], [-0.2, 0.59], [-0.208, 0.5], [-0.206, 0.41], [-0.195, 0.33],
  [-0.175, 0.265], [-0.16, 0.2], [-0.155, 0.06],
];

const MANE: Pt[] = new THREE.SplineCurve(
  [[-0.03, 0.83], [-0.1, 0.79], [-0.15, 0.73], [-0.175, 0.64], [-0.185, 0.53], [-0.185, 0.42], [-0.172, 0.31], [-0.15, 0.24]].map(
    ([x, y]) => new THREE.Vector2(x, y)
  )
)
  .getPoints(24)
  .map((v) => [v.x, v.y]);

const SIDE = (() => {
  const curve = new THREE.SplineCurve(PROFILE.map(([x, y]) => new THREE.Vector2(x, y)));
  const line = curve.getPoints(PROFILE.length * 10);
  const x0 = -0.3, y0 = 0.02, cell = 0.0025, w = 300, h = 380;
  const table = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = y0 + j * cell;
    for (let i = 0; i < w; i++) {
      const x = x0 + i * cell;
      let best = Infinity;
      let inside = false;
      for (let k = 0, m = line.length - 1; k < line.length; m = k++) {
        const a = line[m], b = line[k];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const ex = x - a.x - dx * t, ey = y - a.y - dy * t;
        best = Math.min(best, ex * ex + ey * ey);
        if (a.y > y !== b.y > y && x < a.x + ((y - a.y) * dx) / dy) inside = !inside;
      }
      table[i + w * j] = inside ? -Math.sqrt(best) : Math.sqrt(best);
    }
  }
  return (x: number, y: number) => {
    const fx = (x - x0) / cell, fy = (y - y0) / cell;
    if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) return 0.05;
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const k = i + w * j;
    const top = table[k] + (table[k + 1] - table[k]) * tx;
    const bottom = table[k + w] + (table[k + w + 1] - table[k + w]) * tx;
    return top + (bottom - top) * ty;
  };
})();

function halfWidth(x: number, y: number) {
  const s = THREE.MathUtils.smoothstep;
  return 0.1 - 0.018 * s(y, 0.3, 0.62) - 0.026 * s(x, 0.12, 0.34) - 0.012 * s(-x, 0.1, 0.21);
}

function mane(x: number, y: number, z: number) {
  if (x > 0.02 || y < 0.2) return 0.1;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < MANE.length - 1; i++) {
    const [ax, ay] = MANE[i];
    const [bx, by] = MANE[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    const ex = x - ax - dx * t, ey = y - ay - dy * t;
    const d = ex * ex + ey * ey;
    if (d < best) {
      best = d;
      at = (i + t) / (MANE.length - 1);
    }
  }
  const taper = THREE.MathUtils.smoothstep(at, 0, 0.12);
  const ridge = len(Math.sqrt(best), z * 0.8) - (0.03 + 0.024 * taper);
  const lock = at * 15 + Math.abs(z) * 13 + Math.sin(at * 9) * 0.25;
  const groove = Math.pow(0.5 + 0.5 * Math.cos(lock * Math.PI * 2), 4) * 0.009 * taper;
  return ridge + groove;
}

function knightField(x: number, y: number, z: number) {
  const az = Math.abs(z);
  const side = SIDE(x, y);
  const w = halfWidth(x, y) + 0.014 * THREE.MathUtils.smoothstep(-side, 0.01, 0.09);
  const r = w * 0.85;
  const qx = side + r;
  const qy = az - w + r;
  let d = len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  d = smin(d, ellipsoid(x, y, az, 0.118, 0.632, 0.052, 0.072, 0.058, 0.04), 0.03);
  d = smin(d, cone(x, y, az, 0.088, 0.766, 0.07, 0.14, 0.758, 0.068, 0.011, 0.008), 0.016);
  d = scut(d, ellipsoid(x, y, az, 0.116, 0.737, 0.095, 0.03, 0.022, 0.022), 0.01);
  d = smin(d, ellipsoid(x, y, az, 0.117, 0.737, 0.075, 0.019, 0.015, 0.014), 0.006);
  d = smin(d, ellipsoid(x, y, az, 0.004, 0.878, 0.042, 0.024, 0.052, 0.032), 0.02);
  d = smin(d, cone(x, y, az, 0.008, 0.892, 0.042, 0.02, 0.938, 0.04, 0.026, 0.006, 0.8, 1.15), 0.025);
  d = scut(d, ellipsoid(x, y, az, 0.022, 0.884, 0.043, 0.01, 0.03, 0.014), 0.01);
  d = smin(d, ellipsoid(x, y, z, 0.04, 0.843, 0, 0.036, 0.013, 0.026), 0.018);
  d = scut(d, ellipsoid(x, y, az, 0.314, 0.592, 0.058, 0.009, 0.021, 0.011), 0.008);
  d = scut(d, cone(x, y, az, 0.3, 0.538, 0.04, 0.27, 0.541, 0.05, 0.0038, 0.0025), 0.006);
  d = smin(d, mane(x, y, z), 0.012);
  const ring = len(Math.max(len(x, z) - 0.19, 0), Math.max(Math.abs(y - 0.232) - 0.012, 0)) - 0.012;
  d = smin(d, ring, 0.05);
  return Math.max(d, 0.214 - y);
}

function sculpt(field: (x: number, y: number, z: number) => number, min: number[], max: number[], step: number) {
  const n = [0, 1, 2].map((a) => Math.ceil((max[a] - min[a]) / step) + 1);
  const [nx, ny, nz] = n;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const values = new Float32Array(nx * ny * nz);
  const C = 4;
  const far = new Uint8Array(Math.ceil(nx / C) * Math.ceil(ny / C) * Math.ceil(nz / C));
  const cx = Math.ceil(nx / C), cy = Math.ceil(ny / C);
  for (let k = 0; k < nz; k += C) {
    for (let j = 0; j < ny; j += C) {
      for (let i = 0; i < nx; i += C) {
        const d = field(min[0] + (i + C / 2) * step, min[1] + (j + C / 2) * step, min[2] + (k + C / 2) * step);
        if (Math.abs(d) > step * C * 1.2) far[i / C + cx * (j / C + cy * (k / C))] = d > 0 ? 1 : 2;
      }
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const f = far[Math.floor(i / C) + cx * (Math.floor(j / C) + cy * Math.floor(k / C))];
        values[at(i, j, k)] = f === 1 ? step * C : f === 2 ? -step * C : field(min[0] + i * step, min[1] + j * step, min[2] + k * step);
      }
    }
  }
  const probe = (x: number, y: number, z: number) => {
    const e = step * 0.25;
    const a = field(x + e, y - e, z - e);
    const b = field(x - e, y - e, z + e);
    const c = field(x - e, y + e, z - e);
    const d = field(x + e, y + e, z + e);
    const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
    const l = len(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l, (a + b + c + d) / 4];
  };
  const index = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const nor: number[] = [];
  const shade: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let neg = 0;
        for (let q = 0; q < 8; q++) {
          v[q] = values[at(i + corners[q][0], j + corners[q][1], k + corners[q][2])];
          if (v[q] < 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;
        let sx = 0, sy = 0, sz = 0, count = 0;
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
          sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
          sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
          count++;
        }
        if (!count) continue;
        let x = min[0] + (i + sx / count) * step;
        let y = min[1] + (j + sy / count) * step;
        let z = min[2] + (k + sz / count) * step;
        const g = probe(x, y, z);
        x -= g[0] * g[3];
        y -= g[1] * g[3];
        z -= g[2] * g[3];
        let occluded = 0;
        for (let s = 1; s <= 3; s++) {
          const h = s * 0.012;
          occluded += Math.max(0, h - field(x + g[0] * h, y + g[1] * h, z + g[2] * h)) / s;
        }
        index[at(i, j, k)] = pos.length / 3;
        pos.push(x, y, z);
        nor.push(g[0], g[1], g[2]);
        shade.push(Math.max(0.62, 1 - occluded * 9));
      }
    }
  }
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, b, c, a, c, d);
    else tris.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const inside = values[at(i, j, k)] < 0;
        if (i < nx - 1 && inside !== values[at(i + 1, j, k)] < 0) {
          quad(index[at(i, j - 1, k - 1)], index[at(i, j, k - 1)], index[at(i, j, k)], index[at(i, j - 1, k)], inside);
        }
        if (j < ny - 1 && inside !== values[at(i, j + 1, k)] < 0) {
          quad(index[at(i - 1, j, k - 1)], index[at(i - 1, j, k)], index[at(i, j, k)], index[at(i, j, k - 1)], inside);
        }
        if (k < nz - 1 && inside !== values[at(i, j, k + 1)] < 0) {
          quad(index[at(i - 1, j - 1, k)], index[at(i, j - 1, k)], index[at(i, j, k)], index[at(i - 1, j, k)], inside);
        }
      }
    }
  }
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(0.5 + (pos[i] * 0.8 + pos[i + 2] * 0.6) * 0.8, pos[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(shade.flatMap((s) => [s, s, s]), 3));
  g.setIndex(tris);
  return g.toNonIndexed();
}

function knight() {
  const base = finish(
    lathe([...foot(0.3), [0.22, 0.2], [0.2, 0.22], [0, 0.22]])
  );
  const head = sculpt(knightField, [-0.25, 0.2, -0.22], [0.37, 0.98, 0.22], 0.005);
  return mergeGeometries([base, head])!;
}

const cache = new Map<PieceType, THREE.BufferGeometry>();

export function pieceGeometry(type: PieceType) {
  let g = cache.get(type);
  if (!g) {
    g = { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king }[type]();
    g.computeBoundingBox();
    cache.set(type, g);
  }
  return g;
}

export function pieceHeight(type: PieceType) {
  return pieceGeometry(type).boundingBox!.max.y;
}