import { t } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { puzzleApi, PuzzleApiError, type MyRating, type PuzzleEnd, type PuzzleKind, type PuzzleStart } from "./api";
import type { SoundName } from "../game/useSounds";
import { CARDS, targetsFor, type CardId } from "../../shared/cards";
import { cardStep, cardStepText, isMoveStep, playStep, sameCardStep, type PuzzleBoard } from "../../shared/cardPuzzle";

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
  | "empty"
  | "paused";

type Pending = { from: Square; to: Square; color: "w" | "b" };
type Snapshot = { fen: string; shield: string | null; last: { from: Square; to: Square } | null };
export type Armed = { card: CardId; picks: Square[] };

const SETUP_DELAY = 650;
const REPLY_DELAY = 380;
const SOLUTION_STEP = 700;
const QUIET_TRIES = 2;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kingSquare(chess: Chess, color: "w" | "b"): Square | null {
  for (const row of chess.board()) for (const cell of row) if (cell && cell.type === "k" && cell.color === color) return cell.square;
  return null;
}

const picksNeeded = (card: CardId) => (CARDS[card].kind === "time" ? 0 : card === "swap" ? 2 : 1);

function stops(err: unknown) {
  if (!(err instanceof PuzzleApiError)) return false;
  return err.code === "none" || err.code === "unavailable" || err.status === 401 || err.status === 403;
}

export function stepLabel(step: string) {
  const c = cardStep(step);
  if (!c) return step;
  const name = t(CARDS[c.card].name);
  if (c.card === "swap") return t("{name} {a} and {b}", { name, a: c.picks[0], b: c.picks[1] });
  return c.picks.length ? `${name} ${c.picks[0]}` : name;
}

export function usePuzzle(options: { kind: PuzzleKind; difficulty: number; theme: string | null; play: (s: SoundName) => void }) {
  const board = useRef<PuzzleBoard>({ chess: new Chess(), shield: null });
  const history = useRef<Snapshot[]>([]);
  const gen = useRef(0);
  const settings = useRef(options);
  settings.current = options;

  const [phase, setPhase] = useState<Phase>("loading");
  const [fen, setFen] = useState(board.current.chess.fen());
  const [shield, setShield] = useState<string | null>(null);
  const [start, setStart] = useState<PuzzleStart | null>(null);
  const [end, setEnd] = useState<PuzzleEnd | null>(null);
  const [me, setMe] = useState<MyRating | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [moveKey, setMoveKey] = useState(0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [wrongMove, setWrongMove] = useState<{ from: Square; to: Square } | null>(null);
  const [wrongCard, setWrongCard] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<Armed | null>(null);
  const [flash, setFlash] = useState<{ squares: Square[]; key: number } | null>(null);
  const line = useRef<string[]>([]);
  const [solStep, setSolStep] = useState(0);
  const solStepRef = useRef(0);
  const lastMoveRef = useRef<{ from: Square; to: Square } | null>(null);

  const sync = useCallback(() => {
    setFen(board.current.chess.fen());
    setShield(board.current.shield);
    setMoveKey((k) => k + 1);
  }, []);

  const step = useCallback(
    (text: string) => {
      const b = board.current;
      const snap: Snapshot = { fen: b.chess.fen(), shield: b.shield, last: lastMoveRef.current };
      const result = playStep(b, text);
      if (!result) return null;
      history.current.push(snap);
      line.current.push(text);
      if (result.move) {
        const m = result.move;
        const last = { from: m.from as Square, to: m.to as Square };
        lastMoveRef.current = last;
        setLastMove(last);
        const chess = b.chess;
        settings.current.play(
          chess.isCheckmate()
            ? "end"
            : chess.inCheck()
              ? "check"
              : m.flags.includes("k") || m.flags.includes("q")
                ? "castle"
                : m.captured
                  ? "capture"
                  : "move"
        );
      } else {
        setFlash({ squares: result.squares as Square[], key: Date.now() });
        settings.current.play("move");
      }
      sync();
      return result;
    },
    [sync]
  );

  const undo = useCallback(() => {
    const snap = history.current.pop();
    if (!snap) return;
    line.current.pop();
    board.current = { chess: new Chess(snap.fen), shield: snap.shield };
    lastMoveRef.current = snap.last;
    setLastMove(snap.last);
    sync();
  }, [sync]);

  const setUp = useCallback(
    async (p: PuzzleStart["puzzle"], my: number) => {
      board.current = { chess: new Chess(p.fen), shield: null };
      history.current = [];
      line.current = [];
      lastMoveRef.current = null;
      setLastMove(null);
      setSelected(null);
      setPending(null);
      setWrongMove(null);
      setWrongCard(false);
      setArmed(null);
      setFlash(null);
      sync();
      await wait(SETUP_DELAY);
      if (gen.current !== my) return false;
      step(p.setup);
      return true;
    },
    [step, sync]
  );

  const load = useCallback(async () => {
    const my = ++gen.current;
    setPhase("loading");
    setEnd(null);
    setMessage("");
    setWaiting(false);
    setArmed(null);
    for (let attempt = 0; ; attempt++) {
      try {
        const { kind, difficulty, theme } = settings.current;
        const s = await puzzleApi.next(kind, difficulty, theme);
        if (gen.current !== my) return;
        setWaiting(false);
        setStart(s);
        if (s.me) setMe(s.me);
        setPhase("intro");
        if (!(await setUp(s.puzzle, my))) return;
        setPhase("turn");
        return;
      } catch (err) {
        if (gen.current !== my) return;
        if (stops(err)) {
          setStart(null);
          setPhase((err as PuzzleApiError).code === "none" ? "empty" : "paused");
          setMessage((err as PuzzleApiError).message);
          return;
        }
        if (attempt >= QUIET_TRIES) setWaiting(true);
        await wait(Math.min(10_000, 500 * 2 ** attempt));
        if (gen.current !== my) return;
      }
    }
  }, [setUp]);

  useEffect(() => {
    void load();
    return () => {
      gen.current++;
    };
  }, [load, options.kind]);

  const finish = useCallback((result: PuzzleEnd) => {
    setEnd(result);
    if (result.rating) setMe(result.rating.me);
    setPhase(result.solved ? "solved" : "failed");
  }, []);

  const cardPlayed = line.current.slice(1).some((s) => !isMoveStep(s));

  const retryStep = useCallback(
    async (text: string, my: number) => {
      const solution = end?.solution ?? [];
      const index = line.current.length;
      const result = step(text);
      if (!result) return;
      const expected = solution[index] ?? "";
      const right = text === expected || sameCardStep(text, expected) || (!!result.move && board.current.chess.isCheckmate());
      if (!right) {
        setMessage(result.move ? t("Not that one. Try again.") : t("Not that card. Try again."));
        if (result.move) setWrongMove({ from: result.move.from as Square, to: result.move.to as Square });
        setBusy(true);
        await wait(650);
        setBusy(false);
        if (gen.current !== my) return;
        setWrongMove(null);
        undo();
        return;
      }
      if ((result.move && board.current.chess.isCheckmate()) || index + 1 >= solution.length) {
        setPhase("retry-solved");
        setMessage(t("Solved! (practice, not rated)"));
        return;
      }
      if (!result.move) {
        setMessage(t("Right card! Now your move."));
        return;
      }
      setMessage(t("Right! Keep going."));
      setBusy(true);
      await wait(REPLY_DELAY);
      setBusy(false);
      if (gen.current !== my) return;
      step(solution[index + 1]);
    },
    [end, step, undo]
  );

  const send = useCallback(
    async (text: string) => {
      const my = gen.current;
      setSelected(null);
      setArmed(null);
      if (phase === "retry") return retryStep(text, my);
      if (!start) return;
      const result = step(text);
      if (!result) return;
      setPhase("checking");
      try {
        const answer = await puzzleApi.move(start.session, text);
        if (gen.current !== my) return;
        if (!answer.ok) {
          if (result.move) {
            setWrongMove({ from: result.move.from as Square, to: result.move.to as Square });
            setMessage(settings.current.kind === "cards" && !cardPlayedBefore(line.current) ? t("This puzzle starts with a card.") : t("That's not the move."));
          } else {
            setWrongCard(true);
            setMessage(t("That's not the card."));
          }
          finish(answer as PuzzleEnd);
          return;
        }
        if (!result.move) {
          setMessage("");
          setPhase("turn");
          return;
        }
        if (answer.reply) {
          setPhase("right");
          setMessage(t("Best move! Keep going."));
          await wait(REPLY_DELAY);
          if (gen.current !== my) return;
          step(answer.reply);
        }
        if (answer.done) finish(answer as PuzzleEnd);
        else setPhase("turn");
      } catch (err) {
        if (gen.current !== my) return;
        undo();
        if (stops(err)) {
          setPhase("paused");
          setMessage((err as PuzzleApiError).message);
          return;
        }
        void load();
      }
    },
    [finish, load, phase, retryStep, start, step, undo]
  );

  const myColor = start?.puzzle.color ?? "w";
  const hand: CardId[] = start?.puzzle.cards?.hand ?? [];
  const canMove = (phase === "turn" || phase === "retry") && !busy;
  const canCard = canMove && hand.length > 0 && !cardPlayed && board.current.chess.turn() === myColor && !board.current.chess.inCheck();

  const targetsOf = useCallback((sq: Square) => board.current.chess.moves({ square: sq, verbose: true }).map((m) => m.to as Square), []);

  const cardTargets: Square[] = armed && canCard ? (targetsFor(armed.card, fen, myColor, armed.picks) as Square[]) : [];

  const onCard = useCallback(
    (card: CardId) => {
      if (!canCard || pending) return;
      setSelected(null);
      if (armed?.card === card) {
        setArmed(null);
        return;
      }
      if (picksNeeded(card) === 0) {
        void send(cardStepText(card, []));
        return;
      }
      setArmed({ card, picks: [] });
    },
    [armed, canCard, pending, send]
  );

  const onSquareClick = useCallback(
    (sq: Square) => {
      if (!canMove || pending) return;
      if (armed) {
        if (!cardTargets.includes(sq)) {
          setArmed(null);
          return;
        }
        const picks = [...armed.picks, sq];
        if (picks.length < picksNeeded(armed.card)) {
          setArmed({ card: armed.card, picks });
          return;
        }
        void send(cardStepText(armed.card, picks));
        return;
      }
      const chess = board.current.chess;
      const piece = chess.get(sq);
      if (piece && piece.color === myColor) {
        setSelected(sq === selected ? null : sq);
        return;
      }
      if (!selected) return;
      const move = chess.moves({ square: selected, verbose: true }).find((m) => m.to === sq);
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
    [armed, canMove, cardTargets, myColor, pending, selected, send]
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
    setArmed(null);
    setPhase("checking");
    try {
      const result = await puzzleApi.giveUp(start.session);
      if (gen.current !== my) return;
      finish(result);
    } catch {
      if (gen.current !== my) return;
      void load();
    }
  }, [finish, load, phase, start]);

  const showSolution = useCallback(async () => {
    if (!end) return;
    const my = ++gen.current;
    setPhase("solution");
    setMessage("");
    setArmed(null);
    const last = line.current.length - 1;
    if (last >= 0 && line.current[last] !== end.solution[last] && !sameCardStep(line.current[last], end.solution[last] ?? "")) {
      await wait(250);
      if (gen.current !== my) return;
      setWrongMove(null);
      setWrongCard(false);
      undo();
    }
    solStepRef.current = line.current.length;
    setSolStep(line.current.length);
    for (let i = line.current.length; i < end.solution.length; i++) {
      await wait(SOLUTION_STEP);
      if (gen.current !== my) return;
      step(end.solution[i]);
      solStepRef.current = line.current.length;
      setSolStep(line.current.length);
    }
  }, [end, step, undo]);

  const goToSolution = useCallback(
    (target: number) => {
      if (phase !== "solution" || !start || !end) return;
      const total = end.solution.length;
      const i = Math.max(0, Math.min(total, target));
      if (i === solStepRef.current) return;
      gen.current++;
      const b: PuzzleBoard = { chess: new Chess(start.puzzle.fen), shield: null };
      let last: { from: Square; to: Square } | null = null;
      let latest: ReturnType<typeof playStep> = null;
      for (let k = 0; k < i; k++) {
        const r = playStep(b, end.solution[k]);
        if (!r) break;
        latest = r;
        if (r.move) last = { from: r.move.from as Square, to: r.move.to as Square };
      }
      const forward = i === solStepRef.current + 1;
      board.current = b;
      history.current = [];
      line.current = end.solution.slice(0, i);
      lastMoveRef.current = last;
      setLastMove(last);
      setWrongMove(null);
      setWrongCard(false);
      setSelected(null);
      setFlash(latest && !latest.move ? { squares: latest.squares as Square[], key: Date.now() } : null);
      if (forward && latest) {
        const m = latest.move;
        settings.current.play(
          !m ? "move" : b.chess.isCheckmate() ? "end" : b.chess.inCheck() ? "check" : m.captured ? "capture" : "move"
        );
      }
      solStepRef.current = i;
      setSolStep(i);
      sync();
    },
    [end, phase, start, sync]
  );

  const retry = useCallback(async () => {
    if (!start || !end) return;
    const my = ++gen.current;
    setMessage("");
    setPhase("intro");
    if (!(await setUp(start.puzzle, my))) return;
    setPhase("retry");
  }, [end, setUp, start]);

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  const solutionText = (() => {
    if (!end || !start) return "";
    const b: PuzzleBoard = { chess: new Chess(start.puzzle.fen), shield: null };
    const parts: string[] = [];
    let prev: "w" | "b" | null = null;
    for (const text of end.solution) {
      const color = b.chess.turn();
      const number = Number(b.chess.fen().split(" ")[5]);
      const r = playStep(b, text);
      if (!r) break;
      const label = r.move ? r.move.san : `[${stepLabel(text)}]`;
      const prefix = prev === null ? `${number}${color === "w" ? "." : "..."} ` : color === "w" && prev !== "w" ? `${number}. ` : "";
      parts.push(prefix + label);
      prev = color;
    }
    return parts.join(" ");
  })();

  const chess = board.current.chess;
  const turn = chess.turn();
  const inCheck = chess.inCheck();
  return {
    phase,
    message,
    waiting,
    solutionText,
    start,
    end,
    me,
    setMe,
    myColor,
    fen,
    board: chess.board(),
    selected,
    legalTargets: selected && canMove && !armed ? targetsOf(selected) : [],
    lastMove,
    wrongMove,
    wrongCard,
    moveKey,
    checkSquare: inCheck ? kingSquare(chess, turn) : null,
    matedSquare: chess.isCheckmate() ? kingSquare(chess, turn) : null,
    pending,
    canMove,
    onSquareClick,
    onPromote,
    cancelPromotion: () => setPending(null),
    next: load,
    giveUp,
    showSolution,
    retry,
    solution: {
      step: solStep,
      total: end?.solution.length ?? 0,
      first: () => goToSolution(0),
      prev: () => goToSolution(solStepRef.current - 1),
      next: () => goToSolution(solStepRef.current + 1),
      last: () => goToSolution(end?.solution.length ?? 0),
    },
    hand,
    canCard,
    cardPlayed,
    armed,
    onCard,
    cancelCard: () => setArmed(null),
    cardTargets,
    flash,
    shield,
  };
}

function cardPlayedBefore(steps: string[]) {
  return steps.slice(1, -1).some((s) => !isMoveStep(s));
}