import { t } from "../i18n";
import { Chess, type Move } from "chess.js";
import { CARDS, applyBoardCard, targetsFor, type CardId } from "../../shared/cards";
import { CardReferee } from "../../shared/cardGame";
import { pliesOf, type GameRecord, type Ply, type Side } from "./record";

export type CardOption = {
  card: CardId;
  picks: string[];
  squares: string[];
  fen: string;
  restricted: string[] | null;
};

export type TurnCard = { card: CardId; picks: string[]; squares: string[] };

export type Turn = {
  side: Side;
  startFen: string;
  startRestricted: string[] | null;
  moveRestricted: string[] | null;
  shielded: string | null;
  card: TurnCard | null;
  options: CardOption[];
  playable: CardId[];
};

export type ShieldPlan = {
  square: string;
  move: string;
  from: string;
  to: string;
  fen: string;
  restricted: string[];
};

export type CardGame = {
  plies: Ply[];
  turns: Turn[];
  finalRestricted: string[] | null;
  known: boolean;
};

const uciOf = (m: Move) => m.from + m.to + (m.promotion ?? "");

function restriction(ref: CardReferee): string[] | null {
  if (!ref.shieldedSquare()) return null;
  const allowed = ref.legalMoves();
  return allowed.length === ref.chess.moves().length ? null : allowed;
}

function restrictedIn(fen: string, square: string | null): string[] | null {
  if (!square) return null;
  const all = new Chess(fen).moves({ verbose: true });
  const kept = all.filter((m) => !(m.captured && (m.flags.includes("e") ? m.to[0] + m.from[1] : m.to) === square));
  return kept.length && kept.length < all.length ? kept.map(uciOf) : null;
}

export function optionsFor(cards: CardId[], fen: string, side: Side, shielded: string | null): CardOption[] {
  const out: CardOption[] = [];
  const add = (card: CardId, picks: string[]) => {
    const r = applyBoardCard(card, fen, side, picks);
    if (r) out.push({ card, picks, squares: r.squares, fen: r.fen, restricted: restrictedIn(r.fen, shielded) });
  };
  for (const card of cards) {
    if (card === "leap" || card === "retreat") {
      for (const sq of targetsFor(card, fen, side)) add(card, [sq]);
    } else if (card === "swap") {
      const seen = new Set<string>();
      for (const a of targetsFor(card, fen, side)) {
        for (const b of targetsFor(card, fen, side, [a])) {
          const key = [a, b].sort().join();
          if (!seen.has(key)) {
            seen.add(key);
            add(card, [a, b]);
          }
        }
      }
    }
  }
  return out;
}

const WORTH: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function shieldPlans(fen: string, side: Side, moves: (string | null)[], allowed: string[] | null): ShieldPlan[] {
  const chess = new Chess(fen);
  if (chess.isCheck()) return [];
  const foe: Side = side === "w" ? "b" : "w";
  const legal = chess.moves({ verbose: true }).filter((m) => !allowed || allowed.includes(uciOf(m)));
  const pieces = chess
    .board()
    .flat()
    .filter((c) => !!c && c.color === side && WORTH[c.type] >= 3)
    .map((c) => c!);
  const wanted: { square: string; move: Move; worth: number }[] = [];
  const quiet = [...new Set(moves.filter((m): m is string => !!m))];
  for (const piece of pieces) {
    if (chess.attackers(piece.square, foe).length) {
      for (const uci of quiet) {
        const m = legal.find((l) => uciOf(l) === uci);
        if (m) wanted.push({ square: piece.square, move: m, worth: WORTH[piece.type] });
      }
    }
    for (const m of legal) {
      if (m.from === piece.square && m.captured && chess.attackers(m.to, foe).length) {
        wanted.push({ square: piece.square, move: m, worth: WORTH[piece.type] + WORTH[m.captured] });
      }
    }
  }
  wanted.sort((a, b) => b.worth - a.worth);
  const plans: ShieldPlan[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    const key = w.square + uciOf(w.move);
    if (seen.has(key) || plans.length >= 8) continue;
    seen.add(key);
    const target = w.move.from === w.square ? w.move.to : w.square;
    const replies = new Chess(w.move.after).moves({ verbose: true });
    const kept = replies.filter((m) => !(m.captured && (m.flags.includes("e") ? m.to[0] + m.from[1] : m.to) === target));
    if (!kept.length || kept.length === replies.length) continue;
    plans.push({ square: w.square, move: uciOf(w.move), from: w.move.from, to: w.move.to, fen: w.move.after, restricted: kept.map(uciOf) });
  }
  return plans;
}

function plain(plies: Ply[]): CardGame {
  return {
    plies,
    turns: plies.map((p) => ({
      side: p.side,
      startFen: p.before,
      startRestricted: null,
      moveRestricted: null,
      shielded: null,
      card: null,
      options: [],
      playable: [],
    })),
    finalRestricted: null,
    known: false,
  };
}

export function turnsOf(record: Pick<GameRecord, "steps" | "control" | "cards" | "hand" | "cardLog">): CardGame {
  const plies = pliesOf(record.steps);
  if (!record.cards || !record.hand || !record.cardLog) return plain(plies);
  try {
    const ref = new CardReferee(record.control, record.hand, false);
    const log = record.cardLog;
    let next = 0;
    const turns: Turn[] = [];
    for (const ply of plies) {
      const side = ref.turn;
      const startFen = ref.chess.fen();
      const shielded = ref.shieldedSquare();
      const startRestricted = restriction(ref);
      const playable = ref.playable(side);
      const boardCards = playable.filter((c) => CARDS[c].kind === "board" && c !== "shield");
      let card: TurnCard | null = null;
      while (next < log.length && log[next].ply === ref.ply) {
        const c = log[next++];
        const played = ref.playCard(c.side, c.card, c.picks ?? []);
        card = { card: c.card, picks: c.picks ?? [], squares: played.squares };
      }
      if (ref.chess.fen() !== ply.before) throw new Error(t("The cards don't match the moves."));
      const options = optionsFor(boardCards, startFen, side, shielded).filter(
        (o) => !(card && o.card === card.card && o.picks.join() === card.picks.join())
      );
      turns.push({ side, startFen, startRestricted, moveRestricted: restriction(ref), shielded, card, options, playable });
      ref.move(ply.san);
    }
    return { plies, turns, finalRestricted: restriction(ref), known: true };
  } catch {
    return plain(plies);
  }
}

const PIECE: Record<string, string> = { p: t("pawn"), n: t("knight"), b: t("bishop"), r: t("rook"), q: t("queen"), k: t("king") };

export function cardLabel(card: CardId, picks: string[], fen?: string) {
  const name = t(CARDS[card].name);
  if (card === "swap") return t("{name} {a} and {b}", { name, a: picks[0], b: picks[1] });
  if (card === "shield" && fen) {
    const piece = new Chess(fen).get(picks[0] as never);
    return piece ? t("{name} on the {v2} ({v3})", { name, v2: PIECE[piece.type], v3: picks[0] }) : t("{name} on {square}", { name, square: picks[0] });
  }
  return picks.length ? t("{name} on {square}", { name, square: picks[0] }) : name;
}

export function cardAction(card: CardId, picks: string[], before: string, after: string) {
  const was = new Chess(before);
  if (card === "leap") {
    const to = picks[0][0] + (Number(picks[0][1]) + (was.get(picks[0] as never)?.color === "w" ? 1 : -1));
    return t("pushes the pawn from {v1} to {to}", { v1: picks[0], to });
  }
  if (card === "retreat") {
    const piece = was.get(picks[0] as never);
    const now = new Chess(after);
    const home = now
      .board()
      .flat()
      .find((c) => c && c.type === piece?.type && c.color === piece?.color && !was.get(c.square))?.square;
    return t("sends the {v1} on {v2} back to {v3}", { v1: PIECE[piece?.type ?? "n"], v2: picks[0], v3: home ?? "its home square" });
  }
  if (card === "swap") {
    const a = was.get(picks[0] as never);
    const b = was.get(picks[1] as never);
    return t("trades the {v1} on {v2} with the {v3} on {v4}", { v1: PIECE[a?.type ?? "n"], v2: picks[0], v3: PIECE[b?.type ?? "b"], v4: picks[1] });
  }
  if (card === "shield") {
    const piece = was.get(picks[0] as never);
    return t("protects the {v1} on {v2} from capture for one move", { v1: PIECE[piece?.type ?? "p"], v2: picks[0] });
  }
  return "";
}