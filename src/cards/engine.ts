import { Chess, type Square } from "chess.js";
import type { CardId } from "./cards";

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

export function retreatSquare(chess: Chess, from: Square): Square | null {
  const piece = chess.get(from);
  if (!piece || !"rnb".includes(piece.type)) return null;
  const homes = homeSquares(piece.type, piece.color);
  if (homes.includes(from)) return null;

  let options = homes.filter((h) => !chess.get(h));
  if (piece.type === "b") options = options.filter((h) => isDark(h) === isDark(from));
  if (!options.length) return null;

  const file = FILES.indexOf(from[0]);
  options.sort(
    (a, b) => Math.abs(FILES.indexOf(a[0]) - file) - Math.abs(FILES.indexOf(b[0]) - file)
  );
  return options[0];
}

export function leapSquare(chess: Chess, from: Square): Square | null {
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

function tryOnCopy(card: CardId, chess: Chess, me: Side, picks: Square[]) {
  const edit = editFor(card, chess, picks);
  if (!edit) return false;
  const copy = new Chess(chess.fen());
  applyEdit(copy, edit);
  return safeAfter(copy, me);
}

export function targetsFor(card: CardId, chess: Chess, me: Side, picks: Square[] = []): Square[] {
  const mine = (sq: Square, types: string) => {
    const p = chess.get(sq);
    return !!p && p.color === me && types.includes(p.type);
  };

  if (card === "shield") {
    return picks.length ? [] : SQUARES.filter((sq) => mine(sq, "pnbrq"));
  }
  if (card === "leap") {
    return picks.length ? [] : SQUARES.filter((sq) => mine(sq, "p") && tryOnCopy(card, chess, me, [sq]));
  }
  if (card === "retreat") {
    return picks.length ? [] : SQUARES.filter((sq) => mine(sq, "rnb") && tryOnCopy(card, chess, me, [sq]));
  }
  if (card === "swap") {
    const minors = SQUARES.filter((sq) => mine(sq, "nb"));
    const differ = (a: Square, b: Square) => chess.get(a)?.type !== chess.get(b)?.type;
    const ok = (a: Square, b: Square) => differ(a, b) && tryOnCopy(card, chess, me, [a, b]);
    if (picks.length === 1) return minors.filter((sq) => ok(picks[0], sq));
    if (picks.length === 0) return minors.filter((a) => minors.some((b) => ok(a, b)));
  }
  return [];
}

export function applyBoardCard(
  card: CardId,
  chess: Chess,
  me: Side,
  picks: Square[]
): Square[] | null {
  if (!tryOnCopy(card, chess, me, picks)) return null;
  const edit = editFor(card, chess, picks)!;
  applyEdit(chess, edit);
  return [...new Set(edit.flatMap((e) => [e.from, e.to]))];
}

export function capturedSquare(move: { to: string; from: string; flags: string }) {
  return move.flags.includes("e") ? move.to[0] + move.from[1] : move.to;
}
