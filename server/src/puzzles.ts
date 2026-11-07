import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Chess } from "chess.js";
import { AUTH_DISABLED, bearer, verifyToken } from "./auth.js";
import { LOGS_ON, banEnd, profileOf, rest } from "./logs.js";
import { guestBan, guestRecord, isGuestToken, verifyGuestToken } from "./guests.js";
import { RateLimiter } from "./limits.js";
import { clientIp, securityHeaders } from "./security.js";

type Reply = ServerResponse;

const SESSION_TTL_MS = 60 * 60_000;
const GUEST_MEMORY = 300;
const START_RATING = 1500;
const START_RD = 350;
const START_VOL = 0.06;
const DIFFICULTY_STEP = 300;
const MIN_TARGET = 400;
const MAX_TARGET = 3000;

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const THEME = /^[A-Za-z0-9]{2,30}$/;
const SESSION = /^[A-Za-z0-9_-]{22}$/;

type PuzzleRow = {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  rating_dev: number;
  themes: string[];
  opening: string;
  game_url: string;
};

type Who = { id: string; guest: boolean };

type Session = {
  id: string;
  owner: string;
  guest: boolean;
  puzzle: PuzzleRow;
  line: string[];
  next: number;
  chess: Chess;
  started: number;
  done: boolean;
};

type RatingRow = {
  rating: number;
  rd: number;
  vol: number;
  played: number;
  solved: number;
  streak: number;
  best_streak: number;
};

class PuzzleError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sessions = new Map<string, Session>();
const openBy = new Map<string, string>();
const guestSeen = new Map<string, string[]>();
const nextLimit = new RateLimiter(Number(process.env.PUZZLE_NEXT_BURST) || 20, 0.5);
const moveLimit = new RateLimiter(60, 3);

const SCALE = 173.7178;
const TAU = 0.75;

function glicko2(me: { rating: number; rd: number; vol: number }, opp: { rating: number; rd: number }, score: 0 | 1) {
  const mu = (me.rating - 1500) / SCALE;
  const phi = me.rd / SCALE;
  const muJ = (opp.rating - 1500) / SCALE;
  const phiJ = opp.rd / SCALE;
  const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
  const e = 1 / (1 + Math.exp(-g * (mu - muJ)));
  const v = 1 / (g * g * e * (1 - e));
  const delta = v * g * (score - e);
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * g * (score - e);
  return {
    rating: Math.min(3500, Math.max(100, muNew * SCALE + 1500)),
    rd: Math.min(START_RD, Math.max(45, phiNew * SCALE)),
    vol: Math.min(0.1, vol),
  };
}

async function who(req: IncomingMessage): Promise<Who> {
  const token = bearer(req);
  const ip = clientIp(req);
  if (isGuestToken(token)) {
    const pass = verifyGuestToken(token);
    if (!pass || !(await guestRecord(pass.id)).found) throw new PuzzleError(401, "unauthorized", "Your guest pass expired. Reload the page.");
    if (await guestBan(pass.id, ip)) throw new PuzzleError(403, "banned", "Guest play is suspended for your network.");
    return { id: pass.id, guest: true };
  }
  if (!token && AUTH_DISABLED) return { id: "anon:" + ip, guest: true };
  const player = await verifyToken(token);
  if (!player) throw new PuzzleError(401, "unauthorized", "Sign in again.");
  const profile = await profileOf(player.id, 5000);
  if (banEnd(profile)) throw new PuzzleError(403, "banned", "This account is suspended.");
  return { id: player.id, guest: false };
}

async function readRating(userId: string): Promise<RatingRow> {
  const res = await rest("GET", `puzzle_ratings?user_id=eq.${userId}&select=*`, undefined, "");
  const row = ((await res.json()) as RatingRow[])[0];
  return (
    row ?? { rating: START_RATING, rd: START_RD, vol: START_VOL, played: 0, solved: 0, streak: 0, best_streak: 0 }
  );
}

function publicRating(r: RatingRow) {
  return {
    rating: Math.round(r.rating),
    provisional: r.rd > 110,
    played: r.played,
    solved: r.solved,
    streak: r.streak,
    bestStreak: r.best_streak,
  };
}

function newId() {
  return randomBytes(16).toString("base64url").slice(0, 22);
}

function play(chess: Chess, uci: string) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.started > SESSION_TTL_MS) {
      sessions.delete(id);
      if (openBy.get(s.owner) === id) openBy.delete(s.owner);
    }
  }
}

async function next(req: IncomingMessage, me: Who, body: Record<string, unknown>) {
  if (!LOGS_ON) throw new PuzzleError(503, "unavailable", "Puzzles aren't set up on this server.");
  if (body.mode === "cards") throw new PuzzleError(403, "coming_soon", "Action-card puzzles are coming soon.");
  const theme = typeof body.theme === "string" && THEME.test(body.theme) ? body.theme : null;
  const step = Math.max(-2, Math.min(2, Math.round(Number(body.difficulty) || 0)));
  const mine = me.guest ? null : await readRating(me.id);
  const base = mine ? mine.rating : START_RATING;
  const target = Math.round(Math.max(MIN_TARGET, Math.min(MAX_TARGET, base + step * DIFFICULTY_STEP)));
  const pick = async (exclude: string[]) => {
    const res = await rest(
      "POST",
      "rpc/next_puzzle",
      { p_rating: target, p_user: me.guest ? null : me.id, p_theme: theme, p_exclude: exclude, p_mode: "chess" },
      ""
    );
    return ((await res.json()) as PuzzleRow[])[0];
  };
  const recent = me.guest ? (guestSeen.get(me.id) ?? []) : [];
  let row = await pick(recent);
  if (!row && recent.length) row = await pick(recent.slice(-1));
  if (!row) {
    throw new PuzzleError(404, "none", theme ? "No puzzle left with this theme. Try another one." : "No puzzle found. Try again later.");
  }
  const line = row.moves.trim().split(/\s+/);
  const chess = new Chess(row.fen);
  if (line.length < 2 || !play(chess, line[0])) throw new PuzzleError(500, "broken", "This puzzle is broken. Try the next one.");

  sweep();
  const old = openBy.get(me.id);
  if (old) sessions.delete(old);
  const s: Session = { id: newId(), owner: me.id, guest: me.guest, puzzle: row, line, next: 1, chess, started: Date.now(), done: false };
  sessions.set(s.id, s);
  openBy.set(me.id, s.id);
  if (me.guest) {
    const seen = guestSeen.get(me.id) ?? [];
    seen.push(row.id);
    guestSeen.set(me.id, seen.slice(-GUEST_MEMORY));
    if (guestSeen.size > 20_000) guestSeen.delete(guestSeen.keys().next().value as string);
  }
  return {
    session: s.id,
    puzzle: { id: row.id, fen: row.fen, setup: line[0], color: chess.turn() },
    me: mine ? publicRating(mine) : null,
  };
}

async function finish(s: Session, solved: boolean) {
  s.done = true;
  if (openBy.get(s.owner) === s.id) openBy.delete(s.owner);
  let rating: { before: number; after: number; delta: number; me: ReturnType<typeof publicRating> } | null = null;
  if (!s.guest && LOGS_ON) {
    try {
      const mine = await readRating(s.owner);
      const after = glicko2(mine, { rating: s.puzzle.rating, rd: s.puzzle.rating_dev || 80 }, solved ? 1 : 0);
      const streak = solved ? mine.streak + 1 : 0;
      const row: RatingRow & { user_id: string; updated_at: string } = {
        user_id: s.owner,
        rating: after.rating,
        rd: after.rd,
        vol: after.vol,
        played: mine.played + 1,
        solved: mine.solved + (solved ? 1 : 0),
        streak,
        best_streak: Math.max(mine.best_streak, streak),
        updated_at: new Date().toISOString(),
      };
      await rest("POST", "puzzle_ratings?on_conflict=user_id", row, "resolution=merge-duplicates,return=minimal");
      await rest("POST", "puzzle_attempts", {
        user_id: s.owner,
        puzzle_id: s.puzzle.id,
        solved,
        rating_before: Math.round(mine.rating),
        rating_after: Math.round(after.rating),
        ms: Math.min(2_000_000_000, Date.now() - s.started),
      });
      rating = {
        before: Math.round(mine.rating),
        after: Math.round(after.rating),
        delta: Math.round(after.rating) - Math.round(mine.rating),
        me: publicRating(row),
      };
    } catch (err) {
      console.warn("Couldn't save a puzzle result:", (err as Error).message);
    }
  }
  return {
    done: true,
    solved,
    solution: s.line,
    puzzle: {
      id: s.puzzle.id,
      rating: s.puzzle.rating,
      themes: s.puzzle.themes ?? [],
      opening: s.puzzle.opening ?? "",
    },
    rating,
  };
}

function sessionOf(me: Who, body: Record<string, unknown>) {
  const id = typeof body.session === "string" && SESSION.test(body.session) ? body.session : "";
  const s = sessions.get(id);
  if (!s || s.owner !== me.id) throw new PuzzleError(404, "expired", "This puzzle expired. Load the next one.");
  if (s.done) throw new PuzzleError(409, "done", "This puzzle is already finished.");
  return s;
}

async function move(me: Who, body: Record<string, unknown>) {
  const s = sessionOf(me, body);
  const uci = typeof body.move === "string" ? body.move : "";
  if (!UCI.test(uci)) throw new PuzzleError(400, "bad_move", "That move can't be read.");
  const expected = s.line[s.next];
  const played = play(s.chess, uci);
  if (!played) throw new PuzzleError(400, "illegal", "That move isn't legal here.");
  const right = uci === expected || s.chess.isCheckmate();
  if (!right) {
    return { ok: false, ...(await finish(s, false)) };
  }
  if (s.chess.isCheckmate() || s.next + 1 >= s.line.length) {
    return { ok: true, ...(await finish(s, true)) };
  }
  const reply = s.line[s.next + 1];
  play(s.chess, reply);
  s.next += 2;
  if (s.next >= s.line.length) return { ok: true, reply, ...(await finish(s, true)) };
  return { ok: true, reply, done: false };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2048) throw new PuzzleError(413, "too_large", "Request too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
  }
  throw new PuzzleError(400, "bad_request", "Couldn't read the request.");
}

function send(req: IncomingMessage, res: Reply, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...securityHeaders(req), "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export async function handlePuzzles(req: IncomingMessage, res: Reply, path: string, onPlayer: (id: string) => void = () => {}) {
  let me: Who;
  try {
    const action = path.slice("/api/puzzles/".length);
    if (!["next", "move", "giveup", "me"].includes(action)) throw new PuzzleError(404, "not_found", "Not found.");
    if (action === "me" ? req.method !== "GET" : req.method !== "POST") throw new PuzzleError(405, "method_not_allowed", "Wrong method.");
    if (action !== "me" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      throw new PuzzleError(415, "bad_request", "Send JSON.");
    }
    me = await who(req);
    if (!me.id.startsWith("anon:")) onPlayer(me.id);
    if (action === "me") {
      send(req, res, 200, { me: me.guest || !LOGS_ON ? null : publicRating(await readRating(me.id)) });
      return;
    }
    const limiter = action === "next" ? nextLimit : moveLimit;
    if (!limiter.take(me.id)) throw new PuzzleError(429, "slow_down", "Slow down a little.");
    const body = await readBody(req);
    if (action === "next") send(req, res, 200, await next(req, me, body));
    else if (action === "move") send(req, res, 200, await move(me, body));
    else send(req, res, 200, { ok: false, ...(await finish(sessionOf(me, body), false)) });
  } catch (err) {
    if (err instanceof PuzzleError) {
      send(req, res, err.status, { error: err.code, message: err.message }, err.status === 429 ? { "retry-after": "5" } : {});
    } else {
      console.error("Puzzle error:", err);
      if (!res.headersSent) send(req, res, 500, { error: "server_error", message: "Something went wrong. Try again." });
    }
  }
}