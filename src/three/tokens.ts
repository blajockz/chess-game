import type { Square } from "chess.js";
import { BOARD_SIZE } from "./materials";

export type Side = "w" | "b";
export type Cell = { square: Square; type: string; color: Side } | null;

export type MotionKind = "move" | "hop" | "capture" | "return" | "spawn";
export type Motion = { kind: MotionKind; startAt: number; duration: number };

export type Token = {
  id: number;
  type: string;
  color: Side;
  square: Square | null;
  order: number;
  motion: Motion | null;
};

export type Impact = { id: number; x: number; y: number; z: number; at: number; strong: boolean };

export type Pose = { x: number; y: number; z: number; yaw: number };

const FILES = "abcdefgh";
const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

export const TABLE_Y = -0.36;
export const SETTLE = 0.4;

export function at(square: string): [number, number] {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  return [f - 3.5, 4.5 - r];
}

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function baseYaw(type: string, color: Side) {
  return type === "n" ? (color === "w" ? Math.PI / 2 : -Math.PI / 2) + 0.95 : 0;
}

export function gravePose(color: Side, index: number, id: number, type: string): Pose {
  const col = Math.floor(index / 8);
  const row = index % 8;
  const edge = BOARD_SIZE / 2 + 0.58 + col * 0.76;
  const jitterX = (hash(id) - 0.5) * 0.12;
  const jitterZ = (hash(id + 7) - 0.5) * 0.1;
  const yaw = baseYaw(type, color) + (hash(id + 3) - 0.5) * 0.9;
  if (color === "b") return { x: edge + jitterX, y: TABLE_Y, z: 1.7 - row * 0.8 + jitterZ, yaw };
  return { x: -edge + jitterX, y: TABLE_Y, z: -1.7 + row * 0.8 + jitterZ, yaw };
}

export function squarePose(square: string, type: string, color: Side): Pose {
  const [x, z] = at(square);
  return { x, y: 0, z, yaw: baseYaw(type, color) };
}

export function poses(tokens: Token[]): Map<number, Pose> {
  const out = new Map<number, Pose>();
  const graves: Record<Side, Token[]> = { w: [], b: [] };
  for (const t of tokens) {
    if (t.square) out.set(t.id, squarePose(t.square, t.type, t.color));
    else graves[t.color].push(t);
  }
  for (const side of ["w", "b"] as Side[]) {
    graves[side].sort((a, b) => a.order - b.order);
    graves[side].forEach((t, i) => out.set(t.id, gravePose(side, i, t.id, t.type)));
  }
  return out;
}

function expectedGrave(cells: NonNullable<Cell>[], color: Side): Record<string, number> {
  const count: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  for (const c of cells) if (c.color === color) count[c.type]++;
  let promoted = 0;
  const out: Record<string, number> = {};
  for (const t of ["n", "b", "r", "q"]) {
    out[t] = Math.max(0, START[t] - count[t]);
    promoted += Math.max(0, count[t] - START[t]);
  }
  out.p = Math.max(0, 8 - count.p - promoted);
  out.k = 0;
  return out;
}

function distance(a: Pose, b: Pose) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function moveDuration(kind: MotionKind, from: Pose, to: Pose) {
  const d = distance(from, to);
  if (kind === "capture" || kind === "return") return 0.85 + Math.min(0.35, d * 0.03);
  if (kind === "spawn") return 0.55;
  if (kind === "hop") return 0.5;
  return Math.min(0.7, 0.26 + d * 0.065);
}

export type Ledger = {
  key: string;
  tokens: Token[];
  impacts: Impact[];
  nextId: number;
  nextOrder: number;
};

export function emptyLedger(): Ledger {
  return { key: "", tokens: [], impacts: [], nextId: 1, nextOrder: 1 };
}

export function boardKey(board: Cell[][]) {
  return board
    .flat()
    .map((c) => (c ? c.color + c.type + c.square : ""))
    .join(",");
}

export function reconcile(
  ledger: Ledger,
  board: Cell[][],
  lastMove: { from: Square; to: Square } | null,
  now: number,
  animate: boolean
): Ledger {
  const key = boardKey(board);
  if (key === ledger.key) return ledger;

  let nextId = ledger.nextId;
  let nextOrder = ledger.nextOrder;
  const cells = board.flat().filter((c): c is NonNullable<Cell> => !!c);
  const first = ledger.tokens.length === 0;
  const before = poses(ledger.tokens);

  const kept: Token[] = [];
  const left: Token[] = [];
  const graves: Token[] = [];
  const taken = new Set<string>();
  const bySquare = new Map(cells.map((c) => [c.square as string, c]));

  for (const t of ledger.tokens) {
    if (!t.square) {
      graves.push(t);
      continue;
    }
    const c = bySquare.get(t.square);
    if (c && c.color === t.color && c.type === t.type && !taken.has(t.square)) {
      kept.push(t);
      taken.add(t.square);
    } else {
      left.push(t);
    }
  }

  const arrived = cells.filter((c) => !taken.has(c.square));
  const moved: { token: Token; cell: NonNullable<Cell> }[] = [];
  const returned: { token: Token; cell: NonNullable<Cell> }[] = [];
  const spawned: NonNullable<Cell>[] = [];

  const closest = (cell: NonNullable<Cell>, pool: Token[], ok: (t: Token) => boolean) => {
    const target = squarePose(cell.square, cell.type, cell.color);
    let best: Token | null = null;
    let bestScore = Infinity;
    for (const t of pool) {
      if (!ok(t)) continue;
      const p = before.get(t.id)!;
      let score = distance(p, target);
      if (lastMove && t.square === lastMove.from && cell.square === lastMove.to) score -= 100;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  };

  let pending = arrived;
  for (const pass of [0, 2, 1]) {
    const still: NonNullable<Cell>[] = [];
    for (const cell of pending) {
      const pool = pass === 2 ? graves : left;
      const match = closest(cell, pool, (t) =>
        t.color === cell.color && (pass === 1 ? true : t.type === cell.type)
      );
      if (!match) {
        still.push(cell);
        continue;
      }
      pool.splice(pool.indexOf(match), 1);
      (pass === 2 ? returned : moved).push({ token: match, cell });
    }
    pending = still;
  }
  spawned.push(...pending);

  const captured = left;
  const result: Token[] = [...kept, ...graves];
  const moving = moved.length + returned.length + captured.length + spawned.length;
  const cascade = moving > 5;
  let stagger = 0;
  const delayFor = () => (cascade ? (stagger++ * 0.035) : 0);
  const hasCapture = !cascade && captured.length > 0;

  const motion = (kind: MotionKind, from: Pose | undefined, to: Pose, delay: number): Motion | null => {
    if (!animate || first) return null;
    const start = from ?? { ...to, y: to.y + 2.5 };
    return { kind, startAt: now + delay, duration: moveDuration(kind, start, to) };
  };

  const fresh: { token: Token; from: Pose | undefined; kind: MotionKind; delay: number }[] = [];

  for (const t of captured) {
    const token: Token = { ...t, square: null, order: nextOrder++ };
    result.push(token);
    fresh.push({ token, from: before.get(t.id), kind: "capture", delay: delayFor() });
  }
  for (const { token: t, cell } of moved) {
    const token: Token = { ...t, square: cell.square, type: cell.type };
    result.push(token);
    const kind: MotionKind = cell.type === "n" && t.type === "n" ? "hop" : "move";
    fresh.push({ token, from: before.get(t.id), kind, delay: hasCapture ? 0.22 : delayFor() });
  }
  for (const { token: t, cell } of returned) {
    const token: Token = { ...t, square: cell.square, type: cell.type };
    result.push(token);
    fresh.push({ token, from: before.get(t.id), kind: "return", delay: delayFor() });
  }
  for (const cell of spawned) {
    const token: Token = { id: nextId++, type: cell.type, color: cell.color, square: cell.square, order: 0, motion: null };
    result.push(token);
    fresh.push({ token, from: undefined, kind: "spawn", delay: delayFor() });
  }

  for (const side of ["w", "b"] as Side[]) {
    const want = expectedGrave(cells, side);
    for (const type of Object.keys(want)) {
      const mine = result
        .filter((t) => !t.square && t.color === side && t.type === type)
        .sort((a, b) => a.order - b.order);
      for (let i = mine.length; i < want[type]; i++) {
        result.push({ id: nextId++, type, color: side, square: null, order: nextOrder++, motion: null });
      }
      for (const extra of mine.slice(want[type])) result.splice(result.indexOf(extra), 1);
    }
  }

  const after = poses(result);
  const impacts: Impact[] = [];
  let impactId = ledger.impacts.reduce((m, i) => Math.max(m, i.id), 0) + 1;
  for (const f of fresh) {
    if (!result.includes(f.token)) continue;
    const to = after.get(f.token.id)!;
    f.token.motion = motion(f.kind, f.from, to, f.delay);
    if (!f.token.motion || cascade) continue;
    const landAt = f.token.motion.startAt + f.token.motion.duration;
    if (f.kind === "capture") impacts.push({ id: impactId++, x: to.x, y: to.y, z: to.z, at: landAt, strong: false });
    if (hasCapture && f.kind !== "capture" && f.token.square === lastMove?.to) {
      impacts.push({ id: impactId++, x: to.x, y: 0, z: to.z, at: landAt, strong: true });
    }
  }

  return {
    key,
    tokens: result,
    impacts: [...ledger.impacts.filter((i) => i.at > now - 2), ...impacts],
    nextId,
    nextOrder,
  };
}
