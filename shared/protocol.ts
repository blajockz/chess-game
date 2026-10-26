export type Side = "w" | "b";

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
  result: string | null;
  drawOffer: Side | null;
  drawBlockedUntil: { w: number; b: number };
  deadline: { kind: "abort" | "idle"; side: Side; in: number } | null;
};

export type ClientMsg =
  | { t: "create"; control: Control; side: Side | "random"; pow?: string }
  | { t: "join"; room: string; token?: string; reclaim?: boolean; invite?: string; pow?: string }
  | { t: "move"; from: string; to: string; promotion?: string; ply: number }
  | { t: "resign" }
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
  | { t: "error"; code: ErrorCode; message: string; state?: GameState };

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
  | "server_busy";

export const FIRST_MOVE_MS = 30 * 1000;
export const IDLE_MS = 30 * 1000;
export const IDLE_GRACE_MS = 60 * 1000;

export const INVITE_TTL_MS = 10 * 60 * 1000;

export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_LENGTH = 6;

export const DEFAULT_PORT = 8787;