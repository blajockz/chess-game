import { Chess, type Move } from "chess.js";
import { CARDS, CARD_IDS, applyBoardCard, type CardId } from "./cards.js";

const CARD_STEP = new RegExp(`^(${CARD_IDS.join("|")})(?::([a-h][1-8])(?:\\+([a-h][1-8]))?)?$`);
const MOVE_STEP = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export type CardStep = { card: CardId; picks: string[] };

export function isMoveStep(step: string) {
  return MOVE_STEP.test(step);
}

export function cardStep(step: string): CardStep | null {
  const m = CARD_STEP.exec(step);
  if (!m) return null;
  const card = m[1] as CardId;
  const picks = [m[2], m[3]].filter((x): x is string => !!x);
  const needs = CARDS[card].kind === "time" ? 0 : card === "swap" ? 2 : 1;
  return picks.length === needs ? { card, picks } : null;
}

export function cardStepText(card: CardId, picks: string[]) {
  if (!picks.length) return card;
  return `${card}:${(card === "swap" ? [...picks].sort() : picks).join("+")}`;
}

export function sameCardStep(a: string, b: string) {
  const x = cardStep(a);
  const y = cardStep(b);
  return !!x && !!y && cardStepText(x.card, x.picks) === cardStepText(y.card, y.picks);
}

export type PuzzleBoard = {
  chess: Chess;
  shield: string | null;
};

export type StepResult = { move: Move | null; card: CardStep | null; squares: string[] };

export function playStep(board: PuzzleBoard, step: string): StepResult | null {
  if (isMoveStep(step)) {
    let move: Move;
    try {
      move = board.chess.move({ from: step.slice(0, 2), to: step.slice(2, 4), promotion: step[4] });
    } catch {
      return null;
    }
    if (board.shield) board.shield = move.from === board.shield ? move.to : board.chess.get(board.shield as never)?.color === move.color ? board.shield : null;
    return { move, card: null, squares: [move.from, move.to] };
  }
  const card = cardStep(step);
  if (!card) return null;
  const side = board.chess.turn();
  if (board.chess.isCheck()) return null;
  if (CARDS[card.card].kind === "time") return { move: null, card, squares: [] };
  if (card.card === "shield") {
    const piece = board.chess.get(card.picks[0] as never);
    if (!piece || piece.color !== side || piece.type === "k") return null;
    board.shield = card.picks[0];
    return { move: null, card, squares: [card.picks[0]] };
  }
  const applied = applyBoardCard(card.card, board.chess.fen(), side, card.picks);
  if (!applied) return null;
  board.chess = new Chess(applied.fen);
  return { move: null, card, squares: applied.squares };
}

export function puzzleProblem(fen: string, steps: string[]): string | null {
  let board: PuzzleBoard;
  try {
    board = { chess: new Chess(fen), shield: null };
  } catch {
    return "the position can't be read";
  }
  if (steps.length < 3) return "too short";
  if (!isMoveStep(steps[0]) || !cardStep(steps[1]) || !steps.slice(2).every(isMoveStep)) return "wrong shape";
  if (steps.length % 2 === 0) return "must end with the solver's move";
  for (const [i, step] of steps.entries()) {
    const shielded = board.shield;
    const result = playStep(board, step);
    if (!result) return `step ${i + 1} (${step}) isn't possible`;
    const m = result.move;
    if (m && shielded && m.captured) {
      const taken = m.flags.includes("e") ? m.to[0] + m.from[1] : m.to;
      if (taken === shielded) return `step ${i + 1} (${step}) takes the shielded piece`;
    }
  }
  return null;
}
