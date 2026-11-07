import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AUTH_OFF, cameFromConfirmation, hasLinkFailure, supabase, takeLinkFailure } from "./supabase";
import { GuestProblem, becomeGuest, checkGuest, dropGuest, onGuestChange, savedGuest, type Ban, type GuestPass } from "./guest";
import { banEnds } from "./banText.ts";

export type Role = "user" | "admin";

export type Account = {
  id: string;
  email: string | null;
  name: string;
  role: Role;
  banned: Ban | null;
  guest?: boolean;
};

export type SignInPrompt = { tone: "notice" | "error"; text: string; email?: string };

type AuthState = {
  status: "loading" | "signed_out" | "signed_in" | "recovery";
  account: Account | null;
  signOut: () => Promise<void>;
  finishRecovery: () => void;
  playAsGuest: () => Promise<void>;
  guestError: string;
  prompt: SignInPrompt | null;
  askSignIn: (p: SignInPrompt) => void;
  clearPrompt: () => void;
  holdSessions: (on: boolean) => void;
};

const AuthContext = createContext<AuthState>({
  status: "loading",
  account: null,
  signOut: async () => {},
  finishRecovery: () => {},
  playAsGuest: async () => {},
  guestError: "",
  prompt: null,
  askSignIn: () => {},
  clearPrompt: () => {},
  holdSessions: () => {},
});

const ADMIN_PAGE = typeof location !== "undefined" && /^\/admin(\/|$)/.test(location.pathname);
const AUTO_GUEST_TRIES = 2;

export function useAuth() {
  return useContext(AuthContext);
}

const TEST_ACCOUNT: Account = { id: "test", email: null, name: "You", role: "user", banned: null };

export function guestProblemText(p: GuestProblem) {
  let text = p.message;
  if (p.code === "ip_banned" && p.until) {
    const ban: Ban = { until: p.until, reason: p.reason, since: p.since };
    text = text.replace(/\.$/, "") + " " + banEnds(ban) + ". You can still sign in with an account.";
    text += ` Reason: ${p.reason || "none given"}.`;
  }
  return text;
}

const DEVICE_BAN = "tempo.banned";

function rememberBan(ban: Ban | null) {
  try {
    if (ban) localStorage.setItem(DEVICE_BAN, JSON.stringify(ban));
    else localStorage.removeItem(DEVICE_BAN);
  } catch {
  }
}

function deviceBan(): Ban | null {
  try {
    const raw = localStorage.getItem(DEVICE_BAN);
    const ban = raw ? (JSON.parse(raw) as Ban) : null;
    if (ban && Date.parse(ban.until) > Date.now()) return ban;
    if (raw) localStorage.removeItem(DEVICE_BAN);
  } catch {
  }
  return null;
}

function deviceBanProblem(ban: Ban) {
  return new GuestProblem(
    "device_banned",
    `An account on this device is suspended ${banEnds(ban)}, so guest play is off here until then. You can sign in with another account.`
  );
}

function guestAccount(pass: GuestPass, banned: Account["banned"] = null): Account {
  return { id: pass.id, email: null, name: pass.name, role: "user", banned, guest: true };
}

function fallbackName(session: Session) {
  const meta = session.user.user_metadata ?? {};
  const name = meta.display_name || meta.full_name || meta.name || session.user.email?.split("@")[0] || "Player";
  return String(name).slice(0, 24);
}

async function loadAccount(session: Session): Promise<Account> {
  const base: Account = { id: session.user.id, email: session.user.email ?? null, name: fallbackName(session), role: "user", banned: null };
  if (!supabase) return base;
  try {
    const read = (columns: string) =>
      withTimeout(Promise.resolve(supabase!.from("profiles").select(columns).eq("id", session.user.id).maybeSingle()), 6000);
    let { data, error } = await read("display_name, role, banned_until, ban_reason, banned_at");
    if (error && /banned_at/.test(error.message)) ({ data, error } = await read("display_name, role, banned_until, ban_reason"));
    if (error) console.warn("Couldn't read your profile:", error.message);
    const row = data as { display_name?: string; role?: string; banned_until?: string | null; ban_reason?: string | null; banned_at?: string | null } | null;
    return {
      ...base,
      name: row?.display_name || base.name,
      role: row?.role === "admin" ? "admin" : "user",
      banned:
        row?.banned_until && Date.parse(row.banned_until) > Date.now()
          ? { until: row.banned_until, reason: row.ban_reason ?? null, since: row.banned_at ?? null }
          : null,
    };
  } catch (err) {
    console.warn("Couldn't read your profile:", (err as Error).message);
    return base;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer after ${ms / 1000} s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>(AUTH_OFF ? "signed_in" : "loading");
  const [account, setAccount] = useState<Account | null>(AUTH_OFF ? TEST_ACCOUNT : null);
  const [guestError, setGuestError] = useState("");
  const [prompt, setPrompt] = useState<SignInPrompt | null>(() =>
    !AUTH_OFF && hasLinkFailure() ? { tone: "error", text: takeLinkFailure() } : null
  );
  const held = useRef(0);
  const recheck = useRef<() => void>(() => {});

  useEffect(() => {
    if (AUTH_OFF) return;
    let alive = true;
    let tries = 0;
    let making: Promise<GuestPass> | null = null;
    const makeGuest = () => {
      if (!making) {
        tries += 1;
        making = becomeGuest().finally(() => {
          making = null;
        });
      }
      return making;
    };
    const applyGuest = async () => {
      const blocked = deviceBan();
      if (blocked) {
        if (alive) {
          setGuestError(deviceBanProblem(blocked).message);
          setAccount(null);
          setStatus("signed_out");
        }
        return;
      }
      let pass = savedGuest();
      if (!pass) {
        if (ADMIN_PAGE || tries >= AUTO_GUEST_TRIES) {
          if (alive) {
            setAccount(null);
            setStatus("signed_out");
          }
          return;
        }
        try {
          pass = await makeGuest();
          if (alive) setGuestError("");
        } catch (err) {
          if (alive) {
            setGuestError(err instanceof GuestProblem ? guestProblemText(err) : "Couldn't start a guest game. Try again.");
            setAccount(null);
            setStatus("signed_out");
          }
          return;
        }
      }
      if (alive) {
        setAccount(guestAccount(pass));
        setStatus("signed_in");
      }
      const check = await checkGuest(pass);
      if (!alive || savedGuest()?.id !== pass.id) return;
      if (!check.ok) {
        dropGuest();
        return;
      }
      if (check.banned) setAccount(guestAccount(pass, check.banned));
    };
    const stopGuest = onGuestChange(() => void applyGuest());
    const onBanned = async () => {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      if (session) {
        const acc = await loadAccount(session);
        if (!alive) return;
        if (acc.banned) {
          rememberBan(acc.banned);
          setAccount(acc);
          return;
        }
      } else {
        const pass = savedGuest();
        const check = pass ? await checkGuest(pass) : null;
        if (!alive) return;
        if (pass && check?.ok && check.banned) {
          setAccount(guestAccount(pass, check.banned));
          return;
        }
      }
      window.location.reload();
    };
    const banListener = () => void onBanned();
    window.addEventListener("tempo:banned", banListener);
    if (!supabase) {
      void applyGuest();
      return () => {
        alive = false;
        stopGuest();
        window.removeEventListener("tempo:banned", banListener);
      };
    }
    let confirming = cameFromConfirmation();
    const apply = async (session: Session | null, recovery = false) => {
      if (session && confirming && !recovery) {
        confirming = false;
        held.current += 1;
        await supabase!.auth.signOut({ scope: "local" }).catch(() => undefined);
        held.current -= 1;
        if (alive) setPrompt({ tone: "notice", text: "Your email is confirmed. Sign in to start playing.", email: session.user.email ?? "" });
        await applyGuest();
        return;
      }
      if (!session && confirming) {
        confirming = false;
        if (alive) setPrompt({ tone: "notice", text: "Your email is confirmed. Sign in to start playing." });
      }
      if (!session || (held.current > 0 && !recovery)) {
        await applyGuest();
        return;
      }
      const acc = await loadAccount(session);
      if (!alive) return;
      const now = await supabase!.auth.getSession().catch(() => null);
      if (!alive || !now?.data.session) return;
      setPrompt(null);
      rememberBan(acc.banned);
      setAccount(acc);
      setStatus((s) => (recovery || s === "recovery" ? "recovery" : "signed_in"));
    };
    const client = supabase;
    recheck.current = () => {
      void client.auth.getSession().then(({ data }) => apply(data.session));
    };
    withTimeout(client.auth.getSession(), 8000)
      .then(({ data, error }) => {
        if (error) console.warn("Couldn't read the saved session:", error.message);
        return apply(data.session);
      })
      .catch((err) => {
        console.warn("Sign-in service didn't answer:", (err as Error).message);
        void apply(null);
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (event === "PASSWORD_RECOVERY") void apply(session, true);
        else if (event === "SIGNED_OUT") void apply(null);
        else if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") void apply(session);
      }, 0);
    });
    return () => {
      alive = false;
      stopGuest();
      window.removeEventListener("tempo:banned", banListener);
      data.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    status,
    account,
    signOut: async () => {
      if (account?.guest) {
        dropGuest();
        return;
      }
      if (!supabase) return;
      await supabase.auth.signOut();
    },
    finishRecovery: () => setStatus("signed_in"),
    playAsGuest: async () => {
      const blocked = deviceBan();
      if (blocked) throw deviceBanProblem(blocked);
      const pass = await becomeGuest();
      setGuestError("");
      setAccount(guestAccount(pass));
      setStatus("signed_in");
    },
    guestError,
    prompt,
    askSignIn: setPrompt,
    clearPrompt: () => setPrompt(null),
    holdSessions: (on) => {
      held.current = Math.max(0, held.current + (on ? 1 : -1));
      if (!on && held.current === 0) recheck.current();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}