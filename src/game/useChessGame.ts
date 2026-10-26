import { useEffect, useRef, useState } from "react";
import { Chess, type Move, type Square } from "chess.js";
import { useSounds } from "./useSounds";

export type PromotionPiece = "q" | "r" | "b" | "n";

export type Pending = { from: Square; to: Square; color: "w" | "b" };

export type Premove = { from: Square; to: Square };

const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const ORDER = ["q", "r", "b", "n", "p"];

export function useChessGame(
  soundOn: boolean,
  playerColor: "w" | "b" | null = null,
  autoOpponent = false,
  frozen?: { current: boolean },
  moveFilter?: (move: Move) => boolean,
  onLocalMove?: (move: { from: string; to: string; promotion?: string; ply: number }) => void
) {
  const gameRef = useRef(new Chess());
  const game = gameRef.current;
  const earlier = useRef<Move[]>([]);
  const play = useSounds(soundOn);

  const [, setTick] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [premove, setPremove] = useState<Premove | null>(null);
  const [premoveFrom, setPremoveFrom] = useState<Square | null>(null);
  const [gameId, setGameId] = useState(0);

  function reset() {
    gameRef.current = new Chess();
    earlier.current = [];
    setSelected(null);
    setPending(null);
    setPremove(null);
    setPremoveFrom(null);
    setGameId((g) => g + 1);
  }

  const refresh = () => setTick((t) => t + 1);

  const filterRef = useRef(moveFilter);
  filterRef.current = moveFilter;
  const localRef = useRef(onLocalMove);
  localRef.current = onLocalMove;

  function allowed(square?: Square): Move[] {
    const g = gameRef.current;
    const f = filterRef.current;
    const list = square ? g.moves({ square, verbose: true }) : g.moves({ verbose: true });
    if (!f) return list;
    const everything = g.moves({ verbose: true });
    if (!everything.some(f)) return list;
    return list.filter(f);
  }

  const legalTargets: Square[] = selected ? allowed(selected).map((m) => m.to as Square) : [];

  function panOf(square: Square) {
    const file = square.charCodeAt(0) - 97;
    return ((file - 3.5) / 3.5) * 0.4;
  }

  function commit(from: Square, to: Square, promotion?: PromotionPiece, local = true) {
    const g = gameRef.current;
    const plyBefore = earlier.current.length + g.history().length;
    let move: Move | null = null;
    try {
      move = g.move({ from, to, promotion: promotion ?? "q" });
    } catch {
      move = null;
    }
    if (move && local) {
      localRef.current?.({ from: move.from, to: move.to, promotion: move.promotion, ply: plyBefore });
    }
    if (move) {
      const pan = panOf(move.to as Square);
      if (g.isGameOver()) play("end");
      else if (move.captured) play("capture", { pan });
      else if (move.flags.includes("k") || move.flags.includes("q")) play("castle", { pan });
      else play("move", { pan });
    }
    setSelected(null);
    setPending(null);
    refresh();
  }

  const myTurn = playerColor === null || game.turn() === playerColor;

  function queuePremove(square: Square) {
    const piece = game.get(square);

    if (premoveFrom) {
      if (square === premoveFrom) {
        setPremoveFrom(null);
        return;
      }
      if (piece && playerColor && piece.color === playerColor) {
        setPremoveFrom(square);
        return;
      }
      setPremove({ from: premoveFrom, to: square });
      setPremoveFrom(null);
      return;
    }

    if (piece && playerColor && piece.color === playerColor) {
      play("select", { pan: panOf(square) });
      setPremoveFrom(square);
      setPremove(null);
      return;
    }

    setPremove(null);
    setPremoveFrom(null);
  }

  function clearPremove() {
    setPremove(null);
    setPremoveFrom(null);
  }

  function selectSquare(square: Square) {
    if (pending || frozen?.current) return;

    if (!myTurn) {
      queuePremove(square);
      return;
    }

    if (selected && legalTargets.includes(square)) {
      const options = allowed(selected);
      const target = options.find((m) => m.to === square);

      if (target && target.promotion) {
        setPending({ from: selected, to: square, color: game.turn() });
        return;
      }

      commit(selected, square);
      return;
    }

    if (selected === square) {
      setSelected(null);
      return;
    }

    const piece = game.get(square);
    if (piece && piece.color === game.turn()) {
      play("select", { pan: panOf(square) });
      setSelected(square);
    } else {
      setSelected(null);
    }
  }

  function choosePromotion(piece: PromotionPiece) {
    if (!pending) return;
    commit(pending.from, pending.to, piece);
  }

  function edit<T>(fn: (chess: Chess) => T): T {
    const current = gameRef.current;
    const copy = new Chess(current.fen());
    const result = fn(copy);
    if (result) {
      earlier.current = [...earlier.current, ...current.history({ verbose: true })];
      gameRef.current = copy;
    }
    setSelected(null);
    refresh();
    return result;
  }

  function clearSelection() {
    setSelected(null);
  }

  function applyRemote(from: string, to: string, promotion?: string) {
    commit(from as Square, to as Square, promotion as PromotionPiece | undefined, false);
  }

  function follow(sans: string[]) {
    const g = gameRef.current;
    const mine = [...earlier.current, ...g.history({ verbose: true })].map((m) => m.san);
    if (mine.length === sans.length && mine.every((m, i) => m === sans[i])) return;
    if (sans.length === mine.length + 1 && mine.every((m, i) => m === sans[i])) {
      try {
        const next = new Chess(g.fen()).move(sans[sans.length - 1]);
        commit(next.from as Square, next.to as Square, next.promotion as PromotionPiece | undefined, false);
        return;
      } catch {
      }
    }
    syncTo(sans);
  }

  function syncTo(sans: string[]) {
    const mine = [...earlier.current, ...gameRef.current.history({ verbose: true })].map((m) => m.san);
    if (mine.length === sans.length && mine.every((m, i) => m === sans[i])) return;
    const fresh = new Chess();
    for (const san of sans) fresh.move(san);
    gameRef.current = fresh;
    earlier.current = [];
    setSelected(null);
    setPending(null);
    setPremove(null);
    setPremoveFrom(null);
    refresh();
  }

  function cancelPromotion() {
    setPending(null);
    setSelected(null);
  }

  const verbose = [...earlier.current, ...game.history({ verbose: true })];
  const ply = verbose.length;
  const turnKey = `${gameId}:${playerColor}:${game.turn()}:${ply}`;

  useEffect(() => {
    if (!autoOpponent || playerColor === null) return;
    if (myTurn || pending || game.isGameOver() || frozen?.current) return;

    const id = setTimeout(() => {
      if (frozen?.current || gameRef.current.isGameOver()) return;
      const options = allowed();
      if (!options.length) return;
      const pick = options[Math.floor(Math.random() * options.length)];
      commit(
        pick.from as Square,
        pick.to as Square,
        pick.promotion as PromotionPiece | undefined,
        false
      );
    }, 700);

    return () => clearTimeout(id);
  }, [turnKey, autoOpponent, pending]);

  useEffect(() => {
    if (!myTurn) return;
    if (frozen?.current) {
      setPremove(null);
      setPremoveFrom(null);
      return;
    }

    if (premoveFrom) setPremoveFrom(null);

    if (!premove) return;
    if (game.isGameOver()) {
      setPremove(null);
      return;
    }

    const { from, to } = premove;
    setPremove(null);

    const legal = allowed(from).find((m) => m.to === to);

    if (!legal) {
      refresh();
      return;
    }

    if (legal.promotion) {
      setPending({ from, to, color: game.turn() });
      refresh();
      return;
    }

    commit(from, to);
  }, [turnKey]);

  function findKing(color: "w" | "b"): Square | null {
    for (const row of game.board()) {
      for (const cell of row) {
        if (cell && cell.type === "k" && cell.color === color) return cell.square as Square;
      }
    }
    return null;
  }

  const latest = verbose.length ? verbose[verbose.length - 1] : null;
  const lastMove = latest
    ? { from: latest.from as Square, to: latest.to as Square }
    : null;

  const lastCapture = latest && latest.captured ? (latest.to as Square) : null;
  const moveKey = verbose.length;

  const isMate = game.isCheckmate();
  const kingInDanger = isMate || game.isCheck() ? findKing(game.turn()) : null;
  const checkSquare = isMate ? null : kingInDanger;
  const matedSquare = isMate ? kingInDanger : null;

  function survivors(color: "w" | "b") {
    const counts: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    for (const row of game.board()) {
      for (const cell of row) {
        if (cell && cell.color === color && cell.type !== "k") counts[cell.type]++;
      }
    }
    return counts;
  }

  function lostBy(color: "w" | "b") {
    const alive = survivors(color);
    const lost: string[] = [];
    let points = 0;
    for (const type of ORDER) {
      const gone = Math.max(0, START_COUNT[type] - alive[type]);
      for (let i = 0; i < gone; i++) lost.push(type);
      points += gone * VALUE[type];
    }
    return { lost, points };
  }

  const whiteLost = lostBy("w");
  const blackLost = lostBy("b");

  const capturedByWhite = blackLost.lost;
  const capturedByBlack = whiteLost.lost;
  const materialForWhite = blackLost.points - whiteLost.points;

  const history = verbose.map((m) => m.san);
  const moves = [];
  for (let i = 0; i < history.length; i += 2) {
    moves.push({ white: history[i], black: history[i + 1] });
  }

  function statusText() {
    if (game.isCheckmate()) {
      return game.turn() === "w" ? "Black wins by checkmate" : "White wins by checkmate";
    }
    if (game.isStalemate()) return "Draw by stalemate";
    if (game.isDraw()) return "Draw";
    if (game.isCheck()) return "Check";
    return null;
  }

  return {
    board: game.board(),
    turn: game.turn(),
    selected,
    legalTargets,
    lastMove,
    lastCapture,
    moveKey,
    checkSquare,
    matedSquare,
    selectSquare,
    pending,
    premove,
    premoveFrom,
    clearPremove,
    myTurn,
    choosePromotion,
    cancelPromotion,
    capturedByWhite,
    capturedByBlack,
    materialForWhite,
    moves,
    ply,
    gameId,
    reset,
    edit,
    clearSelection,
    applyRemote,
    syncTo,
    follow,
    sans: () => verbose.map((m) => m.san),
    verboseMoves: verbose,
    sound: play,
    chess: game,
    inCheck: game.isCheck(),
    lastFullMove: latest,
    status: statusText(),
  };
}