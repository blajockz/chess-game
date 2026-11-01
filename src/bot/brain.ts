import { Chess, type Square } from "chess.js";
import {
  CARDS,
  MAX_CHARGE,
  UNLOCK_PLY,
  amountsFor,
  applyBoardCard,
  capturedSquare,
  targetsFor,
  type CardId,
  type CardsState,
  type Category,
} from "../../shared/cards";
import { MATE, type Analyser, type SearchResult } from "./uci";
import { planFor, pickWeak, MAX_ELO, MIN_ELO } from "./strength";

type Side = "w" | "b";
const other = (s: Side): Side => (s === "w" ? "b" : "w");
const VALUE: Record<string, number> = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 0 };

export const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? "");

export const cardSkill = (elo: number) => Math.min(1, Math.max(0, (elo - MIN_ELO) / (MAX_ELO - MIN_ELO)));

const points = (s: number) => (s >= MATE / 2 ? 1000 : s <= -MATE / 2 ? 0 : 1000 / (1 + Math.exp(-s / 90)));

function gaussian(random: () => number) {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function movesWithShield(fen: string, shielded: string | null): string[] {
  const chess = new Chess(fen);
  const all = chess.moves({ verbose: true });
  if (!shielded) return all.map(uciOf);
  const kept = all.filter((m) => !(m.captured && capturedSquare(m) === shielded));
  return (kept.length ? kept : all).map(uciOf);
}

const top = (r: SearchResult) => (r.lines.length ? r.lines[0].score : 0);

export type MoveContext = {
  engine: Analyser;
  elo: number;
  fen: string;
  moves?: string[];
  legal: string[];
  movetime: number;
  random?: () => number;
  threats?: ThreatContext | null;
};

export type MoveChoice = { move: string; score: number | null };

export async function chooseMove(ctx: MoveContext): Promise<MoveChoice | null> {
  const random = ctx.random ?? Math.random;
  if (!ctx.legal.length) return null;
  if (ctx.legal.length === 1) return { move: ctx.legal[0], score: null };
  const plan = planFor(ctx.elo);
  const restrict = ctx.legal.length < new Chess(posAfter(ctx.fen, ctx.moves)).moves().length ? ctx.legal : undefined;

  let choice: MoveChoice | null;
  if (plan.mode === "weak") {
    const r = await ctx.engine.search({
      fen: ctx.fen,
      moves: ctx.moves,
      depth: plan.depth,
      multipv: plan.candidates,
      searchmoves: restrict,
    });
    const move = pickWeak(r.lines, ctx.legal, plan, random);
    choice = move ? { move, score: r.lines.find((l) => l.move === move)?.score ?? null } : null;
  } else {
    const r = await ctx.engine.search({
      fen: ctx.fen,
      moves: ctx.moves,
      movetime: ctx.movetime,
      elo: plan.elo >= 3190 ? null : plan.elo,
      searchmoves: restrict,
    });
    const move = r.best && ctx.legal.includes(r.best) ? r.best : r.lines[0]?.move;
    choice = move && ctx.legal.includes(move) ? { move, score: r.lines.find((l) => l.move === move)?.score ?? top(r) } : null;
  }
  if (!choice) return { move: ctx.legal[Math.floor(random() * ctx.legal.length)], score: null };

  if (ctx.threats && cardSkill(ctx.elo) >= 0.45) {
    const safer = await avoidCardThreats(ctx, choice);
    if (safer) choice = safer;
  }
  return choice;
}

function posAfter(fen: string, moves?: string[]) {
  if (!moves?.length) return fen;
  const chess = new Chess(fen);
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess.fen();
}

export type ThreatContext = {
  cards: CardsState;
  plyAfter: number;
};

export async function bestBoardCardGain(engine: Analyser, fen: string, mover: Side, cards: CardsState, plyNow: number, depth: number, budget: { left: number }) {
  if (plyNow < UNLOCK_PLY) return 0;
  const chess = new Chess(fen);
  if (chess.isCheck() || chess.isGameOver()) return 0;
  const usable = cards.hand.filter(
    (c) => CARDS[c].kind === "board" && c !== "shield" && !cards.used[mover].includes(c) && cards.charge[mover] >= CARDS[c].cost
  );
  if (!usable.length) return 0;
  const base = top(await engine.search({ fen, depth }));
  budget.left--;
  let best = 0;
  for (const card of usable) {
    for (const picks of optionsFor(card, fen, mover)) {
      if (budget.left <= 0) return best;
      const after = applyBoardCard(card, fen, mover, picks);
      if (!after) continue;
      budget.left--;
      const gain = points(top(await engine.search({ fen: after.fen, depth }))) - points(base);
      if (gain > best) best = gain;
    }
  }
  return best;
}

export function optionsFor(card: CardId, fen: string, side: Side): string[][] {
  const first = targetsFor(card, fen, side, []);
  if (CARDS[card].targets !== 2) return first.map((sq) => [sq]);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const a of first) {
    for (const b of targetsFor(card, fen, side, [a])) {
      const key = [a, b].sort().join();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}

async function avoidCardThreats(ctx: MoveContext, choice: MoveChoice): Promise<MoveChoice | null> {
  const t = ctx.threats!;
  const me = new Chess(posAfter(ctx.fen, ctx.moves)).turn() as Side;
  const foe = other(me);
  if (t.plyAfter < UNLOCK_PLY) return null;
  const canThreat = t.cards.hand.some(
    (c) => CARDS[c].kind === "board" && c !== "shield" && !t.cards.used[foe].includes(c) && t.cards.charge[foe] >= CARDS[c].cost
  );
  if (!canThreat) return null;

  const skill = cardSkill(ctx.elo);
  const depth = skill > 0.8 ? 8 : 7;
  const wide = skill > 0.8 ? 8 : 4;
  const budget = { left: skill > 0.8 ? 140 : 60 };
  const start = posAfter(ctx.fen, ctx.moves);
  const restrict = ctx.legal.length < new Chess(start).moves().length ? ctx.legal : undefined;
  const lines = (await ctx.engine.search({ fen: start, depth, multipv: wide, searchmoves: restrict })).lines;
  const bestPlain = lines.length ? points(lines[0].score) : 500;
  const candidates = [
    choice.move,
    ...lines.filter((l) => l.move !== choice.move && points(l.score) > bestPlain - 150).map((l) => l.move),
  ].slice(0, wide);

  const scored: { move: string; plain: number; worst: number }[] = [];
  for (const move of candidates) {
    const chess = new Chess(start);
    try {
      chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
    } catch {
      continue;
    }
    if (chess.isGameOver()) return choice;
    const known = lines.find((l) => l.move === move);
    const plain = known ? points(known.score) : 1000 - points(top(await ctx.engine.search({ fen: chess.fen(), depth })));
    const threat = await bestBoardCardGain(ctx.engine, chess.fen(), foe, t.cards, t.plyAfter, depth, budget);
    scored.push({ move, plain, worst: plain - Math.max(0, threat) });
  }
  if (!scored.length) return null;
  const mine = scored.find((s) => s.move === choice.move);
  const best = scored.reduce((a, b) => (b.worst > a.worst ? b : a));
  if (!mine || mine.plain - mine.worst < 80 || best.move === choice.move) return null;
  if (best.worst <= mine.worst + 40) return null;
  return { move: best.move, score: best.plain };
}

export type CardContext = {
  engine: Analyser;
  elo: number;
  side: Side;
  fen: string;
  ply: number;
  cards: CardsState;
  playable: CardId[];
  category: Category;
  mine: number;
  theirs: number;
  shielded: string | null;
  random?: () => number;
};

export type CardChoice = { card: CardId; picks: string[]; move?: string; gain: number };

function timeValue(card: CardId, ctx: CardContext) {
  const a = amountsFor(ctx.category);
  const low = (ms: number, s: number) => ms < s * 1000;
  const myShort = low(ctx.mine, 60) ? 140 : low(ctx.mine, 150) ? 50 : 0;
  const theirShort = low(ctx.theirs, 45) ? 220 : low(ctx.theirs, 120) ? 90 : 0;
  const full = ctx.cards.charge[ctx.side] >= MAX_CHARGE ? 45 : 0;
  if (card === "thief") return 30 + myShort + (theirShort ? 80 : 0) + full + a.steal / 2;
  if (card === "overclock") return 20 + myShort + full + a.bonus / 3;
  if (card === "hourglass") return 10 + theirShort + full;
  if (card === "pause") return 5 + (low(ctx.mine, 30) ? 90 : 0) + full;
  return 0;
}

export async function chooseCard(ctx: CardContext): Promise<CardChoice | null> {
  const random = ctx.random ?? Math.random;
  if (!ctx.playable.length) return null;
  const skill = cardSkill(ctx.elo);
  if (random() > 0.35 + 0.65 * skill) return null;

  if (ctx.elo < 1000 && random() < 0.3) {
    const card = ctx.playable[Math.floor(random() * ctx.playable.length)];
    const options = CARDS[card].targets ? optionsFor(card, ctx.fen, ctx.side) : [[]];
    if (!options.length) return null;
    return { card, picks: options[Math.floor(random() * options.length)], gain: 0 };
  }

  const depth = 5 + Math.round(7 * skill);
  const legal = movesWithShield(ctx.fen, ctx.shielded);
  const all = new Chess(ctx.fen).moves().length;
  const restrict = legal.length < all ? legal : undefined;
  const wantsShield = ctx.playable.includes("shield");
  const base = await ctx.engine.search({ fen: ctx.fen, depth, multipv: wantsShield ? 3 : 1, searchmoves: restrict });
  const baseScore = points(top(base));
  const noise = () => gaussian(random) * (1 - skill) * 120;

  const options: CardChoice[] = [];
  for (const card of ctx.playable) {
    const def = CARDS[card];
    const price = def.cost * 12;
    if (def.kind === "time") {
      options.push({ card, picks: [], gain: timeValue(card, ctx) - price + noise() });
      continue;
    }
    if (card === "shield") {
      const best = await bestShield(ctx, base, depth, baseScore);
      if (best) options.push({ ...best, gain: best.gain - price + noise() });
      continue;
    }
    for (const picks of optionsFor(card, ctx.fen, ctx.side)) {
      const after = applyBoardCard(card, ctx.fen, ctx.side, picks);
      if (!after) continue;
      const score = points(top(await ctx.engine.search({ fen: after.fen, depth })));
      options.push({ card, picks, gain: score - baseScore - price + noise() });
    }
  }
  if (!options.length) return null;
  const best = options.reduce((a, b) => (b.gain > a.gain ? b : a));
  return best.gain > 40 ? best : null;
}

async function bestShield(ctx: CardContext, base: SearchResult, depth: number, baseScore: number) {
  let best: { card: CardId; picks: string[]; move: string; gain: number } | null = null;
  for (const line of base.lines.slice(0, 3)) {
    const chess = new Chess(ctx.fen);
    let moved;
    try {
      moved = chess.move({ from: line.move.slice(0, 2), to: line.move.slice(2, 4), promotion: line.move[4] });
    } catch {
      continue;
    }
    if (chess.isGameOver() || /[kq]/.test(moved.flags)) continue;
    const foe = other(ctx.side);
    const squares = new Set<string>();
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p || p.color !== ctx.side || VALUE[p.type] < 300) continue;
        if (chess.isAttacked(p.square as Square, foe)) squares.add(p.square);
      }
    }
    for (const now of squares) {
      const before = now === moved.to ? moved.from : now;
      const replies = movesWithShield(chess.fen(), now);
      if (replies.length === chess.moves().length) continue;
      const r = await ctx.engine.search({ fen: chess.fen(), depth, searchmoves: replies });
      const value = 1000 - points(top(r));
      const gain = value - baseScore;
      if (!best || gain > best.gain) best = { card: "shield", picks: [before], move: line.move, gain };
    }
  }
  return best;
}
