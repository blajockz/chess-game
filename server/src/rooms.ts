import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Chess } from "chess.js";
import {
  FIRST_MOVE_MS,
  IDLE_QUIET_MS,
  IDLE_WARNING_MS,
  IDLE_WINDOW_MS,
  formatWait,
  INVITE_TTL_MS,
  LAG_BUDGET,
  LAG_COMP_MAX_MS,
  ROOM_ALPHABET,
  ROOM_LENGTH,
  type Control,
  type ErrorCode,
  type GameState,
  type RoomStatus,
  type Side,
  type TimelineEvent,
} from "../../shared/protocol.js";
import {
  CARDS,
  CLOCK_FLOOR_MS,
  MAX_CHARGE,
  NO_MODS,
  UNLOCK_PLY,
  amountsFor,
  applyBoardCard,
  capturedSquare,
  categoryOf,
  clockCost,
  dealHand,
  liveShield,
  newCardsState,
  targetsFor,
  type CardId,
  type CardsState,
  type ClockMods,
} from "../../shared/cards.js";
import { LIMITS } from "./limits.js";

export type Peer = { send: (data: string) => void };

export type SeatUser = { id: string; name: string; admin?: boolean } | null;
type Seat = { token: string; peer: Peer | null; user: SeatUser };

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
  moves: string[];
  cards: CardsState | null;
  timeline: TimelineEvent[];
  mods: { w: ClockMods; b: ClockMods };
  lag: { w: number | null; b: number | null };
  lagBudget: { w: number; b: number };
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
    private timing = {
      firstMove: FIRST_MOVE_MS,
      quiet: IDLE_QUIET_MS,
      warning: IDLE_WARNING_MS,
      window: IDLE_WINDOW_MS,
    }
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

  create(control: Control, side: Side | "random", peer: Peer, owner = "local", withCards = false, user: SeatUser = null) {
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
      moves: [],
      cards: withCards && categoryOf(clean) !== "Bullet" ? newCardsState(testHand() ?? dealHand(randomInt)) : null,
      timeline: [],
      mods: { w: { ...NO_MODS }, b: { ...NO_MODS } },
      lag: { w: null, b: null },
      lagBudget: { w: LAG_BUDGET.start, b: LAG_BUDGET.start },
    };
    const token = randomBytes(12).toString("hex");
    room.seats[mine] = { token, peer, user };
    this.rooms.set(room.id, room);
    return { room, side: mine, token };
  }

  join(id: string, token: string | undefined, peer: Peer, reclaim = false, inviteKey?: string, user: SeatUser = null) {
    const room = this.get(id);
    if (!room) throw new GameError("no_room", "This game link doesn't exist or has expired.");
    const free = (["w", "b"] as Side[]).find((s) => !room.seats[s]);

    for (const side of ["w", "b"] as Side[]) {
      const seat = room.seats[side];
      if (!seat) continue;
      if (seat.user && user) {
        if (seat.user.id !== user.id) continue;
        const replaced = seat.peer && seat.peer !== peer ? seat.peer : undefined;
        seat.peer = peer;
        seat.user = user;
        room.emptySince = null;
        return { room, side, token: seat.token, replaced };
      }
      if (!token || !sameSecret(seat.token, token)) continue;
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
    room.seats[free] = { token: newToken, peer, user };
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

  private running(room: Room) {
    if (room.status !== "playing" || room.turnStartedAt === null) return null;
    const turn = room.chess.turn();
    const cost = clockCost(room.mods[turn], room.clock[turn], this.now() - room.turnStartedAt);
    return { turn, cost };
  }

  liveClock(room: Room) {
    const c = { ...room.clock };
    const r = this.running(room);
    if (r) c[r.turn] = Math.max(0, c[r.turn] - r.cost.total);
    return c;
  }

  private liveMods(room: Room) {
    const m = { w: { ...room.mods.w }, b: { ...room.mods.b } };
    const r = this.running(room);
    if (r) {
      m[r.turn].free -= r.cost.freeUsed;
      m[r.turn].extra -= r.cost.extra;
    }
    return m;
  }

  private settle(room: Room) {
    const r = this.running(room);
    if (!r) return;
    room.clock[r.turn] = Math.max(0, room.clock[r.turn] - r.cost.total);
    room.mods[r.turn].free -= r.cost.freeUsed;
    room.mods[r.turn].extra -= r.cost.extra;
    room.turnStartedAt = this.now();
  }

  flagIn(room: Room) {
    const r = this.running(room);
    if (!r) return null;
    const left = this.liveClock(room)[r.turn];
    const m = this.liveMods(room)[r.turn];
    return Math.max(0, m.free) + left / Math.max(1, m.rate);
  }

  ply(room: Room) {
    return room.moves.length;
  }

  move(
    room: Room,
    side: Side,
    from: string,
    to: string,
    promotion: string | undefined,
    ply: number,
    travelMs = 0
  ) {
    if (room.status === "over") throw new GameError("game_over", "The game is over.");
    if (room.status !== "playing") throw new GameError("not_your_turn", "Waiting for your opponent.");
    if (room.chess.turn() !== side) throw new GameError("not_your_turn", "It's not your turn.");
    if (ply !== this.ply(room)) {
      throw new GameError("out_of_sync", "Your board was out of date.");
    }

    const shield = liveShield(room.cards, room.chess.fen(), side, ply);
    if (shield) {
      const legal = room.chess.moves({ verbose: true });
      const hits = (m: (typeof legal)[number]) => !!m.captured && capturedSquare(m) === shield.square;
      const wanted = legal.find((m) => m.from === from && m.to === to);
      if (wanted && hits(wanted) && legal.some((m) => !hits(m))) {
        throw new GameError("illegal_move", "That piece is shielded this move.");
      }
    }

    const now = this.now();
    if (room.turnStartedAt !== null) {
      this.settle(room);
      const credit = Math.max(0, Math.min(travelMs, LAG_COMP_MAX_MS, room.lagBudget[side]));
      room.clock[side] += credit;
      room.lagBudget[side] = Math.min(LAG_BUDGET.max, room.lagBudget[side] - credit + LAG_BUDGET.perMove);
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

    room.moves.push(played.san);
    room.clock[side] += room.control.increment * 1000;
    room.mods[side] = { ...NO_MODS };

    if (room.cards) {
      const cards = room.cards;
      room.timeline.push({ t: "move", san: played.san });
      cards.charge[side] = Math.min(MAX_CHARGE, cards.charge[side] + 1);
      if (cards.shield && cards.shield.owner === side && cards.shield.square === played.from) {
        cards.shield = { ...cards.shield, square: played.to };
      }
      if (cards.shield && this.ply(room) >= cards.shield.untilPly) cards.shield = null;
    }

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
    if (this.ply(room) < room.drawBlockedUntil[side]) {
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
    const ply = this.ply(room);
    room.drawBlockedUntil[offerer] = ply + (room.chess.turn() === offerer ? 1 : 2);
    room.drawOffer = null;
  }

  deadline(room: Room): { kind: "abort" | "idle"; side: Side; at: number } | null {
    if (room.status !== "playing" || room.turnSince === null || room.startedAt === null) return null;
    const side = room.chess.turn();
    const ply = this.ply(room);
    if (ply < 2) return { kind: "abort", side, at: room.turnSince + this.timing.firstMove };
    if (room.turnSince - room.startedAt >= this.timing.window) return null;
    return { kind: "idle", side, at: room.turnSince + this.timing.quiet + this.timing.warning };
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
    else this.finish(room, `${NAME[other(d.side)]} wins: ${who} didn't move for ${formatWait(this.timing.quiet + this.timing.warning)}`);
    return true;
  }

  playCard(room: Room, side: Side, card: CardId, picks: string[], ply: number) {
    const cards = room.cards;
    const refuse = (why: string): never => {
      throw new GameError("card_refused", why);
    };
    if (!cards) refuse("This game is played without cards.");
    const c = cards!;
    if (room.status !== "playing" || room.turnStartedAt === null) refuse("Not now.");
    if (ply !== this.ply(room)) throw new GameError("out_of_sync", "Your board was out of date.");
    if (!c.hand.includes(card)) refuse("That card isn't in this game.");
    if (c.used[side].includes(card)) refuse("Already used.");
    if (this.ply(room) < UNLOCK_PLY) refuse("Cards aren't unlocked yet.");
    if (room.chess.turn() !== side) refuse("Wait for your turn.");
    if (c.lastPlayed[side] === ply) refuse("One card per turn.");
    if (room.chess.isCheck()) refuse("Not while in check.");
    if (room.drawOffer === side) refuse("Not while your draw offer is open.");
    const def = CARDS[card];
    if (c.charge[side] < def.cost) refuse(`Needs ${def.cost} Charge.`);
    if (picks.length !== def.targets) refuse("Pick the right squares for this card.");
    const fen = room.chess.fen();
    for (let i = 0; i < picks.length; i++) {
      if (!targetsFor(card, fen, side, picks.slice(0, i)).includes(picks[i])) refuse("That square isn't allowed.");
    }

    this.settle(room);
    const foe = other(side);
    const a = amountsFor(categoryOf(room.control));
    let squares: string[] = [];
    let message = `${NAME[side]} played ${def.name}`;

    if (card === "thief") {
      if (room.clock[foe] <= CLOCK_FLOOR_MS) refuse("Their clock is already under 10 s.");
      const take = Math.min(a.steal * 1000, Math.max(0, room.clock[foe] - CLOCK_FLOOR_MS));
      room.clock[foe] -= take;
      room.clock[side] += take;
      message += `: took ${Math.round(take / 1000)} s`;
    } else if (card === "overclock") {
      room.clock[side] += a.bonus * 1000;
      message += `: +${a.bonus} s`;
    } else if (card === "hourglass") {
      room.mods[foe] = { ...room.mods[foe], rate: 2, extra: a.cap * 1000 };
      message += `: ${NAME[foe]}'s clock runs ×2`;
    } else if (card === "pause") {
      room.mods[side] = { ...room.mods[side], free: a.cap * 1000 };
      message += `: clock stopped for up to ${a.cap} s`;
    } else if (card === "shield") {
      c.shield = { square: picks[0], owner: side, untilPly: ply + 2 };
      squares = [picks[0]];
    } else {
      const result = applyBoardCard(card, fen, side, picks);
      if (!result) refuse("That isn't allowed.");
      room.chess = new Chess(result!.fen);
      room.timeline.push({ t: "card", fen: result!.fen });
      squares = result!.squares;
    }

    c.charge[side] -= def.cost;
    c.used[side] = [...c.used[side], card];
    c.lastPlayed[side] = ply;
    c.log = [...c.log, { ply, side, card, squares, message }];
    return { card, side, squares, message };
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
      moves: [...room.moves],
      fen: room.chess.fen(),
      turn: room.chess.turn(),
      clock: this.liveClock(room),
      running: room.status === "playing" && room.turnStartedAt !== null,
      online: { w: !!room.seats.w?.peer, b: !!room.seats.b?.peer },
      players: { w: room.seats.w?.user?.name ?? null, b: room.seats.b?.user?.name ?? null },
      admins: { w: room.seats.w?.user?.admin === true, b: room.seats.b?.user?.admin === true },
      result: room.result,
      drawOffer: room.drawOffer,
      drawBlockedUntil: { ...room.drawBlockedUntil },
      deadline: this.deadlineState(room),
      cards: room.cards ? structuredClone(room.cards) : null,
      timeline: room.cards ? [...room.timeline] : [],
      mods: this.liveMods(room),
      lag: { ...room.lag },
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

function testHand(): CardId[] | null {
  const list = (process.env.CARDS_HAND ?? "").split(",").filter((c) => c in CARDS) as CardId[];
  return list.length ? list : null;
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