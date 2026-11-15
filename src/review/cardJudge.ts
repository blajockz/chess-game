import { t } from "../i18n";
import { Chess } from "chess.js";
import { CARDS, amountsFor, categoryOf, type CardId } from "../../shared/cards";
import type { AltEval, PositionEval, TurnEval } from "./analyse";
import { cardAction, cardLabel, type CardGame } from "./cardTurns";
import { NAME, amount, biggestTaken, material, sans, settled } from "./coach";
import { VERDICTS, isMate, mateIn, forSide, winChance, type Judged, type Verdict } from "./judge";
import type { GameRecord, Side } from "./record";

export const CARD_GOOD = 4;
export const CARD_GREAT = 15;
export const CARD_BAD = 4;
export const CARD_BLUNDER = 15;
export const CARD_BETTER = 8;
export const CARD_MISSED = 15;

export const CARD_TITLES: Record<Verdict, string> = {
  great: t("Great card"),
  best: t("Best card"),
  excellent: t("Good card"),
  good: t("Good card"),
  inaccuracy: t("Little effect"),
  mistake: t("Bad card"),
  miss: t("Bad card"),
  blunder: t("Card blunder"),
};

export type JudgedCard = {
  ply: number;
  side: Side;
  card: CardId;
  kind: "board" | "shield" | "time";
  label: string;
  verdict: Verdict | null;
  title: string;
  text: string;
  gain: number | null;
  better: { label: string; why: string; alt: AltEval } | null;
  shown: { fen: string; squares: string[] } | null;
  chance: string | null;
};

export type MissedCard = {
  ply: number;
  side: Side;
  label: string;
  gain: number;
  text: string;
  alt: AltEval;
};

export type CardTally = { good: number; weak: number; bad: number; missed: number };

export type CardJudgement = {
  cards: (JudgedCard | null)[];
  missed: (MissedCard | null)[];
  allowed: ({ label: string; text: string; alt: AltEval } | null)[];
  tally: Record<Side, CardTally>;
};

const SIDE_NAME = { w: t("White"), b: t("Black") };
const other = (s: Side): Side => (s === "w" ? "b" : "w");
const mineOf = (s: Side) => (score: number) => (s === "w" ? winChance(score) : 100 - winChance(score));
const pct = (n: number) => `${Math.round(n)}%`;

function clockText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
}
const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;

function winsIn(fen: string, pv: string[], side: Side) {
  const out = settled(fen, pv, side);
  return { net: out.value - material(new Chess(fen), side), taken: biggestTaken(out.moves, other(side)) };
}

function gainWords(fen: string, pv: string[], side: Side, baseline: number): string | null {
  const now = winsIn(fen, pv, side);
  if (baseline <= -2 && now.net - baseline >= 2 && now.net < 2) return t("saves {amount}", { amount: amount(now.net - baseline) });
  baseline = Math.max(0, baseline);
  if (now.net - baseline < 2) return null;
  const worth = now.taken?.captured;
  if (now.taken && worth && worth !== "p" && now.net >= 2.5) return t("wins the {v1} on {to}", { v1: NAME[worth], to: now.taken.to });
  return t("wins {amount}", { amount: amount(now.net - baseline) });
}

type Context = {
  game: CardGame;
  positions: PositionEval[];
  turns: TurnEval[];
  moves: Judged[];
  record: Pick<GameRecord, "control" | "clocks" | "result" | "winner">;
  you: Side | null;
};

function startOf(c: Context, i: number): PositionEval | undefined {
  return c.turns[i]?.pre ?? c.positions[i];
}

function altWords(c: Context, i: number, alt: AltEval, side: Side, against: number) {
  const mine = mineOf(side);
  const turn = c.game.turns[i];
  const start = startOf(c, i)!;
  const baseline = winsIn(turn.startFen, start.pv, side).net;
  const wins = gainWords(alt.fen, alt.pv, side, baseline);
  const action = cardAction(alt.card, alt.picks, turn.startFen, alt.fen);
  if (isMate(alt.score) && forSide(alt.score, side) > 0) return t("It {action} and forces mate in {mateIn}.", { action, mateIn: mateIn(alt.score) });
  if (wins) return t("It {action} and {wins}.", { action, wins });
  return t("It {action}: win chance {pct} instead of {pct_}.", { action, pct: pct(mine(alt.score)), pct_: pct(against) });
}

function shieldWords(c: Context, i: number, alt: AltEval, side: Side, against: number) {
  const mine = mineOf(side);
  const turn = c.game.turns[i];
  const start = startOf(c, i)!;
  const whose = c.you === side ? t("your") : t("{side}'s", { side: SIDE_NAME[side] });
  const before = new Chess(turn.startFen);
  const piece = NAME[before.get(alt.picks[0] as never)?.type ?? "n"];
  const san = alt.move ? sans(turn.startFen, [alt.move], 1)[0] : null;
  const moved = alt.move?.slice(0, 2) === alt.picks[0];
  const baseline = winsIn(turn.startFen, start.pv, side).net;
  const net = settled(alt.fen, alt.pv, side).value - material(before, side);
  let result: string;
  if (isMate(alt.score) && forSide(alt.score, side) > 0) result = t("it forces mate in {mateIn}", { mateIn: mateIn(alt.score) });
  else if (baseline <= -2 && net - baseline >= 2 && net < 2) result = t("it saves {amount}", { amount: amount(net - baseline) });
  else if (net - Math.max(0, baseline) >= 2) result = t("it wins {amount}", { amount: amount(net - Math.max(0, baseline)) });
  else result = t("win chance {pct} instead of {pct_}", { pct: pct(mine(alt.score)), pct_: pct(against) });
  const how = moved
    ? t("With the Shield on {whose} {piece}, {v3} can't be answered by taking it back", { whose, piece, v3: san ?? "the capture" })
    : t("With the Shield, {whose} {piece} on {v3} can't be taken, so there is time for {v4}", { whose, piece, v3: alt.picks[0], v4: san ?? "another move" });
  return {
    label: `${cardLabel("shield", alt.picks, turn.startFen)}${san ? `, then ${san}` : ""}`,
    text: `${how}: ${result}.`,
  };
}

function threatAt(c: Context, n: number): AltEval | null {
  const turn = c.game.turns[n];
  const t = c.turns[n];
  if (!turn || !t) return null;
  const mine = mineOf(turn.side);
  const played: AltEval | null =
    t.pre && turn.card && c.positions[n]
      ? { card: turn.card.card, picks: turn.card.picks, squares: turn.card.squares, fen: c.game.plies[n].before, score: c.positions[n].score, pv: c.positions[n].pv }
      : null;
  const alt = t.alt ?? null;
  if (played && alt) return mine(alt.score) > mine(played.score) ? alt : played;
  return played ?? alt;
}

function boardCard(c: Context, i: number): JudgedCard | null {
  const turn = c.game.turns[i];
  const card = turn.card!;
  const pre = c.turns[i]?.pre;
  const post = c.positions[i];
  if (!pre || !post) return null;
  const s = turn.side;
  const mine = mineOf(s);
  const whose = c.you === s ? t("your") : t("{side}'s", { side: SIDE_NAME[s] });
  const before = mine(pre.score);
  const after = mine(post.score);
  const gain = after - before;
  const fen = c.game.plies[i].before;
  const action = cardAction(card.card, card.picks, turn.startFen, fen);
  const alt = c.turns[i]?.alt ?? null;
  const beaten = alt && mine(alt.score) - after >= CARD_BETTER ? alt : null;

  let verdict: Verdict;
  if (gain >= CARD_GOOD) verdict = beaten ? "good" : gain >= CARD_GREAT ? "great" : "best";
  else if (gain > -CARD_BAD) verdict = "inaccuracy";
  else verdict = gain > -CARD_BLUNDER ? "mistake" : "blunder";

  const baseline = winsIn(turn.startFen, pre.pv, s).net;
  const now = winsIn(fen, post.pv, s);
  const next = sans(fen, post.pv, 1)[0];
  let text: string;
  if (gain >= CARD_GOOD) {
    const wins = gainWords(fen, post.pv, s, baseline);
    if (isMate(post.score) && forSide(post.score, s) > 0) text = t("It {action} and sets up mate in {mateIn}.", { action, mateIn: mateIn(post.score) });
    else if (wins) text = t("It {action} and {wins}{v3}.", { action, wins, v3: next ? t(" ({next} comes next)", { next }) : "" });
    else text = t("It {action}, and {whose} position gets better{v3}.", { action, whose, v3: next ? t(": {next} is now strong", { next }) : "" });
  } else if (gain > -CARD_BAD) {
    text = t("It {action}, but the position is worth about the same. A card can be played only once: it could have done more later.", { action });
  } else {
    const loses = baseline - now.net >= 2 ? t(": it loses {amount}", { amount: amount(baseline - now.net) }) : "";
    const mated = isMate(post.score) && forSide(post.score, s) < 0 ? t(": it allows mate in {mateIn}", { mateIn: mateIn(post.score) }) : loses;
    text = t("It {action}, and that makes {whose} position worse{mated}. Playing no card was better.", { action, whose, mated });
  }

  return {
    ply: i + 1,
    side: s,
    card: card.card,
    kind: "board",
    label: cardLabel(card.card, card.picks),
    verdict,
    title: CARD_TITLES[verdict],
    text,
    gain,
    better: beaten ? { label: cardLabel(beaten.card, beaten.picks), why: altWords(c, i, beaten, s, after), alt: beaten } : null,
    shown: { fen, squares: card.squares },
    chance: t("{v1}'s win chance: {pct} → {pct_}", { v1: SIDE_NAME[s], pct: pct(before), pct_: pct(after) }),
  };
}

function shieldCard(c: Context, i: number): JudgedCard | null {
  const turn = c.game.turns[i];
  const card = turn.card!;
  const free = c.turns[i]?.shieldFree;
  const next = startOf(c, i + 1);
  if (free === undefined || !next) return null;
  const s = turn.side;
  const mine = mineOf(s);
  const whose = c.you === s ? t("your") : t("{side}'s", { side: SIDE_NAME[s] });
  const moveFen = c.game.plies[i].before;
  const piece = new Chess(moveFen).get(card.picks[0] as never);
  const what = `${whose} ${NAME[piece?.type ?? "p"]}`;
  const afterMove = c.game.plies[i].after;
  const base = {
    ply: i + 1,
    side: s,
    card: card.card,
    kind: "shield" as const,
    label: cardLabel(card.card, card.picks, moveFen),
    better: null,
    shown: null,
  };
  if (free === null) {
    return {
      ...base,
      verdict: "inaccuracy",
      title: CARD_TITLES.inaccuracy,
      text: t("Nothing could take {what} on the next move, so the Shield stopped nothing.", { what }),
      gain: 0,
      chance: null,
    };
  }
  const withShield = mine(next.score);
  const without = mine(free.score);
  const gain = Math.max(0, withShield - without);
  const allowed = (i + 1 < c.game.turns.length ? c.game.turns[i + 1].startRestricted : c.game.finalRestricted) ?? [];
  const forbidden = new Chess(afterMove)
    .moves({ verbose: true })
    .filter((m) => !allowed.includes(m.from + m.to + (m.promotion ?? "")));
  const bestIsCapture = !!free.best && forbidden.some((m) => m.from + m.to + (m.promotion ?? "") === free.best);
  const capture = bestIsCapture ? sans(afterMove, [free.best!], 1)[0] : (forbidden[0]?.san ?? null);
  const lost = winsIn(afterMove, free.pv, other(s));
  let verdict: Verdict;
  let text: string;
  if (gain >= CARD_GOOD) {
    verdict = gain >= CARD_GREAT ? "great" : "best";
    text =
      bestIsCapture && lost.net >= 2
        ? t("Without the Shield, {capture} wins {what}. The Shield stopped it.", { capture, what })
        : t("Without the Shield, {v1} takes {what} and the position gets worse. The Shield stopped it.", { v1: capture ?? "a capture", what });
  } else {
    verdict = "inaccuracy";
    text = t("{v1} without the Shield, but it wasn't dangerous: the position is worth about the same.", { v1: capture ? t("{capture} was possible", { capture }) : t("A capture was possible") });
  }
  return {
    ...base,
    verdict,
    title: CARD_TITLES[verdict],
    text,
    gain,
    chance: t("{v1}'s win chance: {pct} without the Shield, {pct_} with it", { v1: SIDE_NAME[s], pct: pct(without), pct_: pct(withShield) }),
  };
}

function timeCard(c: Context, i: number): JudgedCard {
  const turn = c.game.turns[i];
  const card = turn.card!;
  const s = turn.side;
  const o = other(s);
  const who = c.you === s ? t("You") : SIDE_NAME[s];
  const whose = c.you === s ? t("your") : t("{side}'s", { side: SIDE_NAME[s] });
  const them = c.you === o ? t("you") : SIDE_NAME[o];
  const Them = c.you === o ? t("You") : SIDE_NAME[o];
  const a = amountsFor(categoryOf(c.record.control));
  const clocks = c.record.clocks;
  const initial = (side: Side) => (side === "b" ? (c.record.control.blackInitial ?? c.record.control.initial) : c.record.control.initial) * 1000;
  const before = (side: Side, at: number): number | null => {
    if (!clocks) return null;
    for (let j = at - 1; j >= 0; j--) {
      if (c.game.turns[j].side === side) return typeof clocks[j] === "number" ? clocks[j] : null;
    }
    return initial(side);
  };
  const final = (side: Side) => before(side, c.game.turns.length);
  const onTime = /wins on time/.test(c.record.result);
  let verdict: Verdict | null = null;
  let text: string;

  if (card.card === "thief") {
    const had = before(o, i);
    const taken = had === null ? a.steal * 1000 : Math.min(a.steal * 1000, Math.max(0, had - 10_000));
    const left = final(o);
    text = t("Took {seconds} from {v2} clock.", { seconds: seconds(taken), v2: c.you === o ? t("your") : t("{side}'s", { side: SIDE_NAME[o] }) });
    if (taken < a.steal * 500) {
      verdict = "inaccuracy";
      text += c.you === o ? t(" Your clock was already low, so there was little to take.") : t(" Their clock was already low, so there was little to take.");
    } else if (onTime && c.record.winner === s) {
      verdict = "best";
      text += t(" {Them} later lost on time: those seconds counted.", { Them });
    } else if (left !== null && left < a.steal * 3000) {
      verdict = "good";
      text += t(" {Them} finished with only {clockText}: it kept the pressure on.", { Them, clockText: clockText(left) });
    } else if (left !== null) {
      text += t(" {Them} still finished with {clockText}, so it changed little.", { Them, clockText: clockText(left) });
    }
  } else if (card.card === "overclock") {
    const left = final(s);
    text = t("Added {bonus} s to {whose} clock.", { bonus: a.bonus, whose });
    if (onTime && c.record.winner === o) {
      text += t(" It wasn't enough: the game was still lost on time.");
    } else if (left !== null && left < a.bonus * 1000) {
      verdict = "best";
      text += t(" {who} finished with {clockText}: without the card the clock would have run out.", { who, clockText: clockText(left) });
    } else if (left !== null && left > a.bonus * 4000) {
      text += t(" {who} finished with {clockText} left: the extra time wasn't needed.", { who, clockText: clockText(left) });
    } else if (left !== null) {
      text += t(" {who} finished with {clockText} left.", { who, clockText: clockText(left) });
    }
  } else if (card.card === "hourglass") {
    const had = before(o, i + 1);
    const then = clocks && typeof clocks[i + 1] === "number" ? clocks[i + 1] : null;
    const theirCard = c.game.turns[i + 1]?.card?.card;
    text = t("{v1} clock ran twice as fast on the next move.", { v1: Them === t("You") ? t("Your") : t("{side}'s", { side: Them }) });
    if (i + 1 >= c.game.turns.length) {
      verdict = "inaccuracy";
      text += t(" The game ended before it could cost anything.");
    } else if (had !== null && then !== null && theirCard !== "thief" && theirCard !== "overclock" && theirCard !== "pause") {
      const total = Math.max(0, had - (then - c.record.control.increment * 1000));
      const extra = Math.min(total / 2, a.cap * 1000);
      if (extra >= (a.cap * 1000) / 2) {
        verdict = "best";
        text += t(" It cost {them} about {seconds} more than normal.", { them, seconds: seconds(extra) });
      } else if (extra < (a.cap * 1000) / 5) {
        verdict = "inaccuracy";
        text += t(" {Them} answered quickly: it cost only about {seconds}.", { Them, seconds: seconds(extra) });
      } else {
        verdict = "good";
        text += t(" It cost {them} about {seconds} more than normal.", { them, seconds: seconds(extra) });
      }
    }
  } else {
    const move = c.moves[i];
    text = t("Stopped {whose} clock for up to {cap} s of thinking.", { whose, cap: a.cap });
    const had = before(s, i);
    const then = clocks && typeof clocks[i] === "number" ? clocks[i] : null;
    const paid = had !== null && then !== null ? had - (then - c.record.control.increment * 1000) : null;
    const full = paid !== null && paid > 500;
    if (full) text += t(" {who} thought for longer than that, so all {cap} s were free.", { who, cap: a.cap });
    else if (paid !== null) text += t(" {who} moved within that time: the clock didn't lose a second on this move.", { who });
    if (move) {
      const label = VERDICTS[move.verdict].label.toLowerCase();
      if (move.verdict === "best" || move.verdict === "great") {
        verdict = "good";
        text += t(" The time was used well: {san} was the best move.", { san: move.san });
      } else if (move.verdict === "excellent" || move.verdict === "good") {
        if (full) verdict = "good";
        text += t(" The move that followed, {san}, was {v2}.", { san: move.san, v2: move.verdict === "excellent" ? "an excellent move" : "a good move" });
      } else if (move.verdict === "inaccuracy") {
        text += t(" The move that followed, {san}, was an inaccuracy.", { san: move.san });
      } else {
        verdict = "inaccuracy";
        text += t(" But the move that followed, {san}, was a {label}.", { san: move.san, label });
      }
    }
  }

  const title = verdict === null ? t("Time card") : verdict === "inaccuracy" ? t("Little effect") : verdict === "best" ? t("Good timing") : t("Good card");
  return {
    ply: i + 1,
    side: s,
    card: card.card,
    kind: "time",
    label: t(CARDS[card.card].name),
    verdict,
    title,
    text,
    gain: null,
    better: null,
    shown: null,
    chance: null,
  };
}

export function judgeCards(
  game: CardGame,
  positions: PositionEval[],
  turns: TurnEval[],
  moves: Judged[],
  record: Pick<GameRecord, "control" | "clocks" | "result" | "winner">,
  you: Side | null
): CardJudgement {
  const c: Context = { game, positions, turns, moves, record, you };
  const cards: (JudgedCard | null)[] = [];
  const missed: (MissedCard | null)[] = [];
  const allowed: CardJudgement["allowed"] = [];
  const tally: Record<Side, CardTally> = { w: { good: 0, weak: 0, bad: 0, missed: 0 }, b: { good: 0, weak: 0, bad: 0, missed: 0 } };
  if (!game.known) return { cards, missed, allowed, tally };

  for (let i = 0; i < game.turns.length; i++) {
    const turn = game.turns[i];
    const s = turn.side;
    let judged: JudgedCard | null = null;
    if (turn.card && positions[i]) {
      const kind = CARDS[turn.card.card].kind;
      judged = kind === "time" ? timeCard(c, i) : turn.card.card === "shield" ? shieldCard(c, i) : boardCard(c, i);
    }
    cards[i] = judged;
    if (judged?.verdict) {
      if (judged.verdict === "inaccuracy") tally[s].weak++;
      else if (judged.verdict === "mistake" || judged.verdict === "blunder") tally[s].bad++;
      else tally[s].good++;
    }

    allowed[i] = null;
    if (moves[i]?.allowsCard) {
      const threat = threatAt(c, i + 1);
      const next = startOf(c, i + 1);
      if (threat && next) {
        const foe = other(s);
        const them = you === foe ? t("you") : SIDE_NAME[foe];
        allowed[i] = {
          label: cardLabel(threat.card, threat.picks),
          text: t("This lets {them} play {cardLabel}. {altWords}", { them, cardLabel: cardLabel(threat.card, threat.picks), altWords: altWords(c, i + 1, threat, foe, mineOf(foe)(next.score)) }),
          alt: threat,
        };
      }
    }

    missed[i] = null;
    const start = positions[i];
    if (!turn.card && start) {
      const mine = mineOf(s);
      const base = mine(start.score);
      const board = turns[i]?.alt ?? null;
      const shield = turns[i]?.shieldAlt ?? null;
      const alt = board && shield ? (mine(shield.score) > mine(board.score) ? shield : board) : (board ?? shield);
      const gain = alt ? mine(alt.score) - base : 0;
      if (alt && gain >= CARD_MISSED) {
        const again = missed[i - 2]?.alt.card === alt.card;
        if (again) {
          missed[i] = { ...missed[i - 2]!, ply: -1 };
        } else {
          const words = alt.card === "shield" ? shieldWords(c, i, alt, s, base) : { label: cardLabel(alt.card, alt.picks), text: altWords(c, i, alt, s, base) };
          missed[i] = { ply: i + 1, side: s, label: words.label, gain, text: words.text, alt };
          tally[s].missed++;
        }
      }
    }
  }
  for (let i = 0; i < missed.length; i++) if (missed[i]?.ply === -1) missed[i] = null;
  return { cards, missed, allowed, tally };
}