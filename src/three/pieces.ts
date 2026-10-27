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

function horseShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0);
  s.lineTo(0.17, 0);
  s.bezierCurveTo(0.19, 0.12, 0.11, 0.2, 0.1, 0.28);
  s.bezierCurveTo(0.12, 0.31, 0.2, 0.31, 0.28, 0.34);
  s.bezierCurveTo(0.33, 0.36, 0.345, 0.42, 0.315, 0.46);
  s.bezierCurveTo(0.27, 0.5, 0.2, 0.54, 0.155, 0.6);
  s.lineTo(0.15, 0.69);
  s.lineTo(0.115, 0.63);
  s.lineTo(0.085, 0.7);
  s.lineTo(0.055, 0.62);
  s.bezierCurveTo(-0.06, 0.64, -0.17, 0.57, -0.205, 0.44);
  s.bezierCurveTo(-0.235, 0.31, -0.19, 0.17, -0.225, 0.07);
  s.lineTo(-0.2, 0);
  return s;
}

function thickness(x: number, y: number) {
  const muzzle = THREE.MathUtils.smoothstep(x, 0.05, 0.33);
  const top = THREE.MathUtils.smoothstep(y, 0.5, 0.7);
  return 1 - muzzle * 0.38 - top * 0.3;
}

function knight() {
  const base = finish(
    lathe([...foot(0.3), [0.22, 0.2], [0.2, 0.22], [0, 0.22]])
  );
  const depth = 0.26;
  const head = new THREE.ExtrudeGeometry(horseShape(), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.04,
    bevelSegments: 6,
    curveSegments: 28,
  });
  head.translate(0, 0, -depth / 2);
  const pos = head.getAttribute("position");
  const nor = head.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    const k = thickness(pos.getX(i), pos.getY(i));
    pos.setZ(i, pos.getZ(i) * k);
    const nz = nor.getZ(i) / k;
    const len = Math.hypot(nor.getX(i), nor.getY(i), nz);
    nor.setXYZ(i, nor.getX(i) / len, nor.getY(i) / len, nz / len);
  }
  head.translate(0, 0.2, 0);

  const parts = [base, finish(head)];
  for (const side of [1, -1]) {
    const eye = new THREE.SphereGeometry(0.03, 14, 10);
    eye.scale(1.2, 0.8, 0.6);
    const z = ((depth / 2 + 0.06) * thickness(0.17, 0.55) - 0.012) * side;
    eye.translate(0.17, 0.75, z);
    parts.push(finish(eye, 0.12));
  }
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const ridge = new THREE.CapsuleGeometry(0.018, 0.07, 4, 8);
    ridge.rotateZ(1.1 - t * 0.4);
    ridge.translate(-0.08 - t * 0.12, 0.8 - t * 0.36, 0);
    parts.push(finish(ridge, 0.85));
  }
  return mergeGeometries(parts)!;
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
