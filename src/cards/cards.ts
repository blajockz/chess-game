import { Chess, type Square } from "chess.js";

export type CardId =
  | "thief"
  | "overclock"
  | "hourglass"
  | "pause"
  | "shield"
  | "leap"
  | "swap"
  | "retreat";

export type CardDef = {
  id: CardId;
  name: string;
  kind: "time" | "board";
  cost: number;
  targets: 0 | 1 | 2;
  text: string;
};

export const CARDS: Record<CardId, CardDef> = {
  thief: {
    id: "thief",
    name: "Time Thief",
    kind: "time",
    cost: 3,
    targets: 0,
    text: "Take time from your opponent's clock and add it to yours.",
  },
  overclock: {
    id: "overclock",
    name: "Overclock",
    kind: "time",
    cost: 2,
    targets: 0,
    text: "Add time to your clock.",
  },
  hourglass: {
    id: "hourglass",
    name: "Hourglass",
    kind: "time",
    cost: 4,
    targets: 0,
    text: "Your opponent's clock runs twice as fast on their next move.",
  },
  pause: {
    id: "pause",
    name: "Pause",
    kind: "time",
    cost: 3,
    targets: 0,
    text: "Your clock stops while you think this turn.",
  },
  shield: {
    id: "shield",
    name: "Shield",
    kind: "board",
    cost: 3,
    targets: 1,
    text: "One of your pieces can't be captured on the next move.",
  },
  leap: {
    id: "leap",
    name: "Leap",
    kind: "board",
    cost: 2,
    targets: 1,
    text: "Push one of your pawns one square forward, then make your move.",
  },
  swap: {
    id: "swap",
    name: "Swap",
    kind: "board",
    cost: 4,
    targets: 2,
    text: "One of your knights and one of your bishops trade squares.",
  },
  retreat: {
    id: "retreat",
    name: "Retreat",
    kind: "board",
    cost: 3,
    targets: 1,
    text: "Send a rook, knight or bishop back to its starting square.",
  },
};

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export const HAND_SIZE = 4;
export const MAX_CHARGE = 6;
export const UNLOCK_PLY = 10;
export const CLOCK_FLOOR_MS = 10_000;

export const AMOUNTS = {
  Blitz: { steal: 10, bonus: 15, cap: 15 },
  Rapid: { steal: 30, bonus: 45, cap: 45 },
  Classical: { steal: 60, bonus: 90, cap: 90 },
} as const;

export type CardCategory = keyof typeof AMOUNTS;

export type Category = "Bullet" | "Blitz" | "Rapid" | "Classical";
export const BULLET_MAX = 179;

export function categoryOf(tc: { initial: number; increment: number; blackInitial?: number }): Category {
  const shortest = Math.min(tc.initial, tc.blackInitial ?? tc.initial);
  const e = shortest + 40 * tc.increment;
  if (e <= BULLET_MAX) return "Bullet";
  if (e < 600) return "Blitz";
  if (e < 1800) return "Rapid";
  return "Classical";
}

export function amountsFor(category: Category) {
  return AMOUNTS[(category === "Bullet" ? "Blitz" : category) as CardCategory];
}

export type ClockMods = {
  rate: number;
  extra: number;
  free: number;
};

export const NO_MODS: ClockMods = { rate: 1, extra: 0, free: 0 };

export function clockCost(mods: ClockMods, left: number, elapsed: number) {
  const freeUsed = Math.min(mods.free, elapsed);
  const counted = elapsed - freeUsed;
  const extra =
    mods.rate > 1
      ? Math.max(0, Math.min((mods.rate - 1) * counted, mods.extra, left - counted - CLOCK_FLOOR_MS))
      : 0;
  return { total: counted + extra, freeUsed, extra };
}

export function dealHand(random: (n: number) => number = (n) => Math.floor(Math.random() * n)): CardId[] {
  const pool = [...CARD_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, HAND_SIZE);
}

export type PlayedCard = {
  ply: number;
  side: "w" | "b";
  card: CardId;
  squares: string[];
  message: string;
};

export type Shield = { square: string; owner: "w" | "b"; untilPly: number };

export type CardsState = {
  hand: CardId[];
  used: { w: CardId[]; b: CardId[] };
  charge: { w: number; b: number };
  lastPlayed: { w: number; b: number };
  shield: Shield | null;
  log: PlayedCard[];
};

export function newCardsState(hand: CardId[] = dealHand()): CardsState {
  return {
    hand,
    used: { w: [], b: [] },
    charge: { w: 0, b: 0 },
    lastPlayed: { w: -1, b: -1 },
    shield: null,
    log: [],
  };
}

type Side = "w" | "b";
const FILES = "abcdefgh";

function allSquares(): Square[] {
  const out: Square[] = [];
  for (let r = 8; r >= 1; r--) for (const f of FILES) out.push((f + r) as Square);
  return out;
}
const SQUARES = allSquares();

const other = (s: Side): Side => (s === "w" ? "b" : "w");

const isDark = (sq: Square) => (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 1;

function homeSquares(type: string, side: Side): Square[] {
  const rank = side === "w" ? "1" : "8";
  if (type === "r") return [("a" + rank) as Square, ("h" + rank) as Square];
  if (type === "n") return [("b" + rank) as Square, ("g" + rank) as Square];
  if (type === "b") return [("c" + rank) as Square, ("f" + rank) as Square];
  return [];
}

function retreatSquare(chess: Chess, from: Square): Square | null {
  const piece = chess.get(from);
  if (!piece || !"rnb".includes(piece.type)) return null;
  const homes = homeSquares(piece.type, piece.color);
  if (homes.includes(from)) return null;
  let options = homes.filter((h) => !chess.get(h));
  if (piece.type === "b") options = options.filter((h) => isDark(h) === isDark(from));
  if (!options.length) return null;
  const file = FILES.indexOf(from[0]);
  options.sort((a, b) => Math.abs(FILES.indexOf(a[0]) - file) - Math.abs(FILES.indexOf(b[0]) - file));
  return options[0];
}

function leapSquare(chess: Chess, from: Square): Square | null {
  const piece = chess.get(from);
  if (!piece || piece.type !== "p") return null;
  const rank = Number(from[1]) + (piece.color === "w" ? 1 : -1);
  if (rank <= 1 || rank >= 8) return null;
  const to = (from[0] + rank) as Square;
  return chess.get(to) ? null : to;
}

type Edit = { from: Square; to: Square }[];

function editFor(card: CardId, chess: Chess, picks: Square[]): Edit | null {
  if (card === "leap") {
    const to = leapSquare(chess, picks[0]);
    return to ? [{ from: picks[0], to }] : null;
  }
  if (card === "retreat") {
    const to = retreatSquare(chess, picks[0]);
    return to ? [{ from: picks[0], to }] : null;
  }
  if (card === "swap") {
    if (picks.length < 2 || picks[0] === picks[1]) return null;
    if (chess.get(picks[0])?.type === chess.get(picks[1])?.type) return null;
    return [
      { from: picks[0], to: picks[1] },
      { from: picks[1], to: picks[0] },
    ];
  }
  return null;
}

function applyEdit(chess: Chess, edit: Edit) {
  const lifted = edit.map((e) => ({ piece: chess.get(e.from)!, to: e.to }));
  for (const e of edit) chess.remove(e.from);
  for (const l of lifted) chess.put(l.piece, l.to);
}

function safeAfter(chess: Chess, me: Side) {
  const myKing = chess.findPiece({ type: "k", color: me })[0];
  const theirKing = chess.findPiece({ type: "k", color: other(me) })[0];
  if (!myKing || !theirKing) return false;
  if (chess.isAttacked(myKing, other(me))) return false;
  if (chess.isAttacked(theirKing, me)) return false;
  return chess.moves().length > 0;
}

function tryOnCopy(card: CardId, fen: string, me: Side, picks: Square[]): Chess | null {
  const chess = new Chess(fen);
  const edit = editFor(card, chess, picks);
  if (!edit) return null;
  applyEdit(chess, edit);
  return safeAfter(chess, me) ? chess : null;
}

export function targetsFor(card: CardId, fen: string, me: Side, picks: string[] = []): string[] {
  const chess = new Chess(fen);
  const mine = (sq: Square, types: string) => {
    const p = chess.get(sq);
    return !!p && p.color === me && types.includes(p.type);
  };
  const ps = picks as Square[];

  if (card === "shield") {
    return ps.length ? [] : SQUARES.filter((sq) => mine(sq, "pnbrq"));
  }
  if (card === "leap") {
    return ps.length ? [] : SQUARES.filter((sq) => mine(sq, "p") && !!tryOnCopy(card, fen, me, [sq]));
  }
  if (card === "retreat") {
    return ps.length ? [] : SQUARES.filter((sq) => mine(sq, "rnb") && !!tryOnCopy(card, fen, me, [sq]));
  }
  if (card === "swap") {
    const minors = SQUARES.filter((sq) => mine(sq, "nb"));
    const differ = (a: Square, b: Square) => chess.get(a)?.type !== chess.get(b)?.type;
    const ok = (a: Square, b: Square) => differ(a, b) && !!tryOnCopy(card, fen, me, [a, b]);
    if (ps.length === 1) return minors.filter((sq) => ok(ps[0], sq));
    if (ps.length === 0) return minors.filter((a) => minors.some((b) => ok(a, b)));
  }
  return [];
}

export function applyBoardCard(
  card: CardId,
  fen: string,
  me: Side,
  picks: string[]
): { fen: string; squares: string[] } | null {
  const ps = picks as Square[];
  const after = tryOnCopy(card, fen, me, ps);
  if (!after) return null;
  const edit = editFor(card, new Chess(fen), ps)!;
  return { fen: after.fen(), squares: [...new Set(edit.flatMap((e) => [e.from, e.to]))] };
}

export function capturedSquare(move: { to: string; from: string; flags: string }) {
  return move.flags.includes("e") ? move.to[0] + move.from[1] : move.to;
}

export function shieldBroken(fen: string, shield: Shield) {
  const chess = new Chess(fen);
  if (!chess.isCheck()) return false;
  const king = chess.findPiece({ type: "k", color: other(shield.owner) })[0];
  return !!king && chess.attackers(king, shield.owner).includes(shield.square as Square);
}

export function liveShield(state: CardsState | null, fen: string, turn: Side, ply: number): Shield | null {
  const s = state?.shield;
  if (!s || turn === s.owner || ply >= s.untilPly) return null;
  return shieldBroken(fen, s) ? null : s;
}