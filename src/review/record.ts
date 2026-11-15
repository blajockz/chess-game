import { Chess, type Move } from "chess.js";
import type { TimelineEvent } from "../../shared/protocol";
import type { CardId, PlayedCard } from "../../shared/cards";

export type Side = "w" | "b";

export type GameRecord = {
  id: string;
  kind: "bot" | "online";
  white: string;
  black: string;
  you: Side | null;
  result: string;
  winner: Side | "draw";
  control: { initial: number; increment: number; blackInitial?: number };
  cards: boolean;
  steps: TimelineEvent[];
  endedAt: string;
  botElo: number | null;
  plies: number;
  hand?: CardId[];
  cardLog?: Omit<PlayedCard, "message">[];
  clocks?: number[];
  rated?: boolean;
  ratingChange?: { w?: RatingChange; b?: RatingChange } | null;
};

export type RatingChange = { before: number; after: number; delta: number };

export type GameSummaryRow = Omit<GameRecord, "steps" | "hand" | "cardLog" | "clocks">;

export function winnerOf(result: string): Side | "draw" | null {
  if (/^White wins/.test(result)) return "w";
  if (/^Black wins/.test(result)) return "b";
  if (/^Draw/.test(result)) return "draw";
  return null;
}

export function worthKeeping(result: string, plies: number) {
  return winnerOf(result) !== null && plies >= 2;
}

export function stepsFromMoves(moves: Move[]): TimelineEvent[] {
  const steps: TimelineEvent[] = [];
  let fen = new Chess().fen();
  for (const m of moves) {
    if (m.before !== fen) steps.push({ t: "card", fen: m.before });
    steps.push({ t: "move", san: m.san });
    fen = m.after;
  }
  return steps;
}

export type Ply = {
  ply: number;
  side: Side;
  san: string;
  uci: string;
  from: string;
  to: string;
  before: string;
  after: string;
  captured?: string;
  piece: string;
  flags: string;
  afterCard?: boolean;
};

export function pliesOf(steps: TimelineEvent[]): Ply[] {
  let chess = new Chess();
  const out: Ply[] = [];
  let card = false;
  for (const step of steps) {
    if (step.t === "card") {
      chess = new Chess(step.fen);
      card = true;
      continue;
    }
    const m = chess.move(step.san);
    out.push({
      ply: out.length + 1,
      side: m.color,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ""),
      from: m.from,
      to: m.to,
      before: m.before,
      after: m.after,
      captured: m.captured,
      piece: m.piece,
      flags: m.flags,
      ...(card ? { afterCard: true } : {}),
    });
    card = false;
  }
  return out;
}

export function recordKey(record: Pick<GameRecord, "steps" | "result" | "cardLog">) {
  const cards = record.cardLog?.length ? "|" + record.cardLog.map((c) => `${c.ply}${c.card}${(c.picks ?? []).join("")}`).join(",") : "";
  const text = JSON.stringify(record.steps) + "|" + record.result + cards;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + "-" + record.steps.length;
}

export function describeControl(c: GameRecord["control"]) {
  const minutes = c.initial / 60;
  const m = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return `${m}+${c.increment}`;
}