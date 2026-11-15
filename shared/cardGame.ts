import { Chess, type Move } from "chess.js";
import {
  CARDS,
  CARD_IDS,
  CLOCK_FLOOR_MS,
  HAND_SIZE,
  MAX_CHARGE,
  NO_MODS,
  UNLOCK_PLY,
  amountsFor,
  applyBoardCard,
  capturedSquare,
  categoryOf,
  clockCost,
  liveShield,
  newCardsState,
  targetsFor,
  type CardId,
  type CardsState,
  type ClockMods,
  type PlayedCard,
} from "./cards.js";
import type { TimelineEvent } from "./protocol.js";

type Side = "w" | "b";
const other = (s: Side): Side => (s === "w" ? "b" : "w");
const NAME = { w: "White", b: "Black" };

export type Control = { initial: number; increment: number; blackInitial?: number };

export class CardRuleError extends Error {}

export class CardReferee {
  chess = new Chess();
  ply = 0;
  cards: CardsState;
  steps: TimelineEvent[] = [];
  trail: number[] = [];
  clock: { w: number; b: number } | null;
  mods: { w: ClockMods; b: ClockMods } = { w: { ...NO_MODS }, b: { ...NO_MODS } };
  private control: Control;

  constructor(control: Control, hand: CardId[], withClocks: boolean) {
    this.control = control;
    this.cards = newCardsState(hand);
    this.clock = withClocks ? { w: control.initial * 1000, b: (control.blackInitial ?? control.initial) * 1000 } : null;
  }

  get turn(): Side {
    return this.chess.turn();
  }

  whyNot(side: Side, card: CardId): string | null {
    const c = this.cards;
    if (!c.hand.includes(card)) return "That card isn't in this game.";
    if (c.used[side].includes(card)) return "Already used.";
    if (this.ply < UNLOCK_PLY) return "Cards aren't unlocked yet.";
    if (this.turn !== side) return "Wait for your turn.";
    if (c.lastPlayed[side] === this.ply) return "One card per turn.";
    if (this.chess.isCheck()) return "Not while in check.";
    if (c.charge[side] < CARDS[card].cost) return `Needs ${CARDS[card].cost} Charge.`;
    if (card === "thief" && this.clock && this.clock[other(side)] <= CLOCK_FLOOR_MS) {
      return "Their clock is already under 10 s.";
    }
    return null;
  }

  playable(side: Side): CardId[] {
    return this.cards.hand.filter((c) => this.whyNot(side, c) === null);
  }

  shieldedSquare(): string | null {
    return liveShield(this.cards, this.chess.fen(), this.turn, this.ply)?.square ?? null;
  }

  playCard(side: Side, card: CardId, picks: string[]): PlayedCard {
    const why = this.whyNot(side, card);
    if (why) throw new CardRuleError(why);
    const def = CARDS[card];
    if (picks.length !== def.targets) throw new CardRuleError("Pick the right squares for this card.");
    const fen = this.chess.fen();
    for (let i = 0; i < picks.length; i++) {
      if (!targetsFor(card, fen, side, picks.slice(0, i)).includes(picks[i])) {
        throw new CardRuleError("That square isn't allowed.");
      }
    }
    const c = this.cards;
    const foe = other(side);
    const a = amountsFor(categoryOf(this.control));
    let squares: string[] = [];
    let message = `${NAME[side]} played ${def.name}`;

    if (card === "thief") {
      if (this.clock) {
        const take = Math.min(a.steal * 1000, Math.max(0, this.clock[foe] - CLOCK_FLOOR_MS));
        this.clock[foe] -= take;
        this.clock[side] += take;
        message += `: took ${Math.round(take / 1000)} s`;
      }
    } else if (card === "overclock") {
      if (this.clock) this.clock[side] += a.bonus * 1000;
      message += `: +${a.bonus} s`;
    } else if (card === "hourglass") {
      this.mods[foe] = { ...this.mods[foe], rate: 2, extra: a.cap * 1000 };
      message += `: ${NAME[foe]}'s clock runs ×2`;
    } else if (card === "pause") {
      this.mods[side] = { ...this.mods[side], free: a.cap * 1000 };
      message += `: clock stopped for up to ${a.cap} s`;
    } else if (card === "shield") {
      c.shield = { square: picks[0], owner: side, untilPly: this.ply + 2 };
      squares = [picks[0]];
    } else {
      const result = applyBoardCard(card, fen, side, picks);
      if (!result) throw new CardRuleError("That isn't allowed.");
      this.chess = new Chess(result.fen);
      this.steps.push({ t: "card", fen: result.fen });
      squares = result.squares;
    }

    const played: PlayedCard = { ply: this.ply, side, card, picks: [...picks], squares, message };
    c.charge[side] -= def.cost;
    c.used[side] = [...c.used[side], card];
    c.lastPlayed[side] = this.ply;
    c.log = [...c.log, played];
    return played;
  }

  legalMoves(): string[] {
    const all = this.chess.moves({ verbose: true });
    const shielded = this.shieldedSquare();
    const uci = (m: Move) => m.from + m.to + (m.promotion ?? "");
    if (!shielded) return all.map(uci);
    const kept = all.filter((m) => !(m.captured && capturedSquare(m) === shielded));
    return (kept.length ? kept : all).map(uci);
  }

  spend(side: Side, elapsedMs: number) {
    if (!this.clock) return false;
    const cost = clockCost(this.mods[side], this.clock[side], elapsedMs);
    this.mods[side] = {
      ...this.mods[side],
      free: this.mods[side].free - cost.freeUsed,
      extra: this.mods[side].extra - cost.extra,
    };
    this.clock[side] = Math.max(0, this.clock[side] - cost.total);
    return this.clock[side] <= 0;
  }

  move(move: string): Move {
    const side = this.turn;
    const legal = this.legalMoves();
    let played: Move;
    try {
      const probe = new Chess(this.chess.fen());
      const m = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)
        ? probe.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] })
        : probe.move(move);
      if (!legal.includes(m.from + m.to + (m.promotion ?? ""))) throw new Error("shielded");
      played = this.chess.move(m.san);
    } catch {
      throw new CardRuleError(`That move isn't allowed: ${move}`);
    }
    this.ply++;
    this.steps.push({ t: "move", san: played.san });
    if (this.clock) {
      this.clock[side] += this.control.increment * 1000;
      this.trail.push(Math.round(this.clock[side]));
    }
    this.mods[side] = { ...NO_MODS };
    const c = this.cards;
    c.charge[side] = Math.min(MAX_CHARGE, c.charge[side] + 1);
    if (c.shield && c.shield.owner === side && c.shield.square === played.from) {
      c.shield = { ...c.shield, square: played.to };
    }
    if (c.shield && this.ply >= c.shield.untilPly) c.shield = null;
    return played;
  }

  boardResult(): string | null {
    const c = this.chess;
    if (c.isCheckmate()) return `${NAME[other(this.turn)]} wins by checkmate`;
    if (c.isStalemate()) return "Draw by stalemate";
    if (c.isThreefoldRepetition()) return "Draw by repetition";
    if (c.isInsufficientMaterial()) return "Draw by insufficient material";
    if (c.isDraw()) return "Draw";
    return null;
  }
}

export function isHand(hand: unknown): hand is CardId[] {
  return (
    Array.isArray(hand) &&
    hand.length === HAND_SIZE &&
    new Set(hand).size === HAND_SIZE &&
    hand.every((c) => (CARD_IDS as string[]).includes(c as string))
  );
}

type LoggedCard = { ply: number; side: Side; card: CardId; picks: string[] };

export function replayCardGame(control: Control, hand: unknown, log: unknown, steps: TimelineEvent[]): string | null {
  if (!isHand(hand)) return "The hand isn't valid.";
  if (!Array.isArray(log) || log.length > CARD_IDS.length * 2) return "The card log isn't valid.";
  const cards: LoggedCard[] = [];
  for (const raw of log as Record<string, unknown>[]) {
    if (
      !raw ||
      !Number.isInteger(raw.ply) ||
      (raw.side !== "w" && raw.side !== "b") ||
      !(CARD_IDS as string[]).includes(raw.card as string) ||
      !Array.isArray(raw.picks) ||
      !(raw.picks as unknown[]).every((p) => typeof p === "string" && /^[a-h][1-8]$/.test(p))
    ) {
      return "The card log isn't valid.";
    }
    cards.push({ ply: raw.ply as number, side: raw.side, card: raw.card as CardId, picks: raw.picks as string[] });
  }
  if (cards.some((c, i) => i > 0 && c.ply < cards[i - 1].ply)) return "The card log is out of order.";

  const ref = new CardReferee(control, hand, false);
  let next = 0;
  const playCardsAt = (stepIndex: number): { error: string } | { consumed: number } => {
    let consumed = 0;
    while (next < cards.length && cards[next].ply === ref.ply) {
      const c = cards[next++];
      try {
        ref.playCard(c.side, c.card, c.picks);
      } catch (err) {
        return { error: `Card ${CARDS[c.card].name} at move ${Math.ceil((c.ply + 1) / 2)}: ${(err as Error).message}` };
      }
      if (CARDS[c.card].kind === "board" && c.card !== "shield") {
        const step = steps[stepIndex + consumed];
        if (!step || step.t !== "card" || step.fen !== ref.chess.fen()) {
          return { error: "A board card doesn't match the game." };
        }
        consumed++;
      }
    }
    return { consumed };
  };

  let i = 0;
  while (i < steps.length) {
    const r = playCardsAt(i);
    if ("error" in r) return r.error;
    i += r.consumed;
    const step = steps[i];
    if (!step) break;
    if (step.t !== "move") return "A board change has no card behind it.";
    try {
      ref.move(step.san);
    } catch (err) {
      return (err as Error).message;
    }
    if (ref.boardResult() && i < steps.length - 1) return "Moves were played after the game ended.";
    i++;
  }
  const tail = playCardsAt(i);
  if ("error" in tail) return tail.error;
  if (i + tail.consumed !== steps.length) return "A board change has no card behind it.";
  if (next !== cards.length) return "A card in the log was never played.";
  return null;
}