import { t, translateMessage } from "../i18n";
import { apiBase } from "./guest";

export type EmailKind = "signup" | "recovery";

export type Permit = { ok: true; nextAt: number } | { ok: false; nextAt: number | null; message: string };

export const WAIT_STEPS = t("5 min, then 10, 20, 40, 80 min, then a day");

const FIRST_WAIT_MS = 5 * 60_000;

export async function askEmailPermit(email: string, kind: EmailKind): Promise<Permit> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/email-permit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, kind }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: true, nextAt: Date.now() + FIRST_WAIT_MS };
  }
  const body = (await res.json().catch(() => ({}))) as { nextAt?: string; message?: string };
  const nextAt = body.nextAt ? Date.parse(body.nextAt) : null;
  if (res.ok) return { ok: true, nextAt: nextAt ?? Date.now() + FIRST_WAIT_MS };
  if (res.status >= 500) return { ok: true, nextAt: Date.now() + FIRST_WAIT_MS };
  return { ok: false, nextAt, message: body.message ? translateMessage(body.message) : t("Too many emails for this address. Try again later.") };
}