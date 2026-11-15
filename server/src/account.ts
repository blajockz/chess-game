import type { IncomingMessage, ServerResponse } from "node:http";
import { AUTH_DISABLED, bearer, verifyToken } from "./auth.js";
import { LOGS_ON, banEnd, forgetProfile, logEvent, profileOf, rest } from "./logs.js";
import { isGuestToken } from "./guests.js";
import { RateLimiter } from "./limits.js";
import { clientIp, securityHeaders } from "./security.js";
import { EmailLimitError, emailPermit } from "./emailLimit.js";

export const NAME_WAIT_MS = Number(process.env.NAME_WAIT_MS) || 72 * 60 * 60_000;

class AccountError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const limiter = new RateLimiter(30, 0.5);
const nameTries = new RateLimiter(5, 1 / 600);
const emailChanges = new RateLimiter(3, 3 / 86_400);

type Row = { display_name: string | null; email: string | null; name_changed_at: string | null };
const memory = new Map<string, Row>();

async function readRow(id: string): Promise<Row> {
  if (!LOGS_ON) return memory.get(id) ?? { display_name: "You", email: null, name_changed_at: null };
  const res = await rest("GET", `profiles?id=eq.${id}&select=display_name,email,name_changed_at`, undefined, "");
  const row = ((await res.json()) as Row[])[0];
  if (!row) throw new AccountError(404, "no_profile", "This account has no profile yet. Sign out and in again.");
  return row;
}

async function cleanName(raw: string, email: string | null) {
  if (!LOGS_ON) return raw.replace(/\s+/g, " ").trim().slice(0, 24);
  const res = await rest("POST", "rpc/clean_display_name", { raw, email: email ?? "" }, "");
  const out = await res.json();
  return typeof out === "string" ? out.trim() : "";
}

function view(row: Row) {
  const changed = row.name_changed_at ? Date.parse(row.name_changed_at) : null;
  const next = changed ? changed + NAME_WAIT_MS : null;
  return {
    name: row.display_name ?? "Player",
    nameChangedAt: row.name_changed_at,
    nextNameChangeAt: next && next > Date.now() ? new Date(next).toISOString() : null,
  };
}

async function changeName(req: IncomingMessage, id: string, wanted: unknown) {
  if (typeof wanted !== "string" || wanted.length > 80) throw new AccountError(400, "bad_name", "Enter a name.");
  if (!nameTries.take(id)) throw new AccountError(429, "slow_down", "Too many tries. Wait a few minutes.");
  const row = await readRow(id);
  const state = view(row);
  if (state.nextNameChangeAt) {
    const hours = Math.max(1, Math.ceil((Date.parse(state.nextNameChangeAt) - Date.now()) / 3_600_000));
    throw new AccountError(429, "too_soon", `You changed your name recently. You can change it again in ${hours} h.`, {
      nextNameChangeAt: state.nextNameChangeAt,
    });
  }
  const name = await cleanName(wanted, row.email);
  if (name.length < 2) throw new AccountError(400, "bad_name", "This name can't be used. Choose another one (2 to 24 characters).");
  if (name === (row.display_name ?? "")) throw new AccountError(400, "same_name", "That is already your name.");
  const next: Row = { ...row, display_name: name, name_changed_at: new Date().toISOString() };
  if (!LOGS_ON) memory.set(id, next);
  else await rest("PATCH", `profiles?id=eq.${id}`, { display_name: name, name_changed_at: next.name_changed_at }, "return=minimal");
  forgetProfile(id);
  logEvent("api", req, { userId: id, detail: { action: "name_change" } });
  return view(next);
}

async function who(req: IncomingMessage) {
  const token = bearer(req);
  if (isGuestToken(token)) throw new AccountError(403, "guest", "Sign in to use account settings.");
  if (!token && AUTH_DISABLED) return "anon:" + clientIp(req);
  const player = await verifyToken(token);
  if (!player) throw new AccountError(401, "unauthorized", "Sign in again.");
  if (banEnd(await profileOf(player.id, 5000))) throw new AccountError(403, "banned", "This account is suspended.");
  return player.id;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2048) throw new AccountError(413, "too_large", "Request too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
  }
  throw new AccountError(400, "bad_request", "Couldn't read the request.");
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...securityHeaders(req), "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export async function handleAccount(req: IncomingMessage, res: ServerResponse, path: string, onPlayer: (id: string) => void = () => {}) {
  try {
    const me = await who(req);
    if (!me.startsWith("anon:")) onPlayer(me);
    if (!limiter.take(me)) throw new AccountError(429, "slow_down", "Slow down a little.");
    const sub = path.slice("/api/account".length);
    if (sub === "" || sub === "/") {
      if (req.method !== "GET") throw new AccountError(405, "method_not_allowed", "Wrong method.");
      send(req, res, 200, view(await readRow(me)));
      return;
    }
    if (req.method !== "POST") throw new AccountError(405, "method_not_allowed", "Wrong method.");
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new AccountError(415, "bad_request", "Send JSON.");
    const body = await readBody(req);
    if (sub === "/name") send(req, res, 200, await changeName(req, me, body.name));
    else if (sub === "/email-permit") {
      if (!emailChanges.take(me)) throw new AccountError(429, "too_many", "Too many email changes asked for today. Try again tomorrow.");
      send(req, res, 200, await emailPermit(req, clientIp(req), body.email, "email_change", true));
    } else throw new AccountError(404, "not_found", "Not found.");
  } catch (err) {
    if (err instanceof AccountError || err instanceof EmailLimitError) {
      send(req, res, err.status, { error: err.code, message: err.message, ...err.extra });
    } else {
      console.error("Account error:", err);
      if (!res.headersSent) send(req, res, 500, { error: "server_error", message: "Something went wrong. Try again." });
    }
  }
}

export function sweepAccountLimits() {
  limiter.sweep();
  nameTries.sweep();
  emailChanges.sweep();
}
