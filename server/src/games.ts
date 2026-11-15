import type { IncomingMessage, ServerResponse } from "node:http";
import { Chess, validateFen } from "chess.js";
import { AUTH_DISABLED, bearer, verifyToken } from "./auth.js";
import { LOGS_ON, banEnd, profileOf, rest } from "./logs.js";
import { isGuestToken } from "./guests.js";
import { RateLimiter } from "./limits.js";
import { securityHeaders, clientIp } from "./security.js";
import type { Room } from "./rooms.js";
import type { Side, TimelineEvent } from "../../shared/protocol.js";
import { categoryOf, type CardId, type PlayedCard } from "../../shared/cards.js";
import { PositionCounts, replayCardGame } from "../../shared/cardGame.js";
import { rateBotGame, rateOnlineGame, type Change } from "./ratings.js";

type Reply = ServerResponse;

const PAGE = 20;
const MAX_STEPS = 1200;
const MAX_BODY = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUMMARY_COLUMNS = "id,kind,white_id,black_id,white_name,black_name,bot_elo,control,cards,result,winner,plies,ended_at,rated,rating_change";

type Control = { initial: number; increment: number; blackInitial?: number };

type StoredCard = Omit<PlayedCard, "message">;

type Row = {
  id: string;
  kind: "bot" | "online";
  white_id: string | null;
  black_id: string | null;
  white_name: string;
  black_name: string;
  bot_elo: number | null;
  control: Control;
  cards: boolean;
  steps?: TimelineEvent[];
  hand?: CardId[] | null;
  card_log?: StoredCard[] | null;
  clocks?: number[] | null;
  result: string;
  winner: Side | "draw";
  plies: number;
  ended_at: string;
  rated?: boolean;
  rating_change?: { w?: Change; b?: Change } | null;
};

export class GamesError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const memory: Row[] = [];

const saves = new RateLimiter(20, 20 / 3600);
const reads = new RateLimiter(60, 1);

export function winnerOf(result: string): Side | "draw" | null {
  if (/^White wins/.test(result)) return "w";
  if (/^Black wins/.test(result)) return "b";
  if (/^Draw/.test(result)) return "draw";
  return null;
}

export function checkSteps(steps: unknown): { steps: TimelineEvent[]; plies: number; chess: Chess; threefold: boolean } {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) {
    throw new GamesError(400, "bad_game", "This game can't be saved.");
  }
  let chess = new Chess();
  const positionCounts = new PositionCounts(chess.fen());
  let plies = 0;
  const clean: TimelineEvent[] = [];
  for (const step of steps as Record<string, unknown>[]) {
    if (step?.t === "move" && typeof step.san === "string" && step.san.length <= 10) {
      try {
        chess.move(step.san);
        positionCounts.record(chess.fen());
      } catch {
        throw new GamesError(400, "bad_game", "This game has an impossible move.");
      }
      clean.push({ t: "move", san: step.san });
      plies++;
    } else if (step?.t === "card" && typeof step.fen === "string" && step.fen.length <= 100 && validateFen(step.fen).ok) {
      chess = new Chess(step.fen);
      clean.push({ t: "card", fen: step.fen });
    } else {
      throw new GamesError(400, "bad_game", "This game can't be saved.");
    }
  }
  return { steps: clean, plies, chess, threefold: positionCounts.isThreefold(chess.fen()) };
}

function cleanControl(c: unknown): Control {
  const o = (c ?? {}) as Record<string, unknown>;
  const secs = (v: unknown) => Math.min(3600, Math.max(30, Math.round(Number(v) || 300)));
  const out: Control = { initial: secs(o.initial), increment: Math.min(60, Math.max(0, Math.round(Number(o.increment) || 0))) };
  if (o.blackInitial !== undefined) out.blackInitial = secs(o.blackInitial);
  return out;
}

function cleanClocks(clocks: unknown, plies: number): number[] | null {
  if (!Array.isArray(clocks) || clocks.length !== plies) return null;
  const ok = clocks.every((c) => Number.isFinite(c) && c >= 0 && c <= 6 * 3600_000);
  return ok ? clocks.map((c) => Math.round(c as number)) : null;
}

async function insert(row: Omit<Row, "id" | "ended_at"> & { started_at?: string | null }) {
  if (!LOGS_ON) {
    const saved: Row = { ...row, id: crypto.randomUUID(), ended_at: new Date().toISOString() };
    memory.unshift(saved);
    if (memory.length > 2000) memory.pop();
    return saved.id;
  }
  const res = await rest("POST", "games", row, "return=representation");
  const [saved] = (await res.json()) as { id: string }[];
  return saved.id;
}

export async function saveOnlineGame(room: Room, rated = false) {
  const result = room.result ?? "";
  const winner = winnerOf(result);
  const w = room.seats.w?.user ?? null;
  const b = room.seats.b?.user ?? null;
  const owner = (u: typeof w) => (u && !u.guest ? u.id : null);
  if (!winner || room.moves.length < 2 || (!owner(w) && !owner(b))) return null;
  const steps: TimelineEvent[] = room.cards ? [...room.timeline] : room.moves.map((san) => ({ t: "move", san }));
  let change: { w: Change; b: Change } | null = null;
  if (rated && owner(w) && owner(b)) {
    try {
      change = await rateOnlineGame(owner(w)!, owner(b)!, room.cards ? "cards" : "chess", winner);
    } catch (err) {
      console.warn("Couldn't rate the game:", (err as Error).message);
    }
  }
  try {
    await insert({
      rated: change !== null,
      rating_change: change,
      kind: "online",
      white_id: owner(w),
      black_id: owner(b),
      white_name: w?.name ?? "White",
      black_name: b?.name ?? "Black",
      bot_elo: null,
      control: room.control,
      cards: room.cards !== null,
      steps,
      hand: room.cards ? [...room.cards.hand] : null,
      card_log: room.cards ? room.cards.log.map(({ message: _m, ...c }) => c) : null,
      clocks: [...room.clockTrail],
      result,
      winner,
      plies: room.moves.length,
      started_at: room.startedAt ? new Date(room.startedAt).toISOString() : null,
    });
  } catch (err) {
    console.warn("Couldn't save the game:", (err as Error).message);
  }
  return change;
}

type Me = { id: string; name: string };

async function who(req: IncomingMessage): Promise<Me> {
  const token = bearer(req);
  if (isGuestToken(token)) {
    throw new GamesError(403, "guest", "Guests keep their games on their own device. Sign in to keep them everywhere.");
  }
  if (!token && AUTH_DISABLED) return { id: "anon:" + clientIp(req), name: "You" };
  const player = await verifyToken(token);
  if (!player) throw new GamesError(401, "unauthorized", "Sign in again.");
  const profile = await profileOf(player.id, 5000);
  if (banEnd(profile)) throw new GamesError(403, "banned", "This account is suspended.");
  return { id: player.id, name: profile.name ?? player.name };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new GamesError(413, "too_large", "This game is too long to save.");
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
  }
  throw new GamesError(400, "bad_request", "Couldn't read the request.");
}

async function saveBotGame(me: Me, body: Record<string, unknown>) {
  if (body.kind !== "bot") throw new GamesError(400, "bad_game", "Only games against the bot are sent from the browser.");
  const you = body.you === "w" || body.you === "b" ? body.you : null;
  if (!you) throw new GamesError(400, "bad_game", "This game can't be saved.");
  const result = typeof body.result === "string" ? body.result.slice(0, 120) : "";
  const winner = winnerOf(result);
  if (!winner) throw new GamesError(400, "bad_game", "Only finished games are saved.");
  const { steps, plies, chess, threefold } = checkSteps(body.steps);
  if (plies < 2) throw new GamesError(400, "bad_game", "Games that end before both players moved are not saved.");
  const mated = chess.isCheckmate();
  const mateWinner: Side | null = mated ? (chess.turn() === "w" ? "b" : "w") : null;
  if (
    (mated && winner !== mateWinner) ||
    (/checkmate/i.test(result) && !mated) ||
    (/stalemate/i.test(result) && !chess.isStalemate())
  ) {
    throw new GamesError(400, "bad_game", "This result doesn't match the board.");
  }
  if (winner === you && /resignation/i.test(result)) {
    throw new GamesError(400, "bad_game", "A bot win by resignation can't be verified.");
  }
  const control = cleanControl(body.control);
  const cards = body.cards === true;
  let hand: CardId[] | null = null;
  let cardLog: StoredCard[] | null = null;
  if (cards) {
    if (categoryOf(control) === "Bullet") throw new GamesError(400, "bad_game", "Bullet games have no cards.");
    const wrong = replayCardGame(control, body.hand, body.cardLog, steps);
    if (wrong) throw new GamesError(400, "bad_game", `This card game doesn't follow the rules: ${wrong}`);
    hand = body.hand as CardId[];
    cardLog = (body.cardLog as StoredCard[]).map((c) => ({
      ply: c.ply,
      side: c.side,
      card: c.card,
      picks: c.picks,
      squares: Array.isArray(c.squares) ? c.squares.filter((q) => typeof q === "string" && /^[a-h][1-8]$/.test(q)).slice(0, 4) : [],
    }));
  } else if (steps.some((s) => s.t === "card")) {
    throw new GamesError(400, "bad_game", "This game can't be saved.");
  }
  const elo = Math.min(3000, Math.max(400, Math.round(Number(body.botElo) || 1200)));
  const bot = `Shatranj Bot · ${elo}`;
  let change: Change | null = null;
  if (body.rated === true) {
    const ruleDraw = chess.isStalemate() || chess.isInsufficientMaterial() || threefold || chess.isDrawByFiftyMoves();
    const score = winner === "draw" ? (ruleDraw ? 0.5 : null) : winner !== you ? 0 : mateWinner === you ? 1 : null;
    change = await rateBotGame(me.id, cards ? "cards" : "chess", body.ticket, elo, score);
  }
  const id = await insert({
    rated: change !== null,
    rating_change: change ? { [you]: change } : null,
    kind: "bot",
    white_id: you === "w" ? me.id : null,
    black_id: you === "b" ? me.id : null,
    white_name: you === "w" ? me.name : bot,
    black_name: you === "b" ? me.name : bot,
    bot_elo: elo,
    control,
    cards,
    steps,
    hand,
    card_log: cardLog,
    clocks: cleanClocks(body.clocks, plies),
    result,
    winner,
    plies,
  });
  return { id, rating: change };
}

function toRecord(row: Row, me: string) {
  return {
    id: row.id,
    kind: row.kind,
    white: row.white_name,
    black: row.black_name,
    you: row.white_id === me ? "w" : row.black_id === me ? "b" : null,
    result: row.result,
    winner: row.winner,
    control: row.control,
    cards: row.cards,
    endedAt: row.ended_at,
    botElo: row.bot_elo,
    plies: row.plies,
    rated: row.rated === true,
    ratingChange: row.rated ? (row.rating_change ?? null) : null,
    ...(row.steps ? { steps: row.steps } : {}),
    ...(row.hand ? { hand: row.hand } : {}),
    ...(row.card_log ? { cardLog: row.card_log } : {}),
    ...(row.clocks ? { clocks: row.clocks } : {}),
  };
}

async function list(me: Me, before: string | null) {
  let rows: Row[];
  if (!LOGS_ON) {
    rows = memory
      .filter((r) => (r.white_id === me.id || r.black_id === me.id) && (!before || r.ended_at < before))
      .slice(0, PAGE + 1);
  } else {
    const after = before ? `&ended_at=lt.${encodeURIComponent(before)}` : "";
    const query = (column: string) =>
      rest("GET", `games?select=${SUMMARY_COLUMNS}&${column}=eq.${me.id}${after}&order=ended_at.desc&limit=${PAGE + 1}`).then(
        (r) => r.json() as Promise<Row[]>
      );
    const [asWhite, asBlack] = await Promise.all([query("white_id"), query("black_id")]);
    const seen = new Set<string>();
    rows = [...asWhite, ...asBlack]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1))
      .slice(0, PAGE + 1);
  }
  return {
    games: rows.slice(0, PAGE).map((r) => {
      const { steps: _steps, hand: _hand, card_log: _log, clocks: _clocks, ...summary } = r;
      return toRecord(summary as Row, me.id);
    }),
    more: rows.length > PAGE,
  };
}

async function one(me: Me, id: string) {
  if (!UUID.test(id)) throw new GamesError(404, "not_found", "This game doesn't exist.");
  let row: Row | undefined;
  if (!LOGS_ON) row = memory.find((r) => r.id === id);
  else {
    const res = await rest("GET", `games?id=eq.${id}&select=${SUMMARY_COLUMNS},steps,hand,card_log,clocks`);
    row = ((await res.json()) as Row[])[0];
  }
  if (!row || (row.white_id !== me.id && row.black_id !== me.id)) {
    throw new GamesError(404, "not_found", "This game doesn't exist.");
  }
  return { game: toRecord(row, me.id) };
}

function send(req: IncomingMessage, res: Reply, status: number, body: unknown) {
  res.writeHead(status, { ...securityHeaders(req), "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export async function handleGames(req: IncomingMessage, res: Reply, path: string, onPlayer: (id: string) => void = () => {}) {
  try {
    const sub = path.slice("/api/games".length);
    const me = await who(req);
    if (!me.id.startsWith("anon:")) onPlayer(me.id);
    if (sub === "" || sub === "/") {
      if (req.method === "POST") {
        if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
          throw new GamesError(415, "bad_request", "Send JSON.");
        }
        if (!saves.take(me.id)) throw new GamesError(429, "slow_down", "Too many games saved. Try again later.");
        send(req, res, 201, await saveBotGame(me, await readBody(req)));
        return;
      }
      if (req.method !== "GET") throw new GamesError(405, "method_not_allowed", "Wrong method.");
      if (!reads.take(me.id)) throw new GamesError(429, "slow_down", "Slow down a little.");
      const url = new URL(req.url ?? "/", "http://x");
      const before = url.searchParams.get("before");
      const valid = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
      send(req, res, 200, await list(me, valid));
      return;
    }
    if (req.method !== "GET") throw new GamesError(405, "method_not_allowed", "Wrong method.");
    if (!reads.take(me.id)) throw new GamesError(429, "slow_down", "Slow down a little.");
    send(req, res, 200, await one(me, decodeURIComponent(sub.slice(1))));
  } catch (err) {
    if (err instanceof GamesError) send(req, res, err.status, { error: err.code, message: err.message });
    else {
      console.error("Games error:", err);
      if (!res.headersSent) send(req, res, 500, { error: "server_error", message: "Something went wrong. Try again." });
    }
  }
}

export function sweepGameLimits() {
  saves.sweep();
  reads.sweep();
}
