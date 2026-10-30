import "./AuthScreen.css";
import { useState, type FormEvent } from "react";
import { friendlyError, returnUrl, supabase } from "./supabase";
import { useAuth } from "./AuthProvider";

type Mode = "signin" | "signup" | "forgot" | "reset";

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const NAME = /^\p{L}+(?:[ '-]\p{L}+)*$/u;

export function nameProblem(raw: string) {
  const n = raw.trim();
  if (/\d/.test(n)) return "Your name can't contain numbers.";
  if ([...n].length < 2 || [...n].length > 24) return "Your name must be 2 to 24 letters long.";
  if (!NAME.test(n)) return "Use letters only (spaces, - and ' are allowed between words).";
  return "";
}

const GOOGLE_ON = import.meta.env.VITE_GOOGLE_AUTH === "1";

export const MIN_PASSWORD = 8;

export const PASSWORD_RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: `At least ${MIN_PASSWORD} characters`, ok: (p) => p.length >= MIN_PASSWORD },
  { label: "An uppercase letter (A–Z)", ok: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter (a–z)", ok: (p) => /[a-z]/.test(p) },
  { label: "A number (0–9)", ok: (p) => /[0-9]/.test(p) },
  { label: "A symbol (! @ # $ % …)", ok: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

function passwordProblem(p: string) {
  const missing = PASSWORD_RULES.filter((r) => !r.ok(p));
  return missing.length ? "Your password needs: " + missing.map((r) => r.label.toLowerCase()).join(", ") + "." : "";
}

export default function AuthScreen({ recovery = false }: { recovery?: boolean }) {
  const { finishRecovery } = useAuth();
  const [mode, setMode] = useState<Mode>(recovery ? "reset" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function go(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
  }

  async function google() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: returnUrl() },
    });
    if (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || busy) return;
    setError("");
    setNotice("");

    const mail = email.trim().toLowerCase();
    if (mode !== "reset" && (!EMAIL.test(mail) || mail.includes(".."))) {
      return setError("Enter a valid email address, like name@example.com.");
    }
    if (mode === "signup") {
      const problem = nameProblem(name);
      if (problem) return setError(problem);
    }
    if (mode === "signup" || mode === "reset") {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
    }
    if (mode === "signin" && !password) return setError("Enter your password.");

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: mail, password });
        if (err) setError(friendlyError(err));
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: mail,
          password,
          options: { data: { display_name: name.trim().replace(/\s+/g, " ") }, emailRedirectTo: returnUrl() },
        });
        if (err) setError(friendlyError(err));
        else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError("An account already uses this email. Sign in instead, or use “Forgot it?” to reset the password.");
        }
        else if (!data.session) {
          setNotice(`Almost done! We sent a link to ${mail}. Open it to confirm your account, then sign in.`);
          setPassword("");
        }
      } else if (mode === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: returnUrl() });
        if (err) setError(friendlyError(err));
        else setNotice(`If an account uses ${mail}, a reset link is on its way.`);
      } else {
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) setError(friendlyError(err));
        else finishRecovery();
      }
    } catch (err) {
      setError(friendlyError(err as Error));
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    signin: "Welcome back",
    signup: "Create your account",
    forgot: "Reset your password",
    reset: "Choose a new password",
  };
  const buttons: Record<Mode, string> = {
    signin: "Sign in",
    signup: "Create account",
    forgot: "Send reset link",
    reset: "Save new password",
  };

  if (!supabase) {
    return (
      <main className="auth">
        <div className="auth-card">
          <img className="auth-logo" src="/favicon.svg" alt="" width={56} height={56} />
          <h1 className="auth-title">Sign-in isn't set up</h1>
          <p className="auth-text">
            VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing. Add them to the .env file (and to Render),
            then build again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <img className="auth-logo" src="/favicon.svg" alt="" width={56} height={56} />
        <p className="auth-brand">Tempo</p>
        <h1 className="auth-title">{titles[mode]}</h1>

        {(mode === "signin" || mode === "signup") && (
          <div className="auth-tabs" role="tablist">
            <button role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "is-on" : ""} onClick={() => go("signin")}>
              Sign in
            </button>
            <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-on" : ""} onClick={() => go("signup")}>
              Create account
            </button>
          </div>
        )}

        {GOOGLE_ON && (mode === "signin" || mode === "signup") && (
          <>
            <button className="auth-google" onClick={google} disabled={busy} type="button">
              Continue with Google
            </button>
            <p className="auth-or">
              <span>or with your email</span>
            </p>
          </>
        )}

        {mode === "forgot" && <p className="auth-text">Enter your email. We'll send you a link to choose a new password.</p>}

        <form className="auth-form" onSubmit={submit} noValidate>
          {mode === "signup" && (
            <label>
              <span>Name shown to other players</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
                maxLength={24}
                placeholder="e.g. Yassine"
                name="name"
              />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                name="email"
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label>
              <span className="auth-label-row">
                {mode === "reset" ? "New password" : "Password"}
                {mode === "signin" && (
                  <button type="button" className="auth-link" onClick={() => go("forgot")}>
                    Forgot it?
                  </button>
                )}
              </span>
              <span className="auth-password">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  name="password"
                />
                <button type="button" className="auth-show" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                  {show ? "Hide" : "Show"}
                </button>
              </span>
              {(mode === "signup" || mode === "reset") && (
                <ul className="auth-rules" aria-label="Password rules">
                  {PASSWORD_RULES.map((r) => (
                    <li key={r.label} className={r.ok(password) ? "is-ok" : ""}>
                      {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </label>
          )}

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait…" : buttons[mode]}
          </button>
        </form>

        {mode === "forgot" && (
          <button className="auth-link auth-back" onClick={() => go("signin")}>
            ← Back to sign in
          </button>
        )}
        {(mode === "signin" || mode === "signup") && (
          <p className="auth-small">Signing in keeps games fair and protects them from spam and cheating.</p>
        )}
      </div>
    </main>
  );
}