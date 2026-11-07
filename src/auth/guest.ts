import { solvePow } from "../../shared/pow";
import { DEFAULT_PORT } from "../../shared/protocol";

const KEY = "tempo.guest";

export type GuestPass = { id: string; name: string; token: string; expiresAt: string };

export class GuestProblem extends Error {
  code: string;
  until: string | null;
  reason: string | null;
  since: string | null;
  constructor(code: string, message: string, until: string | null = null, reason: string | null = null, since: string | null = null) {
    super(message);
    this.code = code;
    this.until = until;
    this.reason = reason;
    this.since = since;
  }
}

export function apiBase() {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:${DEFAULT_PORT}`;
  return "";
}

const listeners = new Set<() => void>();

export function onGuestChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function savedGuest(): GuestPass | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as GuestPass;
    if (typeof g?.token !== "string" || typeof g.name !== "string" || typeof g.id !== "string") return null;
    if (!(Date.parse(g.expiresAt) > Date.now() + 60_000)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return g;
  } catch {
    return null;
  }
}

export function dropGuest() {
  try {
    localStorage.removeItem(KEY);
  } catch {
  }
  listeners.forEach((fn) => fn());
}

function yieldToPage() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function networkProblem(): GuestProblem {
  return new GuestProblem(
    "server_unreachable",
    import.meta.env.DEV
      ? "Can't reach the Tempo server on port 8787. Is it running (npm run dev in the server folder)?"
      : "Can't reach the Tempo server. Check your internet, or try again in a minute."
  );
}

export async function becomeGuest(): Promise<GuestPass> {
  let res: Response;
  try {
    const challenge = (await (await fetch(apiBase() + "/api/guest", { cache: "no-store" })).json()) as { id: string; bits: number };
    const nonce = await solvePow(challenge.id, challenge.bits, yieldToPage);
    res = await fetch(apiBase() + "/api/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: challenge.id, nonce }),
    });
  } catch {
    throw networkProblem();
  }
  const body = (await res.json().catch(() => ({}))) as Partial<GuestPass> & {
    error?: string;
    message?: string;
    until?: string;
    reason?: string | null;
    since?: string | null;
  };
  if (!res.ok || typeof body.token !== "string") {
    throw new GuestProblem(
      body.error ?? "failed",
      body.message ?? "Couldn't start a guest game. Try again.",
      body.until ?? null,
      body.reason ?? null,
      body.since ?? null
    );
  }
  const pass: GuestPass = { id: body.id!, name: body.name!, token: body.token, expiresAt: body.expiresAt! };
  try {
    localStorage.setItem(KEY, JSON.stringify(pass));
  } catch {
  }
  return pass;
}

export type Ban = { until: string; reason: string | null; since?: string | null };

export type GuestCheck = { ok: true; banned: Ban | null } | { ok: false };

export async function checkGuest(pass: GuestPass): Promise<GuestCheck> {
  try {
    const res = await fetch(apiBase() + "/api/me", {
      headers: { authorization: "Bearer " + pass.token },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 401) return { ok: false };
    if (!res.ok) return { ok: true, banned: null };
    const body = (await res.json()) as { banned?: Ban | null };
    return { ok: true, banned: body.banned ?? null };
  } catch {
    return { ok: true, banned: null };
  }
}