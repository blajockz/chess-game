import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { LOGS_ON, logEvent, origin, rest } from "./logs.js";
import { ProofOfWork, type Challenge } from "./challenges.js";
import { RateLimiter } from "./limits.js";
import type { Player } from "./auth.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const GUEST_TTL_MS = 30 * DAY;
const PER_IP_BURST = Number(process.env.GUESTS_PER_IP_BURST) || 10;
const PER_IP_REFILL = 1 / 120;
const PER_IP_PER_DAY = Number(process.env.GUESTS_PER_IP_PER_DAY) || 60;
const GLOBAL_BURST = 60;
const GLOBAL_PER_SECOND = 1;
const EXTRA_BITS = 2;
const CHALLENGE_TTL_MS = 2 * MIN;
const CACHE_MS = MIN;

const PREFIX = "g1.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^guest[0-9]{7}$/;
const TOKEN = /^g1\.[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/;

const SECRET: Buffer = (() => {
  const own = process.env.GUEST_SECRET ?? "";
  if (own.length >= 32) return Buffer.from(own);
  if (own) console.warn("GUEST_SECRET is shorter than 32 characters: ignored.");
  const supa = process.env.SUPABASE_SECRET_KEY ?? "";
  if (supa) return createHmac("sha256", supa).update("tempo-guest-pass-v1").digest();
  console.warn("No GUEST_SECRET or SUPABASE_SECRET_KEY: guest passes end when the server restarts.");
  return randomBytes(32);
})();

export class GuestError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;
  constructor(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export type GuestPass = { id: string; name: string; exp: number };

function sign(body: string) {
  return createHmac("sha256", SECRET).update(PREFIX + body).digest("base64url");
}

function issue(id: string, name: string) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.floor(GUEST_TTL_MS / 1000);
  const body = Buffer.from(JSON.stringify({ id, n: name, iat, exp })).toString("base64url");
  return { token: `${PREFIX}${body}.${sign(body)}`, exp };
}

export function isGuestToken(token: string | null | undefined): token is string {
  return typeof token === "string" && token.startsWith(PREFIX);
}

export function verifyGuestToken(token: string | null | undefined): GuestPass | null {
  if (!token || token.length > 600 || !TOKEN.test(token)) return null;
  const [, body, sig] = token.split(".");
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { id?: unknown; n?: unknown; exp?: unknown };
    if (typeof p.id !== "string" || !UUID.test(p.id)) return null;
    if (typeof p.n !== "string" || !NAME.test(p.n)) return null;
    if (typeof p.exp !== "number" || p.exp * 1000 < Date.now()) return null;
    return { id: p.id, name: p.n, exp: p.exp };
  } catch {
    return null;
  }
}

export function guestPlayer(pass: GuestPass): Player {
  return { id: pass.id, email: null, name: pass.name, aal: "aal1", amr: [], iat: 0, guest: true, admin: false };
}

type GuestRecord = { at: number; found: boolean; bannedUntil: number | null; banReason: string | null; bannedAt: number | null };
type IpBan = { at: number; until: number | null; reason: string | null; since: number | null };
export type BanInfo = { until: number; reason: string | null; since: number | null };

const records = new Map<string, GuestRecord>();
const ipBans = new Map<string, IpBan>();
const localGuests = new Map<string, { name: string; ip: string; created: number }>();
const localIpBans = new Map<string, { until: number; reason: string | null; since: number | null }>();

function trim<K, V>(map: Map<K, V>, max = 5000) {
  if (map.size > max) map.delete(map.keys().next().value as K);
}

export async function guestRecord(id: string, maxAgeMs = CACHE_MS): Promise<GuestRecord> {
  const hit = records.get(id);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit;
  const entry: GuestRecord = { at: Date.now(), found: false, bannedUntil: null, banReason: null, bannedAt: null };
  if (!LOGS_ON) {
    entry.found = localGuests.has(id);
  } else {
    try {
      const res = await rest("GET", `guests?id=eq.${id}&select=*`, undefined, "");
      const row = ((await res.json()) as { banned_until?: string | null; ban_reason?: string | null; banned_at?: string | null }[])[0];
      if (row) {
        entry.found = true;
        entry.bannedUntil = row.banned_until ? Date.parse(row.banned_until) : null;
        entry.banReason = row.ban_reason ?? null;
        entry.bannedAt = row.banned_at ? Date.parse(row.banned_at) : null;
      }
    } catch (err) {
      console.warn("Couldn't read a guest:", (err as Error).message);
      if (hit) return hit;
      entry.found = true;
    }
  }
  records.set(id, entry);
  trim(records);
  return entry;
}

export async function ipBan(ip: string, maxAgeMs = CACHE_MS): Promise<BanInfo | null> {
  if (ip.startsWith("unknown")) return null;
  let hit = ipBans.get(ip);
  if (!hit || Date.now() - hit.at >= maxAgeMs) {
    const entry: IpBan = { at: Date.now(), until: null, reason: null, since: null };
    if (!LOGS_ON) {
      const b = localIpBans.get(ip);
      if (b) Object.assign(entry, b);
    } else {
      try {
        const res = await rest("GET", `ip_bans?ip=eq.${encodeURIComponent(ip)}&select=banned_until,reason,created_at`, undefined, "");
        const row = ((await res.json()) as { banned_until: string; reason: string | null; created_at?: string | null }[])[0];
        if (row) {
          entry.until = Date.parse(row.banned_until);
          entry.reason = row.reason ?? null;
          entry.since = row.created_at ? Date.parse(row.created_at) : null;
        }
      } catch (err) {
        console.warn("Couldn't read an address ban:", (err as Error).message);
        if (hit) return hit.until && hit.until > Date.now() ? { until: hit.until, reason: hit.reason, since: hit.since } : null;
      }
    }
    ipBans.set(ip, entry);
    trim(ipBans);
    hit = entry;
  }
  return hit.until && hit.until > Date.now() ? { until: hit.until, reason: hit.reason, since: hit.since } : null;
}

export async function guestBan(id: string, ip: string, maxAgeMs = CACHE_MS): Promise<BanInfo | null> {
  const rec = await guestRecord(id, maxAgeMs);
  if (rec.bannedUntil && rec.bannedUntil > Date.now()) return { until: rec.bannedUntil, reason: rec.banReason, since: rec.bannedAt };
  return ipBan(ip, maxAgeMs);
}

export function forgetGuest(id: string) {
  records.delete(id);
}
export function forgetIp(ip: string) {
  ipBans.delete(ip);
}

export function localIpBan(ip: string, until: number, reason: string | null) {
  localIpBans.set(ip, { until, reason, since: Date.now() });
  ipBans.delete(ip);
}

const seenAt = new Map<string, number>();

export function seenGuest(id: string, ip: string, req: IncomingMessage) {
  if (!LOGS_ON || ip.startsWith("unknown")) return;
  const key = id + "|" + ip;
  if (Date.now() - (seenAt.get(key) ?? 0) < MIN) return;
  seenAt.set(key, Date.now());
  trim(seenAt);
  const o = origin(req);
  rest("POST", "rpc/guest_seen", { guest: id, addr: ip, agent: o.user_agent, place: o.country }).catch((err) =>
    console.warn("Couldn't update a guest:", (err as Error).message)
  );
}

const pow = new ProofOfWork();
const challenges = new Map<string, { ch: Challenge; ip: string }>();
const perIp = new RateLimiter(PER_IP_BURST, PER_IP_REFILL);
const everyone = new RateLimiter(GLOBAL_BURST, GLOBAL_PER_SECOND);

export function guestChallenge(ip: string) {
  const ch = pow.issue(ip);
  ch.bits += EXTRA_BITS;
  challenges.set(ch.id, { ch, ip });
  if (challenges.size > 20_000) challenges.delete(challenges.keys().next().value as string);
  return { id: ch.id, bits: ch.bits };
}

async function createdToday(ip: string) {
  if (!LOGS_ON) {
    let n = 0;
    for (const g of localGuests.values()) if (g.ip === ip && Date.now() - g.created < DAY) n++;
    return n;
  }
  const since = new Date(Date.now() - DAY).toISOString();
  const res = await rest("GET", `guests?first_ip=eq.${encodeURIComponent(ip)}&created_at=gte.${since}&select=id`, undefined, "count=exact");
  const total = Number(String(res.headers.get("content-range") ?? "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

function newName() {
  return "guest" + String(randomInt(1_000_000, 10_000_000));
}

export async function createGuest(req: IncomingMessage, ip: string, challengeId: unknown, nonce: unknown) {
  const refuse = (code: string, message: string, status: number, extra: Record<string, unknown> = {}) => {
    logEvent("guest_refused", req, { status, detail: { code, ...extra } });
    return new GuestError(code, message, status, extra);
  };
  if (ip.startsWith("unknown")) throw refuse("no_address", "We can't read your address, so guest play isn't available. Sign in instead.", 403);
  const entry = typeof challengeId === "string" ? challenges.get(challengeId) : undefined;
  if (entry) challenges.delete(entry.ch.id);
  if (!entry || entry.ip !== ip || Date.now() - entry.ch.issuedAt > CHALLENGE_TTL_MS || typeof nonce !== "string" || !pow.check(entry.ch, nonce, ip)) {
    throw refuse("bad_pow", "Security check failed. Try again.", 400);
  }
  const ban = await ipBan(ip, 5000);
  if (ban) {
    throw refuse("ip_banned", "Guest play is suspended for your network.", 403, {
      until: new Date(ban.until).toISOString(),
      reason: ban.reason,
      since: ban.since ? new Date(ban.since).toISOString() : null,
    });
  }
  if (!perIp.take(ip)) throw refuse("too_many", "Too many guests from your network. Wait a few minutes, or sign in.", 429, { retryAfter: 120 });
  if (!everyone.take("all")) throw refuse("busy", "Too many new guests right now. Try again in a minute.", 429, { retryAfter: 60 });
  let today = 0;
  try {
    today = await createdToday(ip);
  } catch (err) {
    console.warn("Couldn't count guests:", (err as Error).message);
    throw refuse("unavailable", "Guest play is unavailable right now. Try again later.", 503);
  }
  if (today >= PER_IP_PER_DAY) {
    throw refuse("too_many", "Too many guests from your network today. Sign in to keep playing.", 429, { retryAfter: 60 * 60 });
  }

  const id = randomUUID();
  const o = origin(req);
  for (let attempt = 0; ; attempt++) {
    const name = newName();
    if (!LOGS_ON) {
      if ([...localGuests.values()].some((g) => g.name === name)) continue;
      localGuests.set(id, { name, ip, created: Date.now() });
      trim(localGuests, 50_000);
    } else {
      try {
        await rest("POST", "guests", {
          id,
          name,
          first_ip: ip,
          last_ip: ip,
          ips: [ip],
          last_seen_at: new Date().toISOString(),
          user_agent: o.user_agent,
          country: o.country,
        });
      } catch (err) {
        if (/: 409 /.test((err as Error).message) && attempt < 5) continue;
        console.warn("Couldn't create a guest:", (err as Error).message);
        throw refuse("unavailable", "Guest play is unavailable right now. Try again later.", 503);
      }
    }
    records.set(id, { at: Date.now(), found: true, bannedUntil: null, banReason: null, bannedAt: null });
    logEvent("guest_created", req, { userId: id, detail: { name } });
    const { token, exp } = issue(id, name);
    return { id, name, token, expiresAt: new Date(exp * 1000).toISOString() };
  }
}

export function sweepGuests() {
  const now = Date.now();
  for (const [id, e] of challenges) if (now - e.ch.issuedAt > CHALLENGE_TTL_MS) challenges.delete(id);
  perIp.sweep();
  everyone.sweep();
  pow.sweep();
}