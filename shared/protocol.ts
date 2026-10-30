import type { CardId, CardsState, ClockMods } from "./cards.js";

export type Side = "w" | "b";

export type TimelineEvent = { t: "move"; san: string } | { t: "card"; fen: string };

export type Control = {
  initial: number;
  increment: number;
  blackInitial?: number;
};

export type RoomStatus = "waiting" | "playing" | "over";

export type GameState = {
  room: string;
  status: RoomStatus;
  control: Control;
  moves: string[];
  fen: string;
  turn: Side;
  clock: { w: number; b: number };
  running: boolean;
  online: { w: boolean; b: boolean };
  players: { w: string | null; b: string | null };
  admins: { w: boolean; b: boolean };
  result: string | null;
  drawOffer: Side | null;
  drawBlockedUntil: { w: number; b: number };
  deadline: { kind: "abort" | "idle"; side: Side; in: number } | null;
  cards: CardsState | null;
  timeline: TimelineEvent[];
  mods: { w: ClockMods; b: ClockMods };
  lag: { w: number | null; b: number | null };
};

export type ClientMsg =
  | { t: "create"; control: Control; side: Side | "random"; cards?: boolean; pow?: string }
  | { t: "join"; room: string; token?: string; reclaim?: boolean; invite?: string; pow?: string }
  | { t: "move"; from: string; to: string; promotion?: string; ply: number }
  | { t: "card"; card: CardId; picks: string[]; ply: number }
  | { t: "resign" }
  | { t: "ping"; n: number }
  | { t: "draw"; action: "offer" | "accept" | "decline" };

export type ServerMsg =
  | { t: "challenge"; id: string; bits: number }
  | {
      t: "seat";
      side: Side;
      token: string;
      state: GameState;
      invite?: { key: string; expiresIn: number };
    }
  | { t: "state"; state: GameState; last?: { from: string; to: string; san: string } }
  | { t: "error"; code: ErrorCode; message: string; state?: GameState }
  | { t: "pong"; n: number };

export type ErrorCode =
  | "bad_message"
  | "no_room"
  | "room_full"
  | "not_in_room"
  | "not_your_turn"
  | "illegal_move"
  | "out_of_sync"
  | "game_over"
  | "replaced"
  | "invite_expired"
  | "invite_used"
  | "bad_invite"
  | "rate_limited"
  | "bad_pow"
  | "server_busy"
  | "card_refused";

export const FIRST_MOVE_MS = 30 * 1000;
export const IDLE_QUIET_MS = 2 * 60 * 1000;
export const IDLE_WARNING_MS = 30 * 1000;
export const IDLE_WINDOW_MS = 3 * 60 * 1000;

export function formatWait(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const LAG_COMP_MAX_MS = 500;
export const LAG_BUDGET = { start: 2000, perMove: 250, max: 5000 };

export const INVITE_TTL_MS = 10 * 60 * 1000;

export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_LENGTH = 6;

export const DEFAULT_PORT = 8787;

export const CLOSE_UNAUTHORIZED = 4001;

export const CLOSE_BANNED = 4003;