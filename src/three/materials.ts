import * as THREE from "three";

function makePerlin(seed: number) {
  const p = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0 || 1;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h: number, x: number, y: number) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  return (x: number, y: number) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const a = p[X] + Y;
    const b = p[X + 1] + Y;
    const x1 = grad(p[a], xf, yf) + u * (grad(p[b], xf - 1, yf) - grad(p[a], xf, yf));
    const x2 = grad(p[a + 1], xf, yf - 1) + u * (grad(p[b + 1], xf - 1, yf - 1) - grad(p[a + 1], xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

type Species = {
  early: [number, number, number];
  late: [number, number, number];
  rings: number;
  figure: number;
  pores: number;
};

export const SPECIES = {
  maple: { early: [221, 186, 139], late: [199, 157, 106], rings: 22, figure: 0.32, pores: 0.08 },
  walnut: { early: [112, 68, 40], late: [82, 47, 25], rings: 18, figure: 0.45, pores: 0.35 },
  rosewood: { early: [86, 44, 26], late: [52, 24, 13], rings: 20, figure: 0.55, pores: 0.3 },
  boxwood: { early: [214, 184, 136], late: [192, 158, 108], rings: 10, figure: 0.3, pores: 0.03 },
  ebony: { early: [38, 29, 25], late: [20, 14, 11], rings: 18, figure: 0.4, pores: 0.15 },
} satisfies Record<string, Species>;

type Region = { x: number; y: number; w: number; h: number; wood: Species; seed: number; along: "x" | "y" };

type WoodMaps = { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };

function paintWood(size: number, regions: Region[], extra?: (ctx: CanvasRenderingContext2D) => void): WoodMaps {
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const rough = new Uint8ClampedArray(size * size * 4);

  for (const r of regions) {
    const n = makePerlin(r.seed);
    const n2 = makePerlin(r.seed * 7 + 3);
    const { wood } = r;
    const x0 = Math.floor(r.x);
    const y0 = Math.floor(r.y);
    const x1 = Math.min(size, Math.ceil(r.x + r.w));
    const y1 = Math.min(size, Math.ceil(r.y + r.h));
    const across = r.along === "x" ? r.h : r.w;
    const offset = (r.seed % 97) / 97;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const u = (r.along === "x" ? px - r.x : py - r.y) / size;
        const v = (r.along === "x" ? py - r.y : px - r.x) / across;
        const warp = n(u * 3, v * 2) * wood.figure + n(u * 9, v * 6) * 0.25;
        const ring = (v * wood.rings + warp + offset) % 1;
        const band = Math.pow(Math.abs(ring * 2 - 1), 6);
        const fibre = n2(u * 5, v * 260) * 0.5 + n2(u * 12, v * 640) * 0.25;
        const poreN = n2(u * 40, v * 900);
        const pore = poreN > 0.62 - wood.pores * 0.2 ? (poreN - 0.5) * wood.pores * 2.2 : 0;
        const t = Math.min(1, Math.max(0, band * 0.75 + fibre * 0.18 + pore * 0.4));
        const i = py * size + px;
        const k = i * 4;
        const shade = 1 + fibre * 0.06;
        color[k] = (wood.early[0] + (wood.late[0] - wood.early[0]) * t) * shade;
        color[k + 1] = (wood.early[1] + (wood.late[1] - wood.early[1]) * t) * shade;
        color[k + 2] = (wood.early[2] + (wood.late[2] - wood.early[2]) * t) * shade;
        color[k + 3] = 255;
        height[i] = band * 0.6 + fibre * 0.35 - pore * 1.2;
        const ro = 95 + band * 35 + pore * 120 + fibre * 10;
        rough[k] = rough[k + 1] = rough[k + 2] = ro;
        rough[k + 3] = 255;
      }
    }
  }

  const normal = new Uint8ClampedArray(size * size * 4);
  const strength = 1.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = height[y * size + Math.max(0, x - 1)];
      const rr = height[y * size + Math.min(size - 1, x + 1)];
      const u = height[Math.max(0, y - 1) * size + x];
      const d = height[Math.min(size - 1, y + 1) * size + x];
      let nx = (l - rr) * strength;
      let ny = (u - d) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const k = i * 4;
      normal[k] = (nx * 0.5 + 0.5) * 255;
      normal[k + 1] = (ny * 0.5 + 0.5) * 255;
      normal[k + 2] = (nz / len) * 0.5 * 255 + 127;
      normal[k + 3] = 255;
    }
  }

  const toCanvas = (data: Uint8ClampedArray, after?: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    after?.(ctx);
    return c;
  };

  const map = new THREE.CanvasTexture(toCanvas(color, extra));
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(toCanvas(rough));
  const normalMap = new THREE.CanvasTexture(toCanvas(normal));
  for (const t of [map, roughnessMap, normalMap]) {
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, roughnessMap, normalMap };
}

const FILES = "abcdefgh";
export const BOARD_SIZE = 9.4;
const FRAME = (BOARD_SIZE - 8) / 2;

export function boardMaps(size = 2048): WoodMaps {
  const px = size / BOARD_SIZE;
  const frame = FRAME * px;
  const sq = px;
  const regions: Region[] = [
    { x: 0, y: 0, w: size, h: frame, wood: SPECIES.rosewood, seed: 11, along: "x" },
    { x: 0, y: size - frame, w: size, h: frame, wood: SPECIES.rosewood, seed: 12, along: "x" },
    { x: 0, y: frame, w: frame, h: size - frame * 2, wood: SPECIES.rosewood, seed: 13, along: "y" },
    { x: size - frame, y: frame, w: frame, h: size - frame * 2, wood: SPECIES.rosewood, seed: 14, along: "y" },
  ];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const light = (r + f) % 2 === 0;
      regions.push({
        x: frame + f * sq,
        y: frame + r * sq,
        w: sq,
        h: sq,
        wood: light ? SPECIES.maple : SPECIES.walnut,
        seed: 101 + r * 13 + f * 7,
        along: (r + f) % 4 < 2 ? "x" : "y",
      });
    }
  }
  return paintWood(size, regions, (ctx) => {
    ctx.strokeStyle = "rgba(226, 196, 140, 0.95)";
    ctx.lineWidth = px * 0.035;
    const inset = frame - px * 0.06;
    ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
    ctx.strokeStyle = "rgba(20, 10, 4, 0.35)";
    ctx.lineWidth = Math.max(1, px * 0.006);
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(frame + i * sq, frame);
      ctx.lineTo(frame + i * sq, size - frame);
      ctx.moveTo(frame, frame + i * sq);
      ctx.lineTo(size - frame, frame + i * sq);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(214, 178, 104, 0.9)";
    ctx.font = `600 ${Math.round(frame * 0.4)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 8; i++) {
      const c = frame + sq * (i + 0.5);
      const label = (text: string, x: number, y: number, rot: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      };
      label(FILES[i], c, size - frame / 2, 0);
      label(FILES[i], c, frame / 2, Math.PI);
      label(String(8 - i), frame / 2, c, 0);
      label(String(8 - i), size - frame / 2, c, Math.PI);
    }
  });
}

export function plankMaps(wood: Species, seed: number, size = 1024): WoodMaps {
  return paintWood(size, [{ x: 0, y: 0, w: size, h: size, wood, seed, along: "x" }]);
}

let pieceMaps: { w: WoodMaps; b: WoodMaps } | null = null;

export function pieceMaterial(color: "w" | "b") {
  pieceMaps ??= { w: plankMaps(SPECIES.boxwood, 41, 512), b: plankMaps(SPECIES.ebony, 43, 512) };
  const m = pieceMaps[color];
  const mat = new THREE.MeshPhysicalMaterial({
    map: m.map,
    roughnessMap: m.roughnessMap,
    normalMap: m.normalMap,
    normalScale: new THREE.Vector2(0.06, 0.06),
    roughness: color === "w" ? 0.5 : 0.36,
    clearcoat: color === "w" ? 0.8 : 1,
    clearcoatRoughness: color === "w" ? 0.2 : 0.1,
    sheen: color === "w" ? 0.08 : 0.1,
    sheenColor: new THREE.Color(color === "w" ? "#fff3dc" : "#5a4636"),
    vertexColors: true,
  });
  return mat;
}
