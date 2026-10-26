import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Chess } from "chess.js";
import {
  FIRST_MOVE_MS,
  IDLE_GRACE_MS,
  IDLE_MS,
  INVITE_TTL_MS,
  ROOM_ALPHABET,
  ROOM_LENGTH,
  type Control,
  type ErrorCode,
  type GameState,
  type RoomStatus,
  type Side,
} from "../../shared/protocol.js";
import { LIMITS } from "./limits.js";

export type Peer = { send: (data: string) => void };

type Seat = { token: string; peer: Peer | null };

export type Room = {
  id: string;
  control: Control;
  chess: Chess;
  seats: Partial<Record<Side, Seat>>;
  status: RoomStatus;
  result: string | null;
  clock: { w: number; b: number };
  turnStartedAt: number | null;
  flagTimer: NodeJS.Timeout | null;
  startedAt: number | null;
  turnSince: number | null;
  deadlineTimer: NodeJS.Timeout | null;
  emptySince: number | null;
  invite: { key: string; expiresAt: number } | null;
  drawOffer: Side | null;
  drawBlockedUntil: { w: number; b: number };
  owner: string;
};

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class GameError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

const other = (s: Side): Side => (s === "w" ? "b" : "w");
const NAME = { w: "White", b: "Black" };

const MAX_MINUTES = 60;
const MAX_INCREMENT = 30;

export class Rooms {
  private rooms = new Map<string, Room>();

  constructor(
    private now: () => number = () => Date.now(),
    private inviteTtl: number = INVITE_TTL_MS,
    private timing = { firstMove: FIRST_MOVE_MS, idle: IDLE_MS, grace: IDLE_GRACE_MS }
  ) {}

  get size() {
    return this.rooms.size;
  }

  get(id: string) {
    return this.rooms.get(id.toUpperCase());
  }

  private newId() {
    for (;;) {
      let id = "";
      for (let i = 0; i < ROOM_LENGTH; i++) id += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
      if (!this.rooms.has(id)) return id;
    }
  }

  create(control: Control, side: Side | "random", peer: Peer, owner = "local") {
    if (side !== "w" && side !== "b" && side !== "random") {
      throw new GameError("bad_message", "Pick White, Black or Random.");
    }
    if (this.rooms.size >= LIMITS.maxRooms) {
      throw new GameError("server_busy", "The server is full right now. Try again in a few minutes.");
    }
    let waiting = 0;
    for (const r of this.rooms.values()) {
      const open = r.seats.w?.peer || r.seats.b?.peer;
      if (r.owner === owner && r.status === "waiting" && open) waiting++;
    }
    if (waiting >= LIMITS.waitingPerIp) {
      throw new GameError("rate_limited", "You already have games waiting for a friend. Use one of those links.");
    }
    const clean = sanitize(control);
    const mine: Side = side === "random" ? (randomInt(2) ? "w" : "b") : side;
    const room: Room = {
      id: this.newId(),
      control: clean,
      chess: new Chess(),
      seats: {},
      status: "waiting",
      result: null,
      clock: { w: clean.initial * 1000, b: (clean.blackInitial ?? clean.initial) * 1000 },
      turnStartedAt: null,
      flagTimer: null,
      startedAt: null,
      turnSince: null,
      deadlineTimer: null,
      emptySince: null,
      invite: { key: randomBytes(16).toString("hex"), expiresAt: this.now() + this.inviteTtl },
      drawOffer: null,
      drawBlockedUntil: { w: 0, b: 0 },
      owner,
    };
    const token = randomBytes(12).toString("hex");
    room.seats[mine] = { token, peer };
    this.rooms.set(room.id, room);
    return { room, side: mine, token };
  }

  join(id: string, token: string | undefined, peer: Peer, reclaim = false, inviteKey?: string) {
    const room = this.get(id);
    if (!room) throw new GameError("no_room", "This game link doesn't exist or has expired.");
    const free = (["w", "b"] as Side[]).find((s) => !room.seats[s]);

    for (const side of ["w", "b"] as Side[]) {
      const seat = room.seats[side];
      if (!seat || !token || !sameSecret(seat.token, token)) continue;
      if (seat.peer && !reclaim && free) break;
      const replaced = seat.peer && seat.peer !== peer ? seat.peer : undefined;
      seat.peer = peer;
      room.emptySince = null;
      return { room, side, token, replaced };
    }

    if (!free || !room.invite) {
      throw new GameError("invite_used", "This invite link has already been used.");
    }
    if (this.now() > room.invite.expiresAt) {
      throw new GameError("invite_expired", "This invite link has expired. Ask for a new one.");
    }
    if (!inviteKey || !sameSecret(inviteKey, room.invite.key)) {
      throw new GameError("bad_invite", "This invite link isn't valid.");
    }
    room.invite = null;

    const newToken = randomBytes(12).toString("hex");
    room.seats[free] = { token: newToken, peer };
    room.emptySince = null;
    if (room.status === "waiting" && room.seats.w && room.seats.b) {
      room.status = "playing";
      room.startedAt = this.now();
      room.turnSince = room.startedAt;
    }
    return { room, side: free, token: newToken, replaced: undefined as Peer | undefined };
  }

  leave(room: Room, peer: Peer) {
    for (const side of ["w", "b"] as Side[]) {
      const seat = room.seats[side];
      if (seat?.peer === peer) seat.peer = null;
    }
    if (!room.seats.w?.peer && !room.seats.b?.peer) room.emptySince = this.now();
  }

  liveClock(room: Room) {
    const c = { ...room.clock };
    if (room.status === "playing" && room.turnStartedAt !== null) {
      const turn = room.chess.turn();
      c[turn] = Math.max(0, c[turn] - (this.now() - room.turnStartedAt));
    }
    return c;
  }

  move(room: Room, side: Side, from: string, to: string, promotion: string | undefined, ply: number) {
    if (room.status === "over") throw new GameError("game_over", "The game is over.");
    if (room.status !== "playing") throw new GameError("not_your_turn", "Waiting for your opponent.");
    if (room.chess.turn() !== side) throw new GameError("not_your_turn", "It's not your turn.");
    if (ply !== room.chess.history().length) {
      throw new GameError("out_of_sync", "Your board was out of date.");
    }

    const now = this.now();
    if (room.turnStartedAt !== null) {
      room.clock[side] -= now - room.turnStartedAt;
      if (room.clock[side] <= 0) {
        room.clock[side] = 0;
        this.finish(room, `${NAME[other(side)]} wins on time`);
        return null;
      }
    }

    let played;
    try {
      played = room.chess.move({ from, to, promotion: promotion ?? "q" });
    } catch {
      played = null;
    }
    if (!played) throw new GameError("illegal_move", "That move isn't legal.");

    room.clock[side] += room.control.increment * 1000;

    if (room.drawOffer && room.drawOffer !== side) this.declineDraw(room);
    room.turnStartedAt = now;
    room.turnSince = now;

    const c = room.chess;
    if (c.isCheckmate()) this.finish(room, `${NAME[side]} wins by checkmate`);
    else if (c.isStalemate()) this.finish(room, "Draw by stalemate");
    else if (c.isThreefoldRepetition()) this.finish(room, "Draw by repetition");
    else if (c.isInsufficientMaterial()) this.finish(room, "Draw by insufficient material");
    else if (c.isDraw()) this.finish(room, "Draw");

    return { from: played.from, to: played.to, san: played.san };
  }

  offerDraw(room: Room, side: Side) {
    if (room.status !== "playing") throw new GameError("game_over", "The game isn't running.");
    if (room.drawOffer) throw new GameError("bad_message", "A draw offer is already open.");
    if (room.chess.history().length < room.drawBlockedUntil[side]) {
      throw new GameError("bad_message", "Make a move before offering another draw.");
    }
    room.drawOffer = side;
  }

  answerDraw(room: Room, side: Side, accept: boolean) {
    if (room.status !== "playing") throw new GameError("game_over", "The game isn't running.");
    if (room.drawOffer !== other(side)) throw new GameError("bad_message", "There's no draw offer to answer.");
    if (accept) this.finish(room, "Draw by agreement");
    else this.declineDraw(room);
  }

  private declineDraw(room: Room) {
    const offerer = room.drawOffer;
    if (!offerer) return;
    const ply = room.chess.history().length;
    room.drawBlockedUntil[offerer] = ply + (room.chess.turn() === offerer ? 1 : 2);
    room.drawOffer = null;
  }

  deadline(room: Room): { kind: "abort" | "idle"; side: Side; at: number } | null {
    if (room.status !== "playing" || room.turnSince === null || room.startedAt === null) return null;
    const side = room.chess.turn();
    const ply = room.chess.history().length;
    if (ply < 2) return { kind: "abort", side, at: room.turnSince + this.timing.firstMove };
    const at = Math.max(room.turnSince + this.timing.idle, room.startedAt + this.timing.grace);
    return { kind: "idle", side, at };
  }

  private deadlineState(room: Room) {
    const d = this.deadline(room);
    return d ? { kind: d.kind, side: d.side, in: Math.max(0, d.at - this.now()) } : null;
  }

  missDeadline(room: Room) {
    const d = this.deadline(room);
    if (!d || this.now() < d.at) return false;
    const who = NAME[d.side];
    if (d.kind === "abort") this.finish(room, `Game aborted: ${who} didn't make a first move`);
    else this.finish(room, `${NAME[other(d.side)]} wins: ${who} didn't move for ${this.timing.idle / 1000} s`);
    return true;
  }

  resign(room: Room, side: Side) {
    if (room.status === "over") throw new GameError("game_over", "The game is over.");
    this.finish(room, `${NAME[other(side)]} wins by resignation`);
  }

  finish(room: Room, result: string) {
    room.drawOffer = null;
    if (room.turnStartedAt !== null && room.status === "playing") {
      room.clock = this.liveClock(room);
    }
    room.status = "over";
    room.result = result;
    room.turnStartedAt = null;
    if (room.flagTimer) clearTimeout(room.flagTimer);
    if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
    room.deadlineTimer = null;
    room.flagTimer = null;
  }

  state(room: Room): GameState {
    return {
      room: room.id,
      status: room.status,
      control: room.control,
      moves: room.chess.history(),
      fen: room.chess.fen(),
      turn: room.chess.turn(),
      clock: this.liveClock(room),
      running: room.status === "playing" && room.turnStartedAt !== null,
      online: { w: !!room.seats.w?.peer, b: !!room.seats.b?.peer },
      result: room.result,
      drawOffer: room.drawOffer,
      drawBlockedUntil: { ...room.drawBlockedUntil },
      deadline: this.deadlineState(room),
    };
  }

  inviteFor(room: Room) {
    if (room.status !== "waiting" || !room.invite) return undefined;
    return { key: room.invite.key, expiresIn: Math.max(0, room.invite.expiresAt - this.now()) };
  }

  expireInvites() {
    const gone: Room[] = [];
    for (const [id, room] of this.rooms) {
      if (room.status === "waiting" && room.invite && this.now() > room.invite.expiresAt) {
        this.rooms.delete(id);
        gone.push(room);
      }
    }
    return gone;
  }

  sweep(maxIdleMs: number) {
    const now = this.now();
    for (const [id, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > maxIdleMs) {
        if (room.flagTimer) clearTimeout(room.flagTimer);
        if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
        this.rooms.delete(id);
      }
    }
  }
}

function sanitize(control: Control): Control {
  const minutes = (s: unknown) => {
    const n = Number(s);
    if (!Number.isFinite(n)) return 300;
    return Math.min(MAX_MINUTES * 60, Math.max(30, Math.round(n)));
  };
  const out: Control = {
    initial: minutes(control?.initial),
    increment: Math.min(MAX_INCREMENT, Math.max(0, Math.round(Number(control?.increment) || 0))),
  };
  if (control?.blackInitial !== undefined) out.blackInitial = minutes(control.blackInitial);
  return out;
}