import type { IncomingMessage, ServerResponse } from "node:http";
import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { bearer, secondsSince, verifyToken, type Player } from "./auth.js";
import { LOGS_ON, banEnd, forgetProfile, logEvent, origin, profileOf, rest } from "./logs.js";
import { clientIp, securityHeaders } from "./security.js";
import { RateLimiter } from "./limits.js";
import { MAIL_ON, cleanSubject, jobStatus, mailStatus, startJob, type Recipient } from "./mail.js";

const MIN = 60_000;
const IDLE_MS = Number(process.env.ADMIN_IDLE_MS) || 15 * MIN;
const MAX_MS = 2 * 60 * MIN;
const FRESH_LOGIN_S = 5 * 60;
const STEP_UP_S = 10 * 60;
const INFO = Buffer.from("tempo-admin-v1");

type AdminSession = {
  id: string;
  userId: string;
  ip: string;
  ua: string;
  key: Buffer;
  created: number;
  lastUsed: number;
  lastN: number;
};

const sessions = new Map<string, AdminSession>();
const handshakes = new RateLimiter(10, 10 / 60);
const calls = new RateLimiter(120, 2);

type Hooks = {
  kickUser: (userId: string, code: number, reason: string) => number;
  online: () => unknown[];
};
let hooks: Hooks = { kickUser: () => 0, online: () => [] };
export function setAdminHooks(h: Hooks) {
  hooks = h;
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    ...securityHeaders(req),
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function denied(req: IncomingMessage, res: ServerResponse, status: number, why: string, userId?: string) {
  logEvent("admin_denied", req, { status, userId: userId ?? null, detail: { why } });
  send(req, res, status, { error: why });
}

function seal(key: Buffer, aad: string, data: unknown) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final(), c.getAuthTag()]);
  return { iv: iv.toString("base64"), ct: ct.toString("base64") };
}

function open(key: Buffer, aad: string, ivB64: string, ctB64: string): unknown {
  const iv = Buffer.from(ivB64, "base64");
  const all = Buffer.from(ctB64, "base64");
  if (iv.length !== 12 || all.length < 17) throw new Error("bad envelope");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(all.subarray(all.length - 16));
  const plain = Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
  return JSON.parse(plain.toString("utf8"));
}

async function audit(req: IncomingMessage, adminId: string, action: string, target: string | null, detail?: unknown) {
  if (!LOGS_ON) return;
  const o = origin(req);
  await rest("POST", "admin_audit", {
    admin_id: adminId,
    action,
    target,
    ip: o.ip,
    user_agent: o.user_agent,
    detail: detail ?? null,
  });
}

async function checkAdmin(player: Player | null) {
  if (!player) return "not_signed_in";
  if (player.aal !== "aal2") return "mfa_required";
  const profile = await profileOf(player.id, 5_000);
  if (profile.role !== "admin") return "not_admin";
  if (banEnd(profile)) return "banned";
  return null;
}

async function startSession(req: IncomingMessage, res: ServerResponse) {
  const ip = clientIp(req);
  if (!handshakes.take(ip)) return denied(req, res, 429, "too_many_attempts");
  const player = await verifyToken(bearer(req));
  const problem = await checkAdmin(player);
  if (problem) return denied(req, res, problem === "not_signed_in" ? 401 : 403, problem, player?.id);
  if (secondsSince(player!, "password") > FRESH_LOGIN_S || secondsSince(player!, "totp") > FRESH_LOGIN_S) {
    return denied(req, res, 403, "login_again", player!.id);
  }
  let body: { pub?: unknown };
  try {
    body = (await readJson(req, 4096)) as { pub?: unknown };
  } catch {
    return denied(req, res, 400, "bad_request", player!.id);
  }
  if (typeof body?.pub !== "string" || body.pub.length > 200) return denied(req, res, 400, "bad_request", player!.id);

  const id = randomBytes(32).toString("base64url");
  let key: Buffer;
  let serverPub: Buffer;
  try {
    const ecdh = createECDH("prime256v1");
    serverPub = ecdh.generateKeys();
    const shared = ecdh.computeSecret(Buffer.from(body.pub, "base64"));
    key = Buffer.from(hkdfSync("sha256", shared, Buffer.from(id), INFO, 32));
  } catch {
    return denied(req, res, 400, "bad_key", player!.id);
  }
  for (const [sid, s] of sessions) if (s.userId === player!.id) sessions.delete(sid);
  try {
    await audit(req, player!.id, "admin_login", null);
  } catch (err) {
    console.warn("Admin audit failed:", (err as Error).message);
    return send(req, res, 503, { error: "audit_unavailable" });
  }
  sessions.set(id, {
    id,
    userId: player!.id,
    ip,
    ua: String(req.headers["user-agent"] ?? ""),
    key,
    created: Date.now(),
    lastUsed: Date.now(),
    lastN: 0,
  });
  send(req, res, 200, { session: id, pub: serverPub.toString("base64"), idleMs: IDLE_MS });
}

function findSession(req: IncomingMessage, id: unknown) {
  if (typeof id !== "string" || id.length > 100) return null;
  for (const s of sessions.values()) {
    const a = Buffer.from(s.id);
    const b = Buffer.from(id);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (Date.now() - s.lastUsed > IDLE_MS || Date.now() - s.created > MAX_MS) {
        sessions.delete(s.id);
        return null;
      }
      return s;
    }
  }
  return null;
}

async function endSession(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = (await readJson(req, 512)) as { session?: unknown };
    const s = findSession(req, body?.session);
    if (s) sessions.delete(s.id);
  } catch {
  }
  send(req, res, 200, { ok: true });
}

async function rpc(req: IncomingMessage, res: ServerResponse) {
  const s = findSession(req, req.headers["x-admin-session"]);
  if (!s) return denied(req, res, 401, "session_expired");
  if (!calls.take(s.id)) return denied(req, res, 429, "slow_down", s.userId);
  if (clientIp(req) !== s.ip || String(req.headers["user-agent"] ?? "") !== s.ua) {
    sessions.delete(s.id);
    return denied(req, res, 401, "session_moved", s.userId);
  }
  const player = await verifyToken(bearer(req));
  if (!player || player.id !== s.userId) {
    sessions.delete(s.id);
    return denied(req, res, 401, "session_expired", player?.id);
  }
  const problem = await checkAdmin(player);
  if (problem) {
    sessions.delete(s.id);
    return denied(req, res, 403, problem, player.id);
  }

  let envelope: { n?: unknown; iv?: unknown; ct?: unknown };
  let call: { op?: unknown; args?: unknown };
  try {
    envelope = (await readJson(req)) as typeof envelope;
    if (!Number.isInteger(envelope.n) || typeof envelope.iv !== "string" || typeof envelope.ct !== "string") throw 0;
    call = open(s.key, `tempo-admin|req|${envelope.n}`, envelope.iv, envelope.ct) as typeof call;
  } catch {
    return denied(req, res, 400, "bad_envelope", s.userId);
  }
  const n = envelope.n as number;
  if (n <= s.lastN) return denied(req, res, 400, "replayed", s.userId);
  s.lastN = n;
  s.lastUsed = Date.now();

  let result: unknown;
  try {
    result = await runOp(req, s, player, String(call?.op ?? ""), (call?.args ?? {}) as Record<string, unknown>);
  } catch (err) {
    if (err instanceof AdminError) result = { error: err.code, message: err.message };
    else {
      console.error(err);
      result = { error: "server_error", message: "Something went wrong." };
    }
  }
  send(req, res, 200, { n, ...seal(s.key, `tempo-admin|res|${n}`, result) });
}

export async function handleAdmin(req: IncomingMessage, res: ServerResponse, path: string) {
  try {
    if (req.method !== "POST") return send(req, res, 405, { error: "method_not_allowed" });
    if (path === "/api/admin/session") return await startSession(req, res);
    if (path === "/api/admin/rpc") return await rpc(req, res);
    if (path === "/api/admin/end") return await endSession(req, res);
    send(req, res, 404, { error: "not_found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(req, res, 500, { error: "server_error" });
  }
}

class AdminError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v: unknown) {
  if (typeof v !== "string" || !UUID.test(v)) throw new AdminError("bad_args", "Unknown user.");
  return v.toLowerCase();
}

function searchText(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 60 || !/^[\p{L}\p{N} ._@:/-]+$/u.test(v)) {
    throw new AdminError("bad_args", "Search with letters, numbers and . _ @ : / - only.");
  }
  return v.trim();
}

function int(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function isoDate(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) throw new AdminError("bad_args", "Bad date.");
  return new Date(t).toISOString();
}

export function maskEmail(email: string | null) {
  if (!email) return null;
  const [user, domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${user.slice(0, 2)}•••@${host.slice(0, 2)}•••${tld}`;
}

function stepUp(player: Player) {
  if (secondsSince(player, "totp") > STEP_UP_S) {
    throw new AdminError("step_up", "Enter a new code from your authenticator app to do this.");
  }
}

async function getRows(path: string) {
  const res = await rest("GET", path, undefined, "");
  return (await res.json()) as Record<string, unknown>[];
}

async function count(path: string, column = "id") {
  const res = await rest("GET", path + (path.includes("?") ? "&" : "?") + `select=${column}&limit=1`, undefined, "count=exact");
  const range = res.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

function authAdmin(method: string, userId: string, body?: unknown) {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !secret) return Promise.resolve(null);
  return fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method,
    headers: { apikey: secret, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
}

async function supabaseBan(userId: string, minutes: number | null) {
  const res = await authAdmin("PUT", userId, { ban_duration: minutes === null ? "none" : `${minutes}m` });
  return !!res?.ok;
}

const groupMails = new RateLimiter(3, 3 / 3600);
const singleMails = new RateLimiter(30, 30 / 3600);
const MAX_RECIPIENTS = 500;

async function targetProfile(id: string) {
  const rows = await getRows(`profiles?id=eq.${id}&select=id,email,display_name,role,banned_until`);
  if (!rows[0]) throw new AdminError("not_found", "This user doesn't exist.");
  return rows[0];
}

async function runOp(req: IncomingMessage, s: AdminSession, player: Player, op: string, a: Record<string, unknown>) {
  switch (op) {
    case "me":
      return { id: player.id, email: player.email, name: player.name, idleMs: IDLE_MS };

    case "logout":
      sessions.delete(s.id);
      return { ok: true };

    case "overview": {
      const day = new Date(Date.now() - 24 * 60 * MIN).toISOString();
      const now = new Date().toISOString();
      const [users, signups, bans, pages, blocked, authFailed, denied, visitors] = await Promise.all([
        count("profiles"),
        count(`profiles?created_at=gte.${day}`),
        count(`profiles?banned_until=gt.${now}`),
        count(`access_log?kind=eq.page&at=gte.${day}`),
        count(`access_log?kind=eq.blocked&at=gte.${day}`),
        count(`access_log?kind=eq.auth_failed&at=gte.${day}`),
        count(`access_log?kind=eq.admin_denied&at=gte.${day}`),
        count(`visitors?last_seen=gte.${day}`, "ip").catch(() => 0),
      ]);
      return { online: hooks.online().length, users, signups, bans, pages, blocked, authFailed, denied, visitors };
    }

    case "online":
      return { rows: hooks.online() };

    case "logs": {
      const limit = int(a.limit, 1, 100, 50);
      const parts = ["select=*", "order=id.desc", `limit=${limit}`];
      if (a.before !== undefined) parts.push(`id=lt.${int(a.before, 1, Number.MAX_SAFE_INTEGER, 1)}`);
      if (typeof a.kind === "string" && /^[a-z_]{2,30}$/.test(a.kind)) parts.push(`kind=eq.${a.kind}`);
      const ip = searchText(a.ip);
      if (ip) parts.push(`ip=eq.${encodeURIComponent(ip)}`);
      if (a.user) parts.push(`user_id=eq.${uuid(a.user)}`);
      const from = isoDate(a.from);
      if (from) parts.push(`at=gte.${from}`);
      const to = isoDate(a.to);
      if (to) parts.push(`at=lt.${to}`);
      const q = searchText(a.q);
      if (q) parts.push(`path=ilike.*${encodeURIComponent(q)}*`);
      return { rows: await getRows("access_log?" + parts.join("&")) };
    }

    case "users": {
      const limit = int(a.limit, 1, 100, 50);
      const offset = int(a.offset, 0, 100_000, 0);
      const parts = [
        "select=id,email,display_name,role,created_at,last_seen_at,banned_until,ban_reason",
        "order=created_at.desc",
        `limit=${limit}`,
        `offset=${offset}`,
      ];
      const q = searchText(a.q);
      if (q) parts.push(`or=(display_name.ilike."*${encodeURIComponent(q)}*",email.ilike."*${encodeURIComponent(q)}*")`);
      if (a.filter === "banned") parts.push(`banned_until=gt.${new Date().toISOString()}`);
      if (a.filter === "admins") parts.push("role=eq.admin");
      const rows = await getRows("profiles?" + parts.join("&"));
      return { rows: rows.map((r) => ({ ...r, email: maskEmail(r.email as string | null) })) };
    }

    case "revealEmail": {
      stepUp(player);
      const id = uuid(a.id);
      const row = await targetProfile(id);
      await audit(req, player.id, "reveal_email", id);
      return { email: row.email };
    }

    case "ban": {
      stepUp(player);
      const id = uuid(a.id);
      if (id === player.id) throw new AdminError("not_allowed", "You can't ban yourself.");
      const reason = typeof a.reason === "string" ? a.reason.trim().slice(0, 200) : "";
      if (reason.length < 3) throw new AdminError("bad_args", "Give a reason (at least 3 characters).");
      const permanent = a.minutes === null || a.hours === null;
      const minutes = permanent
        ? null
        : a.minutes !== undefined
          ? int(a.minutes, 5, 365 * 24 * 60, 60)
          : int(a.hours, 1, 365 * 24, 24) * 60;
      const target = await targetProfile(id);
      if (target.role === "admin") throw new AdminError("not_allowed", "Remove the admin role before banning an admin.");
      const until = minutes === null ? "9999-12-31T00:00:00.000Z" : new Date(Date.now() + minutes * MIN).toISOString();
      await audit(req, player.id, "ban", id, { minutes, reason, until });
      await rest("PATCH", `profiles?id=eq.${id}`, { banned_until: until, ban_reason: reason });
      forgetProfile(id);
      const supabaseOk = await supabaseBan(id, minutes === null ? 100 * 365 * 24 * 60 : minutes);
      const kicked = hooks.kickUser(id, 4003, "Account suspended");
      return { ok: true, until, kicked, supabase: supabaseOk };
    }

    case "unban": {
      stepUp(player);
      const id = uuid(a.id);
      await targetProfile(id);
      await audit(req, player.id, "unban", id);
      await rest("PATCH", `profiles?id=eq.${id}`, { banned_until: null, ban_reason: null });
      forgetProfile(id);
      const supabaseOk = await supabaseBan(id, null);
      return { ok: true, supabase: supabaseOk };
    }

    case "setRole": {
      stepUp(player);
      const id = uuid(a.id);
      if (id === player.id) throw new AdminError("not_allowed", "You can't change your own role.");
      if (a.role !== "user" && a.role !== "admin") throw new AdminError("bad_args", "Role must be user or admin.");
      const target = await targetProfile(id);
      await audit(req, player.id, "set_role", id, { from: target.role, to: a.role });
      await rest("PATCH", `profiles?id=eq.${id}`, { role: a.role });
      forgetProfile(id);
      if (a.role === "user") for (const [sid, other] of sessions) if (other.userId === id) sessions.delete(sid);
      return { ok: true };
    }

    case "deleteUser": {
      stepUp(player);
      const id = uuid(a.id);
      if (id === player.id) throw new AdminError("not_allowed", "You can't delete your own account here.");
      const target = await targetProfile(id);
      if (target.role === "admin") throw new AdminError("not_allowed", "Remove the admin role before deleting an admin.");
      if (typeof a.confirm !== "string" || a.confirm.trim() !== String(target.display_name ?? "").trim()) {
        throw new AdminError("bad_args", "Type the player's exact name to confirm.");
      }
      await audit(req, player.id, "delete_user", id, { name: target.display_name, email: maskEmail(target.email as string | null) });
      hooks.kickUser(id, 4003, "Account deleted");
      const res = await authAdmin("DELETE", id);
      if (!res || !res.ok) {
        throw new AdminError("failed", `Supabase refused to delete the account (${res ? res.status : "no answer"}). Nothing was deleted.`);
      }
      forgetProfile(id);
      return { ok: true };
    }

    case "mailStatus":
      return mailStatus();

    case "sendEmail": {
      stepUp(player);
      if (!MAIL_ON) throw new AdminError("not_configured", "Email sending isn't set up on the server (SMTP settings).");
      const subject = cleanSubject(typeof a.subject === "string" ? a.subject : "");
      const message = typeof a.message === "string" ? a.message.replace(/\r\n/g, "\n").trim() : "";
      if (subject.length < 3 || subject.length > 120) throw new AdminError("bad_args", "The subject must be 3 to 120 characters.");
      if (message.length < 10 || message.length > 5000) throw new AdminError("bad_args", "The message must be 10 to 5000 characters.");
      const audience = String(a.audience ?? "");
      const now = new Date().toISOString();
      let rows: Record<string, unknown>[];
      if (audience === "user") {
        if (!singleMails.take(player.id)) throw new AdminError("slow_down", "Too many emails this hour. Try again later.");
        rows = await getRows(`profiles?id=eq.${uuid(a.id)}&select=email,display_name`);
        if (!rows[0]) throw new AdminError("not_found", "This user doesn't exist.");
      } else if (audience === "all" || audience === "admins" || audience === "active") {
        if (!groupMails.take(player.id)) throw new AdminError("slow_down", "At most 3 group emails per hour. Try again later.");
        const parts = ["select=email,display_name", `limit=${MAX_RECIPIENTS}`, `or=(banned_until.is.null,banned_until.lt.${now})`];
        if (audience === "admins") parts.push("role=eq.admin");
        if (audience === "active") parts.push(`last_seen_at=gte.${new Date(Date.now() - 30 * 24 * 60 * MIN).toISOString()}`);
        rows = await getRows("profiles?" + parts.join("&"));
      } else {
        throw new AdminError("bad_args", "Choose who receives the email.");
      }
      const to: Recipient[] = rows
        .filter((r) => typeof r.email === "string" && /^[^\s@<>",;]+@[^\s@<>",;]+$/.test(r.email as string))
        .map((r) => ({ email: r.email as string, name: (r.display_name as string) ?? null }));
      if (!to.length) throw new AdminError("not_found", "Nobody matches this group.");
      const jobId = randomBytes(8).toString("hex");
      await audit(req, player.id, "send_email", audience === "user" ? String(a.id) : audience, {
        audience,
        recipients: to.length,
        subject,
        preview: message.slice(0, 200),
        job: jobId,
      });
      const job = startJob(jobId, subject, message, to);
      return { job: job.id, total: job.total };
    }

    case "emailJob": {
      const job = typeof a.job === "string" ? jobStatus(a.job) : null;
      if (!job) throw new AdminError("not_found", "Unknown email job.");
      return { total: job.total, sent: job.sent, failed: job.failed, done: job.done };
    }

    case "audit": {
      const limit = int(a.limit, 1, 100, 50);
      const parts = ["select=*", "order=id.desc", `limit=${limit}`];
      if (a.before !== undefined) parts.push(`id=lt.${int(a.before, 1, Number.MAX_SAFE_INTEGER, 1)}`);
      return { rows: await getRows("admin_audit?" + parts.join("&")) };
    }

    default:
      throw new AdminError("bad_args", "Unknown action.");
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastUsed > IDLE_MS || now - s.created > MAX_MS) sessions.delete(id);
}, MIN).unref();