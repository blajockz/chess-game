import type { IncomingMessage } from "node:http";
import { SUPABASE_URL } from "./auth.js";
import { TRUST_PROXY, clientAddress } from "./security.js";

const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
export const LOGS_ON = !!(SUPABASE_URL && SECRET);
const KEEP_DAYS = Math.min(365, Math.max(1, Math.floor(Number(process.env.LOG_RETENTION_DAYS) || 90)));
const FLUSH_MS = Number(process.env.LOG_FLUSH_MS) || 2000;
const MAX_WAITING = 5000;
const BATCH = 500;

if (SUPABASE_URL && !SECRET) console.warn("SUPABASE_SECRET_KEY is missing: security logs will not be saved.");

export async function rest(method: string, path: string, body?: unknown, prefer = "return=minimal") {
  if (!LOGS_ON) throw new Error("Supabase is not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SECRET, "content-type": "application/json", prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

const ACCESS_COLUMNS = ["at", "kind", "ip", "user_id", "method", "path", "status", "user_agent", "referer", "country", "detail"] as const;
const PRESENCE_COLUMNS = ["at", "event", "session_id", "user_id", "ip", "user_agent", "country", "duration_ms", "reason"] as const;

type Row = Record<string, unknown>;

class Batch {
  private rows: Row[] = [];
  private failures = 0;
  private pausedUntil = 0;
  private sending = false;
  constructor(private table: string, private columns: readonly string[]) {}

  add(row: Row) {
    if (!LOGS_ON) return;
    const full: Row = {};
    for (const c of this.columns) full[c] = row[c] ?? null;
    full.at = row.at ?? new Date().toISOString();
    this.rows.push(full);
    if (this.rows.length > MAX_WAITING) this.rows.splice(0, this.rows.length - MAX_WAITING);
  }

  async flush() {
    if (this.sending || !this.rows.length || Date.now() < this.pausedUntil) return;
    this.sending = true;
    const batch = this.rows.splice(0, BATCH);
    try {
      await rest("POST", this.table, batch);
      this.failures = 0;
    } catch (err) {
      this.failures++;
      this.rows.unshift(...batch);
      if (this.rows.length > MAX_WAITING) this.rows.length = MAX_WAITING;
      this.pausedUntil = Date.now() + Math.min(60_000, 1000 * 2 ** this.failures);
      if (this.failures === 1 || this.failures % 20 === 0) console.warn(`Couldn't save ${this.table}:`, (err as Error).message);
    } finally {
      this.sending = false;
    }
  }

  get waiting() {
    return this.rows.length;
  }
}

const access = new Batch("access_log", ACCESS_COLUMNS);
const presence = new Batch("presence_log", PRESENCE_COLUMNS);

const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);

export function origin(req: IncomingMessage) {
  const referer = String(req.headers.referer ?? "");
  return {
    ip: clientAddress(req),
    user_agent: cut(req.headers["user-agent"], 300),
    referer: referer ? cut(referer.split("?")[0], 300) : null,
    country: TRUST_PROXY ? cut(req.headers["cf-ipcountry"], 8) : null,
  };
}

export type Kind =
  | "page"
  | "request"
  | "api"
  | "not_found"
  | "error"
  | "rate_limited"
  | "banned"
  | "refused"
  | "auth_failed"
  | "kicked"
  | "bad_message"
  | "bad_pow"
  | "game_connect"
  | "game_disconnect"
  | "game_create"
  | "game_join"
  | "game_refused"
  | "suppressed"
  | "blocked"
  | "admin_denied";

const PER_ADDRESS = Number(process.env.LOG_MAX_PER_MINUTE) || 120;
const budget = new Map<string, { since: number; used: number; skipped: number; kinds: Record<string, number> }>();

function allowed(ip: string, kind: string) {
  const now = Date.now();
  let b = budget.get(ip);
  if (!b || now - b.since > 60_000) {
    if (b && b.skipped > 0) {
      access.add({ kind: "suppressed", ip, detail: { skipped: b.skipped, kinds: b.kinds } });
    }
    b = { since: now, used: 0, skipped: 0, kinds: {} };
    budget.set(ip, b);
  }
  if (b.used < PER_ADDRESS) {
    b.used++;
    return true;
  }
  b.skipped++;
  b.kinds[kind] = (b.kinds[kind] ?? 0) + 1;
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of budget) {
    if (now - b.since <= 60_000) continue;
    if (b.skipped > 0) access.add({ kind: "suppressed", ip, detail: { skipped: b.skipped, kinds: b.kinds } });
    budget.delete(ip);
  }
}, 30_000).unref();

export function logEvent(
  kind: Kind,
  req: IncomingMessage | null,
  extra: { userId?: string | null; status?: number; detail?: Record<string, unknown>; ip?: string } = {}
) {
  if (!LOGS_ON) return;
  const where = req ? origin(req) : null;
  const ip = extra.ip ?? where?.ip ?? "unknown";
  if (kind !== "banned" && !allowed(ip, kind)) return;
  let detail = extra.detail ?? null;
  if (detail && JSON.stringify(detail).length > 2000) detail = { truncated: true };
  const url = req?.url ?? "";
  access.add({
    kind,
    ...(where ?? {}),
    ...(extra.ip ? { ip: extra.ip } : {}),
    user_id: extra.userId ?? null,
    method: req ? cut(req.method, 10) : null,
    path: req ? cut(url.split("?")[0], 300) : null,
    status: extra.status ?? null,
    detail,
  });
}

export function logPresence(row: {
  event: "enter" | "leave";
  sessionId: string;
  userId: string | null;
  req: IncomingMessage;
  durationMs?: number;
  reason?: string;
}) {
  presence.add({
    event: row.event,
    session_id: row.sessionId,
    user_id: row.userId,
    ...origin(row.req),
    duration_ms: row.durationMs ?? null,
    reason: cut(row.reason, 120),
  });
}

export type Profile = {
  at: number;
  role: "user" | "admin";
  name: string | null;
  bannedUntil: number | null;
  banReason: string | null;
  found: boolean;
};
const profiles = new Map<string, Profile>();

export async function profileOf(userId: string, maxAgeMs = 60_000): Promise<Profile> {
  const hit = profiles.get(userId);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit;
  const entry: Profile = { at: Date.now(), role: "user", name: null, bannedUntil: null, banReason: null, found: false };
  if (LOGS_ON) {
    try {
      const res = await rest(
        "GET",
        `profiles?id=eq.${encodeURIComponent(userId)}&select=role,display_name,banned_until,ban_reason`,
        undefined,
        ""
      );
      const rows = (await res.json()) as { role?: string; display_name?: string; banned_until?: string | null; ban_reason?: string | null }[];
      const row = rows[0];
      if (row) {
        entry.found = true;
        entry.role = row.role === "admin" ? "admin" : "user";
        entry.name = row.display_name ?? null;
        entry.bannedUntil = row.banned_until ? Date.parse(row.banned_until) : null;
        entry.banReason = row.ban_reason ?? null;
      }
    } catch (err) {
      console.warn("Couldn't read a profile:", (err as Error).message);
      if (hit) return hit;
    }
  }
  profiles.set(userId, entry);
  if (profiles.size > 5000) profiles.delete(profiles.keys().next().value!);
  return entry;
}

export function forgetProfile(userId: string) {
  profiles.delete(userId);
}

export function banEnd(p: Profile) {
  if (p.bannedUntil === null || Number.isNaN(p.bannedUntil)) return null;
  return p.bannedUntil > Date.now() ? p.bannedUntil : null;
}

const seenAt = new Map<string, number>();
export function touch(userId: string) {
  if (!LOGS_ON || Date.now() - (seenAt.get(userId) ?? 0) < 60_000) return;
  seenAt.set(userId, Date.now());
  if (seenAt.size > 5000) seenAt.delete(seenAt.keys().next().value!);
  rest("PATCH", `profiles?id=eq.${encodeURIComponent(userId)}`, { last_seen_at: new Date().toISOString() }).catch((err) =>
    console.warn("Couldn't update last_seen_at:", (err as Error).message)
  );
}

async function prune() {
  if (!LOGS_ON) return;
  try {
    await rest("POST", "rpc/prune_logs", { keep_days: KEEP_DAYS });
  } catch (err) {
    console.warn("Couldn't delete old logs:", (err as Error).message);
  }
}

export function flushLogs() {
  return Promise.all([access.flush(), presence.flush()]);
}

export function logsWaiting() {
  return access.waiting + presence.waiting;
}

if (LOGS_ON) {
  setInterval(() => void flushLogs(), FLUSH_MS).unref();
  setTimeout(() => void prune(), 10_000).unref();
  setInterval(() => void prune(), 24 * 60 * 60 * 1000).unref();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void flushLogs().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}