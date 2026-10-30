import { createClient } from "@supabase/supabase-js";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const AUTH_OFF = import.meta.env.VITE_AUTH_DISABLED === "1";

const storage = {
  getItem(key: string) {
    try {
      return (key.endsWith("-code-verifier") ? localStorage : sessionStorage).getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      (key.endsWith("-code-verifier") ? localStorage : sessionStorage).setItem(key, value);
    } catch {
    }
  },
  removeItem(key: string) {
    try {
      (key.endsWith("-code-verifier") ? localStorage : sessionStorage).removeItem(key);
    } catch {
    }
  },
};

export const supabase =
  URL_ && KEY
    ? createClient(URL_, KEY, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "tempo.auth",
          storage,
        },
      })
    : null;

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function tokenRejected(): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.auth.refreshSession();
  if (!error) return true;
  await supabase.auth.signOut({ scope: "local" });
  return false;
}

export function wsProtocols(token: string | null) {
  return token ? ["tempo", "jwt." + token] : ["tempo"];
}

export function returnUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  for (const key of ["code", "error", "error_code", "error_description"]) url.searchParams.delete(key);
  return url.toString();
}

export function friendlyError(err: { message?: string; status?: number; code?: string } | null | undefined) {
  if (!err) return "";
  const m = (err.message ?? "").toLowerCase();
  const code = err.code ?? "";
  if (code === "invalid_credentials" || m.includes("invalid login credentials")) return "Wrong email or password.";
  if (code === "email_not_confirmed" || m.includes("email not confirmed")) {
    return "Confirm your email first: open the link we sent you.";
  }
  if (code === "user_already_exists" || m.includes("already registered")) {
    return "An account already uses this email. Sign in instead.";
  }
  if (code === "weak_password" || m.includes("password should")) return "Choose a stronger password (at least 8 characters, mixing letters and numbers).";
  if (code === "over_email_send_rate_limit" || m.includes("email rate limit")) {
    return "Too many emails were sent. Wait a few minutes and try again.";
  }
  if (err.status === 429 || code.includes("rate_limit")) return "Too many attempts. Wait a minute and try again.";
  if (code === "same_password") return "Choose a password different from your old one.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Can't reach the sign-in service. Check your internet.";
  return err.message || "Something went wrong. Try again.";
}