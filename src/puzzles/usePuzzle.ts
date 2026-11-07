import { useCallback, useEffect, useRef, useState } from "react";
import { Chess, type Move, type Square } from "chess.js";
import { puzzleApi, PuzzleApiError, type MyRating, type PuzzleEnd, type PuzzleStart } from "./api";
import type { SoundName } from "../game/useSounds";

export type Phase =
  | "loading"
  | "intro"
  | "turn"
  | "checking"
  | "right"
  | "solved"
  | "failed"
  | "solution"
  | "retry"
  | "retry-solved"
  | "error";

type Pending = { from: Square; to: Square; color: "w" | "b" };

const SETUP_DELAY = 650;
const REPLY_DELAY = 380;
const SOLUTION_STEP = 700;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function soundOf(m: Move, chess: Chess): SoundName {
  if (chess.isCheckmate()) return "end";
  if (chess.inCheck()) return "check";
  if (m.flags.includes("k") || m.flags.includes("q")) return "castle";
  if (m.captured) return "capture";
  return "move";
}

function apply(chess: Chess, uci: string): Move | null {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

function kingSquare(chess: Chess, color: "w" | "b"): Square | null {
  for (const row of chess.board()) for (const cell of row) if (cell && cell.type === "k" && cell.color === color) return cell.square;
  return null;
}

export function usePuzzle(options: { difficulty: number; theme: string | null; play: (s: SoundName) => void }) {
  const chess = useRef(new Chess());
  const gen = useRef(0);
  const settings = useRef(options);
  settings.current = options;

  const [phase, setPhase] = useState<Phase>("loading");
  const [fen, setFen] = useState(chess.current.fen());
  const [start, setStart] = useState<PuzzleStart | null>(null);
  const [end, setEnd] = useState<PuzzleEnd | null>(null);
  const [me, setMe] = useState<MyRating | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [moveKey, setMoveKey] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [wrongMove, setWrongMove] = useState<{ from: Square; to: Square } | null>(null);
  const [busy, setBusy] = useState(false);
  const line = useRef<string[]>([]);

  const show = useCallback((m: Move | null) => {
    setFen(chess.current.fen());
    setLastMove(m ? { from: m.from, to: m.to } : null);
    setMoveKey((k) => k + 1);
    if (m) settings.current.play(soundOf(m, chess.current));
  }, []);

  const playUci = useCallback(
    (uci: string) => {
      const m = apply(chess.current, uci);
      if (m) line.current.push(uci);
      show(m);
      return m;
    },
    [show]
  );

  const undo = useCallback(() => {
    chess.current.undo();
    line.current.pop();
    const history = chess.current.history({ verbose: true });
    const prev = history[history.length - 1] ?? null;
    setFen(chess.current.fen());
    setLastMove(prev ? { from: prev.from, to: prev.to } : null);
    setMoveKey((k) => k + 1);
  }, []);

  const setUp = useCallback(
    async (p: PuzzleStart["puzzle"], my: number) => {
      chess.current = new Chess(p.fen);
      line.current = [];
      setSelected(null);
      setPending(null);
      setWrongMove(null);
      show(null);
      await wait(SETUP_DELAY);
      if (gen.current !== my) return false;
      playUci(p.setup);
      return true;
    },
    [playUci, show]
  );

  const load = useCallback(async () => {
    const my = ++gen.current;
    setPhase("loading");
    setEnd(null);
    setMessage("");
    try {
      const s = await puzzleApi.next(settings.current.difficulty, settings.current.theme);
      if (gen.current !== my) return;
      setStart(s);
      if (s.me) setMe(s.me);
      setPhase("intro");
      if (!(await setUp(s.puzzle, my))) return;
      setPhase("turn");
    } catch (err) {
      if (gen.current !== my) return;
      setPhase("error");
      setMessage(err instanceof PuzzleApiError ? err.message : "Couldn't load a puzzle. Try again.");
    }
  }, [setUp]);

  useEffect(() => {
    void load();
    return () => {
      gen.current++;
    };
  }, [load]);

  const finish = useCallback((result: PuzzleEnd) => {
    setEnd(result);
    if (result.rating) setMe(result.rating.me);
    setPhase(result.solved ? "solved" : "failed");
  }, []);

  const retryMove = useCallback(
    async (uci: string, my: number) => {
      const solution = end?.solution ?? [];
      const index = line.current.length;
      const m = playUci(uci);
      if (!m) return;
      const right = uci === solution[index] || chess.current.isCheckmate();
      if (!right) {
        setMessage("Not that one. Try again.");
        setWrongMove({ from: m.from, to: m.to });
        setBusy(true);
        await wait(600);
        setBusy(false);
        if (gen.current !== my) return;
        setWrongMove(null);
        undo();
        return;
      }
      if (chess.current.isCheckmate() || index + 1 >= solution.length) {
        setPhase("retry-solved");
        setMessage("Solved! (practice, not rated)");
        return;
      }
      setMessage("Right! Keep going.");
      setBusy(true);
      await wait(REPLY_DELAY);
      setBusy(false);
      if (gen.current !== my) return;
      playUci(solution[index + 1]);
    },
    [end, playUci, undo]
  );

  const send = useCallback(
    async (uci: string) => {
      const my = gen.current;
      setSelected(null);
      if (phase === "retry") return retryMove(uci, my);
      if (!start) return;
      const m = playUci(uci);
      if (!m) return;
      setPhase("checking");
      try {
        const answer = await puzzleApi.move(start.session, uci);
        if (gen.current !== my) return;
        if (!answer.ok) {
          setWrongMove({ from: m.from, to: m.to });
          setMessage("That's not the move.");
          finish(answer as PuzzleEnd);
          return;
        }
        if (answer.reply) {
          setPhase("right");
          setMessage("Best move! Keep going.");
          await wait(REPLY_DELAY);
          if (gen.current !== my) return;
          playUci(answer.reply);
        }
        if (answer.done) finish(answer as PuzzleEnd);
        else setPhase("turn");
      } catch (err) {
        if (gen.current !== my) return;
        undo();
        setPhase("error");
        setMessage(err instanceof PuzzleApiError ? err.message : "Couldn't check the move. Try the next puzzle.");
      }
    },
    [finish, phase, playUci, retryMove, start, undo]
  );

  const myColor = start?.puzzle.color ?? "w";
  const canMove = (phase === "turn" || phase === "retry") && !busy;

  const targetsOf = useCallback((sq: Square) => chess.current.moves({ square: sq, verbose: true }).map((m) => m.to as Square), []);

  const onSquareClick = useCallback(
    (sq: Square) => {
      if (!canMove || pending) return;
      const piece = chess.current.get(sq);
      if (piece && piece.color === myColor) {
        setSelected(sq === selected ? null : sq);
        return;
      }
      if (!selected) return;
      const move = chess.current.moves({ square: selected, verbose: true }).find((m) => m.to === sq);
      if (!move) {
        setSelected(null);
        return;
      }
      if (move.promotion) {
        setPending({ from: selected, to: sq, color: myColor });
        return;
      }
      void send(selected + sq);
    },
    [canMove, myColor, pending, selected, send]
  );

  const onPromote = useCallback(
    (piece: "q" | "r" | "b" | "n") => {
      if (!pending) return;
      const uci = pending.from + pending.to + piece;
      setPending(null);
      void send(uci);
    },
    [pending, send]
  );

  const giveUp = useCallback(async () => {
    if (!start || phase !== "turn") return;
    const my = gen.current;
    setPhase("checking");
    try {
      const result = await puzzleApi.giveUp(start.session);
      if (gen.current !== my) return;
      finish(result);
    } catch (err) {
      if (gen.current !== my) return;
      setPhase("error");
      setMessage(err instanceof PuzzleApiError ? err.message : "Couldn't reach the server.");
    }
  }, [finish, phase, start]);

  const showSolution = useCallback(async () => {
    if (!end) return;
    const my = ++gen.current;
    setPhase("solution");
    setMessage("");
    const last = line.current.length - 1;
    if (last >= 0 && line.current[last] !== end.solution[last]) {
      await wait(250);
      if (gen.current !== my) return;
      setWrongMove(null);
      undo();
    }
    for (let i = line.current.length; i < end.solution.length; i++) {
      await wait(SOLUTION_STEP);
      if (gen.current !== my) return;
      playUci(end.solution[i]);
    }
  }, [end, playUci]);

  const retry = useCallback(async () => {
    if (!start || !end) return;
    const my = ++gen.current;
    setMessage("");
    setPhase("intro");
    if (!(await setUp(start.puzzle, my))) return;
    setPhase("retry");
  }, [end, setUp, start]);

  const solutionText = (() => {
    if (!end || !start) return "";
    const c = new Chess(start.puzzle.fen);
    const parts: string[] = [];
    for (const uci of end.solution) {
      const color = c.turn();
      const number = Number(c.fen().split(" ")[5]);
      const m = apply(c, uci);
      if (!m) break;
      if (color === "w") parts.push(`${number}. ${m.san}`);
      else parts.push(parts.length === 0 ? `${number}... ${m.san}` : m.san);
    }
    return parts.join(" ");
  })();

  const board = chess.current.board();
  const turn = chess.current.turn();
  const inCheck = chess.current.inCheck();
  return {
    phase,
    message,
    solutionText,
    start,
    end,
    me,
    setMe,
    myColor,
    fen,
    board,
    selected,
    legalTargets: selected && canMove ? targetsOf(selected) : [],
    lastMove,
    wrongMove,
    moveKey,
    checkSquare: inCheck ? kingSquare(chess.current, turn) : null,
    matedSquare: chess.current.isCheckmate() ? kingSquare(chess.current, turn) : null,
    pending,
    canMove,
    onSquareClick,
    onPromote,
    cancelPromotion: () => setPending(null),
    next: load,
    giveUp,
    showSolution,
    retry,
  };
}