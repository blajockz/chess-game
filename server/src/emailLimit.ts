import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { LOGS_ON, logEvent, rest } from "./logs.js";
import { RateLimiter } from "./limits.js";

const SCALE = Number(process.env.EMAIL_WAIT_SCALE) || 1;
const MIN = 60;
const WAITS = [5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN, 80 * MIN, 24 * 60 * MIN].map((s) => Math.max(1, Math.round(s * SCALE)));
const WINDOW = Math.max(1, Math.round(24 * 60 * MIN * SCALE));

const perIp = new RateLimiter(30, 60 / 3600);

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,63}$/i;
export type EmailKind = "signup" | "recovery";

const SECRET: Buffer = (() => {
  const own = process.env.GUEST_SECRET ?? "";
  if (own.length >= 32) return createHmac("sha256", own).update("tempo-email-limit-v1").digest();
  const supa = process.env.SUPABASE_SECRET_KEY ?? "";
  if (supa) return createHmac("sha256", supa).update("tempo-email-limit-v1").digest();
  return randomBytes(32);
})();

function keyOf(email: string) {
  return createHmac("sha256", SECRET).update(email.trim().toLowerCase()).digest("hex");
}

export async function clearEmailLimit(email: string) {
  const key = keyOf(email);
  for (const kind of ["signup", "recovery", "email_change"]) local.delete(`${kind}:${key}`);
  if (LOGS_ON) await rest("DELETE", `email_sends?key=eq.${key}`);
}

const local = new Map<string, { count: number; last: number }>();

function localPermit(key: string) {
  const now = Date.now();
  const row = local.get(key) ?? { count: 0, last: 0 };
  let count = now - row.last > WINDOW * 1000 ? 0 : row.count;
  if (count > 0) {
    const next = row.last + WAITS[Math.min(count, WAITS.length) - 1] * 1000;
    if (now < next) return { allowed: false, nextAt: new Date(next).toISOString(), sent: count };
  }
  count += 1;
  local.set(key, { count, last: now });
  if (local.size > 50_000) local.delete(local.keys().next().value as string);
  return { allowed: true, nextAt: new Date(now + WAITS[Math.min(count, WAITS.length) - 1] * 1000).toISOString(), sent: count };
}

export class EmailLimitError extends Error {
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

export async function emailPermit(req: IncomingMessage, ip: string, email: unknown, kind: unknown, signedIn = false) {
  if (typeof email !== "string" || email.length > 320 || !EMAIL.test(email.trim())) {
    throw new EmailLimitError(400, "bad_email", "Enter a valid email address.");
  }
  if (kind !== "signup" && kind !== "recovery" && !(kind === "email_change" && signedIn)) {
    throw new EmailLimitError(400, "bad_kind", "Unknown email type.");
  }
  if (!perIp.take(ip)) {
    throw new EmailLimitError(429, "too_many", "Too many email requests from your network. Try again later.", { retryAfter: 600 });
  }
  const key = keyOf(email);
  let result: { allowed: boolean; nextAt: string; sent: number };
  if (!LOGS_ON) result = localPermit(`${kind}:${key}`);
  else {
    try {
      const res = await rest(
        "POST",
        "rpc/email_send_permit",
        { p_key: key, p_kind: kind, p_waits: WAITS, p_window: WINDOW },
        ""
      );
      const row = ((await res.json()) as { allowed: boolean; next_at: string; sent: number }[])[0];
      result = { allowed: row.allowed, nextAt: new Date(row.next_at).toISOString(), sent: row.sent };
    } catch (err) {
      console.warn("Couldn't check the email limit:", (err as Error).message);
      result = localPermit(`${kind}:${key}`);
    }
  }
  if (!result.allowed) {
    logEvent("email_limited", req, { status: 429, detail: { kind, sent: result.sent } });
    const minutes = Math.max(1, Math.ceil((Date.parse(result.nextAt) - Date.now()) / 60_000));
    throw new EmailLimitError(429, "wait", `An email was already sent to this address. You can ask for a new one in ${minutes} min.`, {
      nextAt: result.nextAt,
    });
  }
  return { ok: true, nextAt: result.nextAt, sent: result.sent };
}

let prunedAt = 0;

export function sweepEmailLimits() {
  perIp.sweep();
  if (!LOGS_ON || Date.now() - prunedAt < 6 * 3600_000) return;
  prunedAt = Date.now();
  rest("POST", "rpc/prune_email_sends", {}).catch(() => undefined);
}