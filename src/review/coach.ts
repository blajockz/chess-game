import { t } from "../i18n";
import { Chess, type Move, type Square } from "chess.js";
import type { PositionEval } from "./analyse";
import { VERDICTS, forSide, isMate, mateIn, winChance, type Judged } from "./judge";
import type { Side } from "./record";

export const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME: Record<string, string> = { p: t("pawn"), n: t("knight"), b: t("bishop"), r: t("rook"), q: t("queen"), k: t("king") };
const SIDE_NAME = { w: t("White"), b: t("Black") };

export type Opinion = {
  title: string;
  text: string;
  better: { san: string; uci: string; why: string } | null;
  line: { san: string[]; uci: string[] } | null;
  reply: { san: string[]; uci: string[] } | null;
  chance: string;
};

const other = (s: Side): Side => (s === "w" ? "b" : "w");

export function material(chess: Chess, side: Side) {
  let sum = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell) sum += (cell.color === side ? 1 : -1) * VALUE[cell.type];
    }
  }
  return sum;
}

function play(fen: string, uci: string[], max = 10) {
  const chess = new Chess(fen);
  const moves: Move[] = [];
  for (const u of uci.slice(0, max)) {
    try {
      moves.push(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
    } catch {
      break;
    }
  }
  return { chess, moves };
}

export function settled(fen: string, uci: string[], side: Side) {
  const chess = new Chess(fen);
  let value = material(chess, side);
  const moves: Move[] = [];
  for (let k = 0; k < Math.min(uci.length, 10); k++) {
    let m: Move;
    try {
      m = chess.move({ from: uci[k].slice(0, 2), to: uci[k].slice(2, 4), promotion: uci[k][4] });
    } catch {
      break;
    }
    const forcing = !!m.captured || !!m.promotion || chess.isCheck();
    if (k >= 2 && !forcing) break;
    moves.push(m);
    value = material(chess, side);
  }
  return { value, moves };
}

function looseOf(chess: Chess, side: Side) {
  const out: { square: Square; type: string }[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== side || VALUE[cell.type] < 3) continue;
      const attackers = chess.attackers(cell.square, other(side));
      if (!attackers.length) continue;
      const defended = chess.attackers(cell.square, side).length > 0;
      const cheapest = Math.min(...attackers.map((sq) => VALUE[chess.get(sq)!.type] || 100));
      if (!defended || cheapest < VALUE[cell.type]) out.push({ square: cell.square, type: cell.type });
    }
  }
  return out;
}

function forked(chess: Chess, from: Square, side: Side) {
  const piece = chess.get(from);
  if (!piece) return [];
  const hits: { square: Square; type: string }[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== side || (cell.type !== "k" && VALUE[cell.type] < 3)) continue;
      if (!chess.attackers(cell.square, other(side)).includes(from)) continue;
      const worthMore = VALUE[cell.type] > VALUE[piece.type];
      const unprotected = chess.attackers(cell.square, side).length === 0;
      if (cell.type === "k" || worthMore || unprotected) hits.push({ square: cell.square, type: cell.type });
    }
  }
  return hits;
}

export function amount(points: number) {
  if (points >= 9) return t("a queen's worth of material");
  if (points >= 5) return t("a rook's worth of material");
  if (points >= 3) return t("a piece");
  if (points >= 2) return t("two pawns");
  return t("a pawn");
}

export function biggestTaken(moves: Move[], victim: Side) {
  let best: Move | null = null;
  for (const m of moves) {
    if (m.color === victim || !m.captured) continue;
    if (!best || VALUE[m.captured] > VALUE[best.captured!]) best = m;
  }
  return best;
}

export function sans(fen: string, uci: string[], max: number) {
  return play(fen, uci, max).moves.map((m) => m.san);
}

function keeping(win: number) {
  if (win >= 85) return t("keeping a winning position");
  if (win >= 65) return t("keeping a clear advantage");
  if (win >= 55) return t("keeping the upper hand");
  if (win >= 45) return t("keeping the balance");
  if (win >= 25) return t("keeping the game going");
  return t("putting up the most resistance");
}

function strengths(fen: string, uci: string, line: string[], mover: Side, whose: string, ply: number, retake: string | null) {
  const chess = new Chess(fen);
  const m = play(fen, [uci], 1).moves[0];
  if (!m) return [] as string[];
  const reasons: string[] = [];
  const looseBefore = looseOf(chess, mover);
  const afterMove = new Chess(m.after);
  if (afterMove.isCheckmate()) return ["checkmate"];
  const gain = settled(fen, line[0] === uci ? line : [uci], mover);
  const start = material(chess, mover);
  const net = gain.value - start;
  if (m.captured && m.to === retake) {
    reasons.push(t("taking back on {to}", { to: m.to }));
  } else if (net >= 2) {
    const taken = biggestTaken(gain.moves, other(mover));
    const worth = taken ? VALUE[taken.captured!] : 0;
    if (taken && worth >= 3 && net >= worth - 0.5) reasons.push(t("winning the {v1} on {to}", { v1: NAME[taken.captured!], to: taken.to }));
    else if (taken?.captured === "r" && net < 3) reasons.push(t("winning the exchange (a rook for a minor piece)"));
    else reasons.push(t("winning {amount}", { amount: amount(net) }));
  } else if (m.captured) {
    reasons.push(t("taking the {v1} on {to}", { v1: NAME[m.captured], to: m.to }));
  }
  if (looseBefore.length && !m.captured) {
    const looseAfter = looseOf(afterMove, mover).map((p) => p.square);
    const saved = looseBefore.find((p) => !looseAfter.includes(p.square) && p.square !== m.to);
    if (looseBefore.some((p) => p.square === m.from)) {
      reasons.push(t("moving {whose} {v2} to safety", { whose, v2: NAME[m.piece] }));
    } else if (saved) {
      reasons.push(t("defending {whose} {piece} on {square}", { whose, piece: NAME[saved.type], square: saved.square }));
    }
  }
  const targets = forked(afterMove, m.to as Square, other(mover));
  if (!reasons.length && targets.length >= 2) {
    reasons.push(t("attacking {listOf} at once", { listOf: listOf(targets.map((x) => (x.type === "k" ? t("the king") : t("the {piece} on {square}", { piece: NAME[x.type], square: x.square })))) }));
  }
  if (m.flags.includes("k") || m.flags.includes("q")) reasons.push(t("castling {whose} king to safety", { whose }));
  if (!reasons.length && ply <= 20 && (m.piece === "n" || m.piece === "b") && /[18]$/.test(m.from)) {
    reasons.push(t("developing {whose} {piece}", { whose, piece: NAME[m.piece] }));
  }
  if (!reasons.length && ply <= 12 && m.piece === "p" && ["d4", "e4", "d5", "e5"].includes(m.to)) {
    reasons.push(t("taking space in the centre"));
  }
  if (afterMove.isCheck() && reasons.length) reasons[0] += t(" with check");
  return reasons;
}

export function sentence(text: string) {
  const t = text.trim();
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : "";
}

function listOf(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : items.slice(0, -1).join(", ") + t(" and ") + items[items.length - 1];
}

export function opinion(
  m: Judged,
  before: PositionEval,
  after: PositionEval,
  you: Side | null,
  previous: { to: string; captured?: string } | null = null
): Opinion {
  const s = m.side;
  const retake = previous?.captured ? previous.to : null;
  const whose = you === s ? t("your") : t("{side}'s", { side: SIDE_NAME[s] });
  const title = VERDICTS[m.verdict].label;
  const chance = t("{v1}'s win chance: {v2}% → {v3}%", { v1: SIDE_NAME[s], v2: Math.round(m.winBefore), v3: Math.round(m.winAfter) });
  const bestLine = before.pv.length ? { uci: before.pv.slice(0, 8), san: sans(m.before, before.pv, 8) } : null;
  const bestSan = bestLine?.san[0] ?? null;
  const good = ["best", "great", "excellent", "good"].includes(m.verdict);

  if (good) {
    const own = strengths(m.before, m.uci, m.uci === before.best ? before.pv : [m.uci, ...after.pv], s, whose, m.ply, retake);
    let text: string;
    const doomed = isMate(m.scoreAfter) && forSide(m.scoreAfter, s) < 0;
    if (own[0] === "checkmate") text = t("Checkmate!");
    else if (doomed) text = t("The best defence, but mate can't be stopped anymore.");
    else if (isMate(m.scoreAfter) && forSide(m.scoreAfter, s) > 0) {
      text = t("{san} sets up mate in {mateIn}.", { san: m.san, mateIn: mateIn(m.scoreAfter) });
    } else if (m.verdict === "great") {
      text = t("The only move that {v1}{v2}.", { v1: m.winBefore >= 55 ? t("keeps the advantage") : t("holds the position"), v2: own.length ? ": " + listOf(own) : "" });
    } else if (m.verdict === "best") {
      text = own.length ? sentence(listOf(own)) : t("{san} is the move the coach would play here.", { san: m.san });
    } else {
      text = own.length ? sentence(listOf(own)) : t("A sound move.");
    }
    let better: Opinion["better"] = null;
    if (m.verdict === "good" && before.best && bestSan) {
      const why = strengths(m.before, before.best, before.pv, s, whose, m.ply, retake);
      better = { san: bestSan, uci: before.best, why: sentence(why.length ? listOf(why) : t("slightly more precise")) };
    }
    return { title, text, better, line: m.verdict === "good" ? bestLine : null, reply: null, chance };
  }

  const opp = other(s);
  const replyLine = after.pv.length ? { uci: after.pv.slice(0, 6), san: sans(m.after, after.pv, 6) } : null;
  const reply = replyLine?.san[0];
  const startMat = material(new Chess(m.before), s);
  const playedOut = settled(m.after, after.pv, s);
  const bestOut = before.pv.length ? settled(m.before, before.pv, s) : { value: startMat, moves: [] };
  const swing = playedOut.value - bestOut.value;
  const problems: string[] = [];

  const oppMates = isMate(m.scoreAfter) && forSide(m.scoreAfter, opp) > 0;
  const wasLost = isMate(m.scoreBefore) && forSide(m.scoreBefore, opp) > 0;
  if (m.verdict === "miss") {
    problems.push(t("{v1} had mate in {mateIn} here and let it slip.", { v1: SIDE_NAME[s], mateIn: mateIn(m.scoreBefore) }));
  } else if (oppMates && !wasLost) {
    problems.push(t("This allows mate in {mateIn}{v2}.", { mateIn: mateIn(m.scoreAfter), v2: reply ? t(", starting with {reply}", { reply }) : "" }));
  } else if (oppMates && wasLost) {
    problems.push(t("Mate was coming anyway, but this makes it quicker."));
  } else if (swing <= -2) {
    const lost = biggestTaken(playedOut.moves, s);
    const replyMove = play(m.after, after.pv, 1).moves[0];
    const loose = looseOf(new Chess(m.after), s);
    const fork = replyMove ? forked(new Chess(replyMove.after), replyMove.to as Square, s) : [];
    if (fork.length >= 2) {
      problems.push(
        t("This allows a fork: {reply} attacks {listOf}{v3}.", { reply, listOf: listOf(fork.map((f) => t("{whose} {piece}", { whose, piece: NAME[f.type] }))), v3: lost ? (lost.captured === "p" ? t(", and material is lost") : t(", and the {piece} is lost", { piece: NAME[lost.captured!] })) : "" })
      );
    } else if (lost && loose.some((p) => p.square === lost.to)) {
      problems.push(t("This leaves {whose} {v2} on {to} undefended: {reply} wins it.", { whose, v2: NAME[lost.captured!], to: lost.to, reply }));
    } else if (lost && VALUE[lost.captured!] >= 3 && -swing >= 2) {
      problems.push(t("This loses {whose} {v2} after {reply}.", { whose, v2: NAME[lost.captured!], reply }));
    } else {
      problems.push(t("This loses {amount}{v2}.", { amount: amount(-swing), v2: reply ? t(" after {reply}", { reply }) : "" }));
    }
  } else if (m.winBefore >= 60 && m.winAfter < 55) {
    problems.push(t("This gives away the advantage."));
  } else if (m.winBefore >= 40 && m.winAfter < 35) {
    problems.push(t("This hands the initiative to {v1}.", { v1: SIDE_NAME[opp] }));
  } else if (m.verdict === "inaccuracy") {
    problems.push(t("A small slip: it makes the position a little harder."));
  } else {
    problems.push(t("This makes {whose} position clearly worse{v2}.", { whose, v2: reply ? t(": {reply} is strong", { reply }) : "" }));
  }

  let better: Opinion["better"] = null;
  if (before.best && bestSan) {
    let why: string;
    if (isMate(m.scoreBefore) && forSide(m.scoreBefore, s) > 0) {
      why = t("forcing mate in {mateIn}", { mateIn: mateIn(m.scoreBefore) });
    } else {
      const reasons = strengths(m.before, before.best, before.pv, s, whose, m.ply, retake);
      if (!reasons.length && swing <= -2) reasons.push(t("which keeps the material even"));
      why = reasons.length ? listOf(reasons) : keeping(s === "w" ? winChance(m.scoreBefore) : 100 - winChance(m.scoreBefore));
    }
    better = { san: bestSan, uci: before.best, why: sentence(why) };
  }

  return { title, text: problems.join(" "), better, line: bestLine, reply: replyLine, chance };
}

export function gameVerdict(accuracy: number, blunders: number, mistakes: number) {
  if (accuracy >= 90 && blunders === 0) return t("An excellent game: very few slips.");
  if (accuracy >= 80 && blunders === 0) return t("A strong game.");
  if (accuracy >= 70) return blunders ? t("A solid game, with one costly moment.") : t("A solid game.");
  if (accuracy >= 55) return t("A fair game, with some mistakes to learn from.");
  return blunders + mistakes > 0 ? t("A tough game: the review shows where it went wrong.") : t("A tough game.");
}