import { t } from "../i18n";
import { MATE } from "../bot/uci";
import type { PositionEval, TurnEval } from "./analyse";
import type { Ply, Side } from "./record";

export type Verdict = "best" | "great" | "excellent" | "good" | "inaccuracy" | "mistake" | "blunder" | "miss";

export const VERDICTS: Record<Verdict, { label: string; mark: string }> = {
  great: { label: t("Great move"), mark: "!!" },
  best: { label: t("Best move"), mark: "★" },
  excellent: { label: t("Excellent"), mark: "!" },
  good: { label: t("Good"), mark: "✓" },
  inaccuracy: { label: t("Inaccuracy"), mark: "?!" },
  mistake: { label: t("Mistake"), mark: "?" },
  miss: { label: t("Missed win"), mark: "✗" },
  blunder: { label: t("Blunder"), mark: "??" },
};

export const VERDICT_ORDER: Verdict[] = ["great", "best", "excellent", "good", "inaccuracy", "mistake", "miss", "blunder"];

const MATE_ZONE = MATE - 1000;

export const isMate = (score: number) => Math.abs(score) > MATE_ZONE;

export const mateIn = (score: number) => MATE - Math.abs(score);

export function winChance(score: number) {
  const cp = isMate(score) ? Math.sign(score) * 1500 : Math.max(-1500, Math.min(1500, score));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export const forSide = (score: number, side: Side) => (side === "w" ? score : -score);

export function scoreText(score: number) {
  if (isMate(score)) return (score > 0 ? "M" : "-M") + mateIn(score);
  const pawns = score / 100;
  return (pawns > 0 ? "+" : "") + pawns.toFixed(1);
}

export type Judged = Ply & {
  verdict: Verdict;
  winBefore: number;
  winAfter: number;
  loss: number;
  accuracy: number;
  best: string | null;
  scoreBefore: number;
  scoreAfter: number;
  allowsCard?: boolean;
};

export const ALLOWS_CARD = 6;

export function cardThreat(positions: PositionEval[], turns: TurnEval[], n: number, whiteToMove: boolean): number | null {
  const t = turns[n];
  if (!t) return null;
  const scores = [t.pre && positions[n] ? positions[n].score : null, t.alt?.score ?? null].filter((x): x is number => x !== null);
  if (!scores.length) return null;
  return whiteToMove ? Math.max(...scores) : Math.min(...scores);
}

export type Judgement = {
  moves: Judged[];
  accuracy: Record<Side, number>;
  counts: Record<Side, Record<Verdict, number>>;
};

function moveAccuracy(loss: number) {
  if (loss <= 0) return 100;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669 + 1));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const deviation = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export function gameAccuracy(white: number[], moves: { side: Side; accuracy: number }[]): Record<Side, number> {
  const size = Math.max(2, Math.min(8, Math.floor(moves.length / 10)));
  const windows: number[][] = [];
  for (let i = 0; i < size - 2; i++) windows.push(white.slice(0, size));
  for (let i = 0; i + size <= white.length; i++) windows.push(white.slice(i, i + size));
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, deviation(w))));
  const out = { w: 100, b: 100 };
  for (const side of ["w", "b"] as Side[]) {
    const mine = moves.map((m, i) => ({ a: m.accuracy, w: weights[i] ?? 0.5, side: m.side })).filter((m) => m.side === side);
    if (!mine.length) continue;
    const weighted = mine.reduce((t, m) => t + m.a * m.w, 0) / mine.reduce((t, m) => t + m.w, 0);
    const harmonic = mine.length / mine.reduce((t, m) => t + 1 / Math.max(1, m.a), 0);
    out[side] = (weighted + harmonic) / 2;
  }
  return out;
}

export function judge(plies: Ply[], positions: PositionEval[], turns: TurnEval[] = []): Judgement {
  const moves: Judged[] = [];
  const empty = () => Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0])) as Record<Verdict, number>;
  const counts = { w: empty(), b: empty() };

  for (let i = 0; i < plies.length && i + 1 < positions.length; i++) {
    const p = plies[i];
    const before = positions[i];
    const after = turns[i + 1]?.pre ?? positions[i + 1];
    const s = p.side;
    const mine = (score: number) => (s === "w" ? winChance(score) : 100 - winChance(score));
    const winBefore = mine(before.score);
    let winAfter = mine(after.score);
    let loss = Math.max(0, winBefore - winAfter);
    const isBest = before.best === p.uci;
    const dodge = turns[i]?.dodge;
    const threat = dodge ? cardThreat(positions, turns, i + 1, s === "b") : null;
    let allowsCard = false;
    if (dodge && threat !== null && !isBest) {
      const aware = Math.max(0, mine(dodge.score) - mine(threat));
      if (aware >= loss + ALLOWS_CARD) {
        loss = aware;
        winAfter = Math.min(winAfter, mine(threat));
        allowsCard = true;
      }
    }
    const hadMate = isMate(before.score) && forSide(before.score, s) > 0;
    const stillMate = isMate(after.score) && forSide(after.score, s) > 0;

    let verdict: Verdict;
    if (isBest) {
      const secondLoss = before.second === null ? 0 : Math.max(0, winBefore - mine(before.second));
      const prev = plies[i - 1];
      const recapture = !!p.captured && !!prev?.captured && prev.to === p.to;
      verdict = secondLoss >= 15 && winBefore > 10 && winBefore < 95 && !recapture ? "great" : "best";
    } else if (hadMate && !stillMate && winAfter < 90) {
      verdict = "miss";
    } else if (loss < 2) verdict = "excellent";
    else if (loss < 5) verdict = "good";
    else if (loss < 10) verdict = "inaccuracy";
    else if (loss < 20) verdict = "mistake";
    else verdict = "blunder";

    const accuracy = isBest ? 100 : moveAccuracy(loss);
    counts[s][verdict]++;
    moves.push({
      ...p,
      verdict,
      winBefore,
      winAfter,
      loss,
      accuracy,
      best: before.best,
      scoreBefore: before.score,
      scoreAfter: after.score,
      ...(allowsCard ? { allowsCard } : {}),
    });
  }
  const white = [positions.length ? winChance(positions[0].score) : 50, ...moves.map((m) => (m.side === "w" ? m.winAfter : 100 - m.winAfter))];
  return { moves, accuracy: gameAccuracy(white, moves), counts };
}