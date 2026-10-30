import { accessToken } from "../auth/supabase";
import { newKeyPair, open, seal, sharedKey } from "./crypto";

export class AdminError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const BASE = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8787` : "";

async function reach(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw new AdminError(
      "server_unreachable",
      import.meta.env.DEV
        ? "Can't reach the Tempo server on port 8787. Is it running (npm run dev in the server folder)?"
        : "Can't reach the Tempo server. Check your internet, or try again in a minute."
    );
  }
}

export class AdminClient {
  private key: CryptoKey | null = null;
  private session: string | null = null;
  private n = 0;
  idleMs = 15 * 60 * 1000;

  get open() {
    return this.session !== null;
  }

  async start() {
    const token = await accessToken();
    if (!token) throw new AdminError("not_signed_in", "Sign in first.");
    const mine = await newKeyPair();
    const res = await reach(BASE + "/api/admin/session", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ pub: mine.publicB64 }),
      credentials: "omit",
    });
    const body = (await res.json().catch(() => ({}))) as { session?: string; pub?: string; idleMs?: number; error?: string };
    if (!res.ok || !body.session || !body.pub) throw new AdminError(body.error ?? "failed", messageFor(body.error));
    this.key = await sharedKey(mine, body.pub, body.session);
    this.session = body.session;
    this.n = 0;
    if (body.idleMs) this.idleMs = body.idleMs;
  }

  async call<T = Record<string, unknown>>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this.key || !this.session) throw new AdminError("session_expired", messageFor("session_expired"));
    const token = await accessToken();
    const n = ++this.n;
    const envelope = await seal(this.key, `tempo-admin|req|${n}`, { op, args });
    const res = await reach(BASE + "/api/admin/rpc", {
      method: "POST",
      headers: {
        authorization: "Bearer " + (token ?? ""),
        "x-admin-session": this.session,
        "content-type": "application/json",
      },
      body: JSON.stringify({ n, ...envelope }),
      credentials: "omit",
    });
    const body = (await res.json().catch(() => ({}))) as { n?: number; iv?: string; ct?: string; error?: string };
    if (!res.ok || !body.iv || !body.ct || body.n !== n) {
      if (res.status === 401 || res.status === 403) this.forget();
      throw new AdminError(body.error ?? "failed", messageFor(body.error));
    }
    const result = (await open(this.key, `tempo-admin|res|${n}`, body.iv, body.ct)) as T & { error?: string; message?: string };
    if (result && typeof result === "object" && "error" in result && result.error) {
      throw new AdminError(result.error, result.message ?? messageFor(result.error));
    }
    return result;
  }

  async end() {
    if (!this.session) return;
    try {
      await this.call("logout");
    } catch {
    }
    this.forget();
  }

  endOnExit() {
    if (!this.session) return;
    const blob = new Blob([JSON.stringify({ session: this.session })], { type: "text/plain" });
    navigator.sendBeacon?.(BASE + "/api/admin/end", blob);
    this.forget();
  }

  forget() {
    this.key = null;
    this.session = null;
  }
}

export function messageFor(code?: string) {
  switch (code) {
    case "not_signed_in":
      return "Sign in first.";
    case "mfa_required":
      return "Two-step verification is required for the admin page.";
    case "not_admin":
      return "This account isn't an admin.";
    case "banned":
      return "This account is suspended.";
    case "login_again":
      return "For security, enter your password and a new code again.";
    case "too_many_attempts":
      return "Too many attempts. Wait a few minutes.";
    case "session_expired":
      return "The admin session ended. Sign in again.";
    case "session_moved":
      return "Your network or browser changed, so the admin session was closed. Sign in again.";
    case "audit_unavailable":
      return "The audit log can't be written right now, so the admin page is closed. Try again later.";
    case "slow_down":
      return "Too many actions at once. Wait a moment.";
    default:
      return "Something went wrong. Try again.";
  }
}