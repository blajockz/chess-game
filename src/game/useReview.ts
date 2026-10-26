import { useEffect, useMemo, useState } from "react";
import { Chess, type Move, type Square } from "chess.js";

const START = new Chess().fen();

export type ReviewPosition = {
  board: ReturnType<Chess["board"]>;
  lastMove: { from: Square; to: Square } | null;
  checkSquare: Square | null;
  move: Move | null;
};

export function positionAt(moves: Move[], ply: number): ReviewPosition {
  const move = ply > 0 ? moves[ply - 1] : null;
  const fen = move ? move.after : (moves[0]?.before ?? START);
  const chess = new Chess(fen);
  let checkSquare: Square | null = null;
  if (chess.isCheck()) {
    checkSquare = (chess.findPiece({ type: "k", color: chess.turn() })[0] as Square) ?? null;
  }
  return {
    board: chess.board(),
    lastMove: move ? { from: move.from as Square, to: move.to as Square } : null,
    checkSquare,
    move,
  };
}

type Options = {
  moves: Move[];
  gameId: number;
  keysOff?: boolean;
  onStep?: (move: Move | null, forward: boolean) => void;
};

export function useReview({ moves, gameId, keysOff = false, onStep }: Options) {
  const [ply, setPly] = useState<number | null>(null);
  const total = moves.length;

  useEffect(() => setPly(null), [gameId]);

  const current = ply === null || ply >= total ? total : ply;
  const viewing = ply !== null && ply < total;

  function go(target: number) {
    const next = Math.max(0, Math.min(total, target));
    if (next === current) return;
    onStep?.(next > 0 ? moves[next - 1] : null, next > current);
    setPly(next >= total ? null : next);
  }

  const nav = {
    first: () => go(0),
    prev: () => go(current - 1),
    next: () => go(current + 1),
    last: () => go(total),
    jump: (target: number) => go(target),
    live: () => setPly(null),
  };

  useEffect(() => {
    if (keysOff) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const action =
        e.key === "ArrowLeft"
          ? nav.prev
          : e.key === "ArrowRight"
            ? nav.next
            : e.key === "Home"
              ? nav.first
              : e.key === "End"
                ? nav.last
                : null;
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const position = useMemo(
    () => (viewing ? positionAt(moves, current) : null),
    [viewing, current, total, gameId]
  );

  return {
    current,
    total,
    viewing,
    position,
    canBack: current > 0,
    canForward: current < total,
    ...nav,
  };
}
