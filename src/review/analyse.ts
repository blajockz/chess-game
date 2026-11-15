import { t } from "../i18n";
import { useEffect, useState } from "react";
import { Chess } from "chess.js";
import { MATE, START_FEN, type Analyser } from "../bot/uci";
import { loadReviewEngine } from "../bot/engine";
import type { CardId } from "../../shared/cards";
import { recordKey, type GameRecord } from "./record";
import { optionsFor, shieldPlans, turnsOf, type CardGame, type CardOption } from "./cardTurns";

export const DEPTH = 14;
export const SCREEN_DEPTH = 8;
const SCREEN_MARGIN = 6;
const THREAT_MARGIN = 8;

export type PositionEval = {
  score: number;
  best: string | null;
  pv: string[];
  second: number | null;
  terminal?: "mate" | "draw";
};

export type AltEval = {
  card: CardId;
  picks: string[];
  squares: string[];
  fen: string;
  score: number;
  pv: string[];
  move?: string;
};

export type TurnEval = {
  pre?: PositionEval;
  alt?: AltEval | null;
  shieldFree?: { score: number; best: string | null; pv: string[] } | null;
  shieldAlt?: AltEval | null;
  dodge?: { score: number };
};

export type Analysis = { key: string; depth: number; positions: PositionEval[]; turns?: TurnEval[] };

export type AnalysisState =
  | { status: "unsupported"; reason: string }
  | { status: "running"; done: number; total: number; partial: PositionEval[]; turns: TurnEval[] }
  | { status: "done"; analysis: Analysis }
  | { status: "error"; message: string };

const CACHE_PREFIX = "tempo.review.";
const CACHE_INDEX = "tempo.reviews";
const CACHE_MAX = 25;

function readCache(key: string): Analysis | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const a = JSON.parse(raw) as Analysis;
    return a.key === key && Array.isArray(a.positions) ? a : null;
  } catch {
    return null;
  }
}

function writeCache(a: Analysis) {
  try {
    const index = (JSON.parse(localStorage.getItem(CACHE_INDEX) ?? "[]") as string[]).filter((k) => k !== a.key);
    index.push(a.key);
    while (index.length > CACHE_MAX) localStorage.removeItem(CACHE_PREFIX + index.shift());
    localStorage.setItem(CACHE_PREFIX + a.key, JSON.stringify(a));
    localStorage.setItem(CACHE_INDEX, JSON.stringify(index));
  } catch {
  }
}

export function cannotReview(record: GameRecord): string | null {
  if (record.steps.filter((s) => s.t === "move").length < 2) return t("This game is too short to review.");
  return null;
}

type Job = { state: AnalysisState; listeners: Set<(s: AnalysisState) => void> };
const jobs = new Map<string, Job>();
let waiting: Promise<void> = Promise.resolve();

function publish(job: Job, state: AnalysisState) {
  job.state = state;
  for (const l of job.listeners) l(state);
}

function chance(score: number) {
  const cp = Math.abs(score) > MATE - 1000 ? Math.sign(score) * 1500 : Math.max(-1500, Math.min(1500, score));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export async function evaluateGame(
  engine: Analyser,
  game: CardGame,
  onEntry: (entry: PositionEval, index: number, turns: TurnEval[]) => void
) {
  const { plies, turns } = game;
  engine.newGame();
  let base = START_FEN;
  let moves: string[] = [];
  let chess = new Chess();
  const out: PositionEval[] = [];
  const extra: TurnEval[] = [];

  const look = async (fen: string, since: string[], whiteToMove: boolean, restricted: string[] | null, multipv: number, depth = DEPTH) => {
    const result = await engine.search({ fen, moves: since, depth, multipv, searchmoves: restricted ?? undefined });
    const [first, second] = result.lines;
    const toWhite = (s: number) => (whiteToMove ? s : -s);
    const entry: PositionEval = {
      score: first ? toWhite(first.score) : 0,
      best: result.best ?? first?.move ?? null,
      pv: first ? first.pv.slice(0, 10) : [],
      second: second ? toWhite(second.score) : null,
    };
    return entry;
  };

  for (let i = 0; i <= plies.length; i++) {
    const turn = turns[i];
    const last = i === plies.length;
    const whiteToMove = chess.turn() === "w";
    const restricted = last ? game.finalRestricted : turn.startRestricted;
    let start: PositionEval;
    if (chess.isCheckmate()) {
      start = { score: whiteToMove ? -MATE : MATE, best: null, pv: [], second: null, terminal: "mate" };
    } else if (chess.isDraw() || chess.isStalemate()) {
      start = { score: 0, best: null, pv: [], second: null, terminal: "draw" };
    } else {
      start = await look(base, moves, whiteToMove, restricted, 2);
    }

    if (i > 0 && turns[i - 1].card?.card === "shield") {
      if (restricted && !start.terminal) {
        const free = await look(base, moves, whiteToMove, null, 1);
        extra[i - 1] = { ...extra[i - 1], shieldFree: { score: free.score, best: free.best, pv: free.pv } };
      } else {
        extra[i - 1] = { ...extra[i - 1], shieldFree: null };
      }
    }
    if (last) {
      out.push(start);
      onEntry(start, i, extra);
      break;
    }

    const ply = plies[i];
    let entry = start;
    const mine = (score: number) => (whiteToMove ? chance(score) : 100 - chance(score));
    extra[i] = {};
    if (ply.before !== chess.fen()) {
      base = ply.before;
      moves = [];
      chess = new Chess(ply.before);
      entry = await look(base, moves, whiteToMove, turn.moveRestricted, 2);
      extra[i].pre = start;
    }
    if (turn.options.length) {
      extra[i].alt = await bestOption(engine, turn.options, whiteToMove, mine(start.score) + SCREEN_MARGIN, look);
    }
    if (!turn.card && turn.playable.includes("shield")) {
      extra[i].shieldAlt = await bestShield(engine, turn.startFen, whiteToMove, [start.best, ply.uci], turn.startRestricted, mine(start.score) + SCREEN_MARGIN);
    }

    const before = i > 0 ? out[i - 1] : null;
    if (before?.best && before.best !== plies[i - 1].uci) {
      const scores = [extra[i].pre ? entry.score : null, extra[i].alt?.score ?? null].filter((x): x is number => x !== null);
      const threat = scores.length ? Math.max(...scores.map(mine)) : null;
      if (threat !== null && threat - mine(start.score) >= THREAT_MARGIN) {
        extra[i - 1] = { ...extra[i - 1], dodge: { score: await dodged(engine, game, i, before, whiteToMove, look) } };
      }
    }
    out.push(entry);
    onEntry(entry, i, extra);
    chess.move(ply.san);
    moves.push(ply.uci);
  }
  return { positions: out, turns: extra };
}

async function bestOption(
  engine: Analyser,
  options: CardOption[],
  whiteToMove: boolean,
  bar: number,
  look: (fen: string, since: string[], whiteToMove: boolean, restricted: string[] | null, multipv: number, depth?: number) => Promise<PositionEval>
): Promise<AltEval | null> {
  const mine = (score: number) => (whiteToMove ? chance(score) : 100 - chance(score));
  const seen: { option: CardOption; win: number }[] = [];
  for (const option of options) {
    const result = await engine.search({ fen: option.fen, depth: SCREEN_DEPTH, multipv: 1, searchmoves: option.restricted ?? undefined });
    const first = result.lines[0];
    if (!first) continue;
    seen.push({ option, win: mine(whiteToMove ? first.score : -first.score) });
  }
  seen.sort((a, b) => b.win - a.win);
  let top: AltEval | null = null;
  for (const { option, win } of seen.slice(0, 2)) {
    if (win < bar) break;
    const deep = await look(option.fen, [], whiteToMove, option.restricted, 1);
    if (mine(deep.score) < bar) continue;
    if (!top || mine(deep.score) > mine(top.score)) {
      top = { card: option.card, picks: option.picks, squares: option.squares, fen: option.fen, score: deep.score, pv: deep.pv };
    }
  }
  return top;
}

async function bestShield(
  engine: Analyser,
  fen: string,
  whiteToMove: boolean,
  moves: (string | null)[],
  allowed: string[] | null,
  bar: number
): Promise<AltEval | null> {
  const plans = shieldPlans(fen, whiteToMove ? "w" : "b", moves, allowed);
  if (!plans.length) return null;
  const mine = (theirs: number) => 100 - chance(theirs);
  const ask = async (plan: (typeof plans)[number], depth: number) => {
    const result = await engine.search({ fen: plan.fen, depth, multipv: 1, searchmoves: plan.restricted });
    return result.lines[0] ?? null;
  };
  const seen: { plan: (typeof plans)[number]; win: number }[] = [];
  for (const plan of plans) {
    const line = await ask(plan, SCREEN_DEPTH);
    if (line) seen.push({ plan, win: mine(line.score) });
  }
  seen.sort((a, b) => b.win - a.win);
  let top: AltEval | null = null;
  let topWin = bar;
  for (const { plan, win } of seen.slice(0, 2)) {
    if (win < bar) break;
    const line = await ask(plan, DEPTH);
    if (!line || mine(line.score) < topWin) continue;
    topWin = mine(line.score);
    top = {
      card: "shield",
      picks: [plan.square],
      squares: [plan.from, plan.to],
      fen: plan.fen,
      score: whiteToMove ? -line.score : line.score,
      pv: line.pv.slice(0, 8),
      move: plan.move,
    };
  }
  return top;
}

async function dodged(
  engine: Analyser,
  game: CardGame,
  i: number,
  before: PositionEval,
  whiteToMove: boolean,
  look: (fen: string, since: string[], whiteToMove: boolean, restricted: string[] | null, multipv: number, depth?: number) => Promise<PositionEval>
) {
  const turn = game.turns[i];
  const prev = game.plies[i - 1];
  const mine = (score: number) => (whiteToMove ? chance(score) : 100 - chance(score));
  let fen: string;
  try {
    const chess = new Chess(prev.before);
    chess.move({ from: before.best!.slice(0, 2), to: before.best!.slice(2, 4), promotion: before.best![4] });
    if (chess.isCheck() || chess.isGameOver()) return before.score;
    fen = chess.fen();
  } catch {
    return before.score;
  }
  let shielded = turn.shielded;
  if (shielded && shielded === prev.to) shielded = before.best!.slice(0, 2) === prev.from ? before.best!.slice(2, 4) : prev.from;
  const boardCards = turn.playable.filter((c) => c === "leap" || c === "swap" || c === "retreat");
  const options = optionsFor(boardCards, fen, whiteToMove ? "w" : "b", shielded);
  const top = options.length ? await bestOption(engine, options, whiteToMove, mine(before.score) + SCREEN_MARGIN / 2, look) : null;
  return top && mine(top.score) > mine(before.score) ? top.score : before.score;
}

async function run(record: GameRecord, key: string, job: Job) {
  const game = turnsOf(record);
  const total = game.plies.length + 1;
  publish(job, { status: "running", done: 0, total, partial: [], turns: [] });
  let engine;
  try {
    engine = await loadReviewEngine();
  } catch {
    publish(job, { status: "error", message: t("The analysis engine couldn't load. Reload the page to try again.") });
    return;
  }
  const partial: PositionEval[] = [];
  const { turns } = await evaluateGame(engine, game, (entry, i, extra) => {
    partial.push(entry);
    publish(job, { status: "running", done: i + 1, total, partial: [...partial], turns: [...extra] });
  });
  const analysis: Analysis = { key, depth: DEPTH, positions: partial, ...(record.cards ? { turns } : {}) };
  writeCache(analysis);
  publish(job, { status: "done", analysis });
}

export function analyse(record: GameRecord): { key: string; job: Job } {
  const key = recordKey(record);
  let job = jobs.get(key);
  if (job) return { key, job };
  const moves = record.steps.filter((s) => s.t === "move").length;
  job = { state: { status: "running", done: 0, total: moves + 1, partial: [], turns: [] }, listeners: new Set() };
  jobs.set(key, job);
  const why = cannotReview(record);
  if (why) {
    job.state = { status: "unsupported", reason: why };
    return { key, job };
  }
  const cached = readCache(key);
  if (cached && cached.positions.length === moves + 1 && (!record.cards || Array.isArray(cached.turns))) {
    job.state = { status: "done", analysis: cached };
    return { key, job };
  }
  const started = job;
  waiting = waiting.then(() =>
    run(record, key, started).catch((err) => {
      console.warn("Review failed:", err);
      jobs.delete(key);
      publish(started, { status: "error", message: t("The review stopped. Try again.") });
    })
  );
  return { key, job };
}

export function useAnalysis(record: GameRecord | null): AnalysisState | null {
  const [state, setState] = useState<AnalysisState | null>(() => (record ? analyse(record).job.state : null));
  useEffect(() => {
    if (!record) {
      setState(null);
      return;
    }
    const { job } = analyse(record);
    setState(job.state);
    const listen = (s: AnalysisState) => setState(s);
    job.listeners.add(listen);
    return () => {
      job.listeners.delete(listen);
    };
  }, [record]);
  return state;
}