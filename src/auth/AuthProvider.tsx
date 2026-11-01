import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AUTH_OFF, supabase } from "./supabase";
import { becomeGuest, checkGuest, dropGuest, onGuestChange, savedGuest, type GuestPass } from "./guest";

export type Role = "user" | "admin";

export type Account = {
  id: string;
  email: string | null;
  name: string;
  role: Role;
  banned: { until: string; reason: string | null } | null;
  guest?: boolean;
};

type AuthState = {
  status: "loading" | "signed_out" | "signed_in" | "recovery";
  account: Account | null;
  signOut: () => Promise<void>;
  finishRecovery: () => void;
  playAsGuest: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  status: "loading",
  account: null,
  signOut: async () => {},
  finishRecovery: () => {},
  playAsGuest: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const TEST_ACCOUNT: Account = { id: "test", email: null, name: "You", role: "user", banned: null };

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
    const query = supabase.from("profiles").select("display_name, role, banned_until, ban_reason").eq("id", session.user.id).maybeSingle();
    const { data, error } = await withTimeout(Promise.resolve(query), 6000);
    if (error) console.warn("Couldn't read your profile:", error.message);
    return {
      ...base,
      name: data?.display_name || base.name,
      role: data?.role === "admin" ? "admin" : "user",
      banned:
        data?.banned_until && Date.parse(data.banned_until) > Date.now()
          ? { until: data.banned_until, reason: data.ban_reason ?? null }
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

  useEffect(() => {
    if (AUTH_OFF) return;
    let alive = true;
    const applyGuest = async () => {
      const pass = savedGuest();
      if (!pass) {
        if (alive) {
          setAccount(null);
          setStatus("signed_out");
        }
        return;
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
    if (!supabase) {
      void applyGuest();
      return () => {
        alive = false;
        stopGuest();
      };
    }
    const apply = async (session: Session | null, recovery = false) => {
      if (!session) {
        await applyGuest();
        return;
      }
      if (savedGuest()) {
        try {
          localStorage.removeItem("tempo.guest");
        } catch {
        }
      }
      const acc = await loadAccount(session);
      if (!alive) return;
      setAccount(acc);
      setStatus((s) => (recovery || s === "recovery" ? "recovery" : "signed_in"));
    };
    const client = supabase;
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
      const pass = await becomeGuest();
      setAccount(guestAccount(pass));
      setStatus("signed_in");
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}