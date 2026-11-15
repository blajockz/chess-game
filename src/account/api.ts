import { t, translateMessage } from "../i18n";
import { accessToken } from "../auth/supabase";
import { apiBase } from "../auth/guest";

export type AccountInfo = { name: string; nameChangedAt: string | null; nextNameChangeAt: string | null };

export class AccountProblem extends Error {
  code: string;
  nextNameChangeAt: string | null;
  constructor(code: string, message: string, next: string | null = null) {
    super(message);
    this.code = code;
    this.nextNameChangeAt = next;
  }
}

async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/account${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AccountProblem("offline", t("Can't reach the Shatranj server. Try again in a moment."));
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; nextNameChangeAt?: string };
  if (!res.ok) throw new AccountProblem(data.error ?? "failed", data.message ? translateMessage(data.message) : t("Something went wrong."), data.nextNameChangeAt ?? null);
  return data as T;
}

export const accountApi = {
  get: () => call<AccountInfo>(""),
  rename: (name: string) => call<AccountInfo>("/name", { name }),
  emailPermit: (email: string) => call<{ ok: true; nextAt?: string }>("/email-permit", { email }),
};