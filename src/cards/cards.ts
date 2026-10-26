export type CardId =
  | "thief"
  | "overclock"
  | "hourglass"
  | "pause"
  | "shield"
  | "leap"
  | "swap"
  | "retreat";

export type CardDef = {
  id: CardId;
  name: string;
  kind: "time" | "board";
  cost: number;
  targets: 0 | 1 | 2;
  text: string;
};

export const CARDS: Record<CardId, CardDef> = {
  thief: {
    id: "thief",
    name: "Time Thief",
    kind: "time",
    cost: 3,
    targets: 0,
    text: "Take time from your opponent's clock and add it to yours.",
  },
  overclock: {
    id: "overclock",
    name: "Overclock",
    kind: "time",
    cost: 2,
    targets: 0,
    text: "Add time to your clock.",
  },
  hourglass: {
    id: "hourglass",
    name: "Hourglass",
    kind: "time",
    cost: 4,
    targets: 0,
    text: "Your opponent's clock runs twice as fast on their next move.",
  },
  pause: {
    id: "pause",
    name: "Pause",
    kind: "time",
    cost: 3,
    targets: 0,
    text: "Your clock stops while you think this turn.",
  },
  shield: {
    id: "shield",
    name: "Shield",
    kind: "board",
    cost: 3,
    targets: 1,
    text: "One of your pieces can't be captured on the next move.",
  },
  leap: {
    id: "leap",
    name: "Leap",
    kind: "board",
    cost: 2,
    targets: 1,
    text: "Push one of your pawns one square forward, then make your move.",
  },
  swap: {
    id: "swap",
    name: "Swap",
    kind: "board",
    cost: 4,
    targets: 2,
    text: "One of your knights and one of your bishops trade squares.",
  },
  retreat: {
    id: "retreat",
    name: "Retreat",
    kind: "board",
    cost: 3,
    targets: 1,
    text: "Send a rook, knight or bishop back to its starting square.",
  },
};

export const CARD_IDS = Object.keys(CARDS) as CardId[];

export const HAND_SIZE = 4;
export const MAX_CHARGE = 6;
export const UNLOCK_PLY = 10;

export const AMOUNTS = {
  Blitz: { steal: 10, bonus: 15, cap: 15 },
  Rapid: { steal: 30, bonus: 45, cap: 45 },
  Classical: { steal: 60, bonus: 90, cap: 90 },
} as const;

export type CardCategory = keyof typeof AMOUNTS;

export function dealHand(): CardId[] {
  const pool = [...CARD_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, HAND_SIZE);
}