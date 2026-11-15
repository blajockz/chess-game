import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AUTH_DISABLED, bearer, verifyToken } from "./auth.js";
import { LOGS_ON, banEnd, profileOf, rest } from "./logs.js";
import { isGuestToken } from "./guests.js";
import { RateLimiter } from "./limits.js";
import { clientIp, securityHeaders } from "./security.js";
import { glicko2 } from "./puzzles.js";

export type Mode = "chess" | "cards";
export type Level = "beginner" | "intermediate" | "advanced";

export const LEVELS: Record<Level, number> = { beginner: 800, intermediate: 1200, advanced: 1600 };
const START_RD = 350;
const START_VOL = 0.06;
const BOT_RD = 110;
const ABANDON_GRACE_MS = Number(process.env.RATED_GRACE_MS) || 90_000;
const ABANDON_MAX_MS = 4 * 60 * 60_000;

type Ticket = { id: string; bot: number; at: number };

type Row = {
  user_id: string;
  mode: Mode;
  level: Level;
  rating: number;
  rd: number;
  vol: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  open_ticket: Ticket | null;
  updated_at?: string;
};

export type Change = { before: number; after: number; delta: number };

export class RatingError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const memory = new Map<string, Row>();
const limiter = new RateLimiter(30, 0.5);

async function rows(userId: string): Promise<Row[]> {
  if (!LOGS_ON) return (["chess", "cards"] as Mode[]).map((m) => memory.get(`${userId}:${m}`)).filter((r): r is Row => !!r);
  const res = await rest("GET", `game_ratings?user_id=eq.${userId}&select=*`, undefined, "");
  return (await res.json()) as Row[];
}

async function save(row: Row) {
  row.updated_at = new Date().toISOString();
  if (!LOGS_ON) {
    memory.set(`${row.user_id}:${row.mode}`, { ...row });
    return;
  }
  await rest("POST", "game_ratings?on_conflict=user_id,mode", row, "resolution=merge-duplicates,return=minimal");
}

function shown(row: Row | undefined) {
  if (!row) return null;
  return {
    rating: Math.round(row.rating),
    provisional: row.rd > 110,
    played: row.played,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  };
}

function apply(row: Row, opponent: { rating: number; rd: number }, score: 0 | 0.5 | 1): Change {
  const before = Math.round(row.rating);
  const next = glicko2(row, opponent, score);
  row.rating = next.rating;
  row.rd = Math.max(60, next.rd);
  row.vol = next.vol;
  row.played += 1;
  if (score === 1) row.wins += 1;
  else if (score === 0) row.losses += 1;
  else row.draws += 1;
  const after = Math.round(row.rating);
  return { before, after, delta: after - before };
}

async function settle(row: Row, starting: boolean) {
  const t = row.open_ticket;
  if (!t) return false;
  const age = Date.now() - t.at;
  if (age < (starting ? ABANDON_GRACE_MS : ABANDON_MAX_MS)) {
    if (!starting) return false;
    row.open_ticket = null;
    return true;
  }
  apply(row, { rating: t.bot, rd: BOT_RD }, 0);
  row.open_ticket = null;
  return true;
}

export async function ratingsOf(userId: string) {
  const all = await rows(userId);
  for (const row of all) if (await settle(row, false)) await save(row);
  const by = (m: Mode) => all.find((r) => r.mode === m);
  return { level: all[0]?.level ?? null, chess: shown(by("chess")), cards: shown(by("cards")) };
}

export async function setLevel(userId: string, level: unknown) {
  if (level !== "beginner" && level !== "intermediate" && level !== "advanced") {
    throw new RatingError(400, "bad_level", "Choose beginner, intermediate or advanced.");
  }
  const all = await rows(userId);
  if (all.some((r) => r.played > 0)) throw new RatingError(409, "level_set", "Your rating already moved with your games: the level can't be changed now.");
  for (const mode of ["chess", "cards"] as Mode[]) {
    await save({ user_id: userId, mode, level, rating: LEVELS[level], rd: START_RD, vol: START_VOL, played: 0, wins: 0, losses: 0, draws: 0, open_ticket: null });
  }
  if (LOGS_ON) {
    try {
      const res = await rest("GET", `puzzle_ratings?user_id=eq.${userId}&select=played`, undefined, "");
      const mine = ((await res.json()) as { played: number }[])[0];
      if (!mine || mine.played < 10) {
        const fresh = mine ? {} : { played: 0, solved: 0, streak: 0, best_streak: 0 };
        await rest(
          "POST",
          "puzzle_ratings?on_conflict=user_id",
          { user_id: userId, rating: LEVELS[level], rd: START_RD, vol: START_VOL, ...fresh, updated_at: new Date().toISOString() },
          "resolution=merge-duplicates,return=minimal"
        );
      }
    } catch (err) {
      console.warn("Couldn't set the puzzle level:", (err as Error).message);
    }
  }
  return ratingsOf(userId);
}

async function startBotGame(userId: string, body: Record<string, unknown>) {
  const mode: Mode = body.cards === true ? "cards" : "chess";
  const bot = Math.min(3000, Math.max(400, Math.round(Number(body.botElo) || 0)));
  if (!Number(body.botElo)) throw new RatingError(400, "bad_request", "Which bot?");
  const row = (await rows(userId)).find((r) => r.mode === mode);
  if (!row) throw new RatingError(409, "no_level", "Choose your level first.");
  const before = Math.round(row.rating);
  const hadOpen = !!row.open_ticket && Date.now() - row.open_ticket.at >= ABANDON_GRACE_MS;
  await settle(row, true);
  row.open_ticket = { id: randomBytes(12).toString("base64url"), bot, at: Date.now() };
  await save(row);
  return {
    ticket: row.open_ticket.id,
    rating: shown(row),
    abandoned: hadOpen ? { before, after: Math.round(row.rating), delta: Math.round(row.rating) - before } : null,
  };
}

async function leaveBotGame(userId: string, ticket: unknown) {
  const all = await rows(userId);
  const row = all.find((r) => r.open_ticket && r.open_ticket.id === ticket);
  if (!row) return { left: null };
  const before = Math.round(row.rating);
  await settle(row, true);
  await save(row);
  const after = Math.round(row.rating);
  return { left: after === before ? null : { before, after, delta: after - before } };
}

export async function rateBotGame(userId: string, mode: Mode, ticket: unknown, bot: number, score: 0 | 0.5 | 1): Promise<Change | null> {
  if (typeof ticket !== "string" || !ticket) return null;
  const row = (await rows(userId)).find((r) => r.mode === mode);
  if (!row?.open_ticket || row.open_ticket.id !== ticket || row.open_ticket.bot !== bot) return null;
  row.open_ticket = null;
  const change = apply(row, { rating: bot, rd: BOT_RD }, score);
  await save(row);
  return change;
}

export async function rateOnlineGame(white: string, black: string, mode: Mode, winner: "w" | "b" | "draw"): Promise<{ w: Change; b: Change } | null> {
  const [w, b] = await Promise.all([rows(white), rows(black)]);
  const wr = w.find((r) => r.mode === mode);
  const br = b.find((r) => r.mode === mode);
  if (!wr || !br || white === black) return null;
  const wBefore = { rating: wr.rating, rd: wr.rd };
  const bBefore = { rating: br.rating, rd: br.rd };
  const change = {
    w: apply(wr, bBefore, winner === "w" ? 1 : winner === "b" ? 0 : 0.5),
    b: apply(br, wBefore, winner === "b" ? 1 : winner === "w" ? 0 : 0.5),
  };
  await Promise.all([save(wr), save(br)]);
  return change;
}

export async function ratingFor(userId: string, mode: Mode): Promise<number | null> {
  try {
    const row = (await rows(userId)).find((r) => r.mode === mode);
    return row ? Math.round(row.rating) : null;
  } catch {
    return null;
  }
}

async function who(req: IncomingMessage) {
  const token = bearer(req);
  if (isGuestToken(token)) throw new RatingError(403, "guest", "Guests play without a rating. Sign in to get one.");
  if (!token && AUTH_DISABLED) return "anon:" + clientIp(req);
  const player = await verifyToken(token);
  if (!player) throw new RatingError(401, "unauthorized", "Sign in again.");
  const profile = await profileOf(player.id, 5000);
  if (banEnd(profile)) throw new RatingError(403, "banned", "This account is suspended.");
  return player.id;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1024) throw new RatingError(413, "too_large", "Request too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
  }
  throw new RatingError(400, "bad_request", "Couldn't read the request.");
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...securityHeaders(req), "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export async function handleRating(req: IncomingMessage, res: ServerResponse, path: string, onPlayer: (id: string) => void = () => {}) {
  try {
    const me = await who(req);
    if (!me.startsWith("anon:")) onPlayer(me);
    if (!limiter.take(me)) throw new RatingError(429, "slow_down", "Slow down a little.");
    const sub = path.slice("/api/rating".length);
    if (sub === "" || sub === "/") {
      if (req.method !== "GET") throw new RatingError(405, "method_not_allowed", "Wrong method.");
      send(req, res, 200, await ratingsOf(me));
      return;
    }
    if (req.method !== "POST") throw new RatingError(405, "method_not_allowed", "Wrong method.");
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new RatingError(415, "bad_request", "Send JSON.");
    const body = await readBody(req);
    if (sub === "/level") send(req, res, 200, await setLevel(me, body.level));
    else if (sub === "/start") send(req, res, 200, await startBotGame(me, body));
    else if (sub === "/leave") send(req, res, 200, await leaveBotGame(me, body.ticket));
    else throw new RatingError(404, "not_found", "Not found.");
  } catch (err) {
    if (err instanceof RatingError) send(req, res, err.status, { error: err.code, message: err.message });
    else {
      console.error("Rating error:", err);
      if (!res.headersSent) send(req, res, 500, { error: "server_error", message: "Something went wrong. Try again." });
    }
  }
}

export function sweepRatingLimits() {
  limiter.sweep();
}