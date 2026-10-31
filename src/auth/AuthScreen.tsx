import "./AuthScreen.css";
import { useEffect, useState, type FormEvent } from "react";
import { LINK_MINUTES, RESEND_WAIT_S, friendlyError, linkLifetime, returnUrl, supabase, takeLinkFailure } from "./supabase";
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

type Sent = { kind: "signup" | "reset"; email: string; at: number; again: boolean };

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function left(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s > 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
  if (s >= 60) return `${Math.ceil(s / 60)} min`;
  return `${s} s`;
}

function LinkNotice({ sent, onResend, busy }: { sent: Sent; onResend: () => void; busy: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const expires = sent.at + LINK_MINUTES * 60_000;
  const expired = now >= expires;
  const wait = sent.at + RESEND_WAIT_S * 1000 - now;
  const what = sent.kind === "signup" ? "confirm your account" : "choose a new password";
  return (
    <div className={"auth-notice auth-link-notice" + (expired ? " is-expired" : "")} role="status">
      <p className="auth-link-main">
        {sent.kind === "signup" ? (
          <>
            {sent.again ? "New link sent" : "Almost done! We sent a link"} to <strong>{sent.email}</strong>. Open it to {what}, then sign in.
          </>
        ) : (
          <>
            {sent.again ? "New link sent." : "Reset link on its way."} If an account uses <strong>{sent.email}</strong>, open the link to {what}.
          </>
        )}
      </p>
      <div className="auth-expiry">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 9v4l2.5 2M9.5 3h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {expired ? (
          <span>
            <strong>This link has expired.</strong> Ask for a new one.
          </span>
        ) : (
          <span>
            Works <strong>once</strong>, until <strong>{clock(expires)}</strong> ({left(expires - now)} left)
          </span>
        )}
      </div>
      {!expired && (
        <div className="auth-expiry-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, ((expires - now) / (LINK_MINUTES * 60_000)) * 100))}%` }} />
        </div>
      )}
      <p className="auth-link-help">
        Each link works for {linkLifetime()}. Nothing arrived? Check your spam folder. Asking for a new link cancels the previous one.
      </p>
      <button type="button" className="auth-link auth-resend" onClick={onResend} disabled={busy || wait > 0}>
        {wait > 0 ? `Send a new link in ${left(wait)}` : busy ? "Sending…" : "Send a new link"}
      </button>
    </div>
  );
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
  const [sent, setSent] = useState<Sent | null>(null);

  useEffect(() => {
    const problem = takeLinkFailure();
    if (problem) setError(problem);
  }, []);

  function go(next: Mode) {
    setMode(next);
    setError("");
    setSent(null);
    setPassword("");
  }

  async function resend() {
    if (!supabase || !sent || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: err } =
        sent.kind === "signup"
          ? await supabase.auth.resend({ type: "signup", email: sent.email, options: { emailRedirectTo: returnUrl() } })
          : await supabase.auth.resetPasswordForEmail(sent.email, { redirectTo: returnUrl() });
      if (err) setError(friendlyError(err));
      else setSent({ ...sent, at: Date.now(), again: true });
    } catch (err) {
      setError(friendlyError(err as Error));
    } finally {
      setBusy(false);
    }
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
    setSent(null);

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
          setSent({ kind: "signup", email: mail, at: Date.now(), again: false });
          setPassword("");
        }
      } else if (mode === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: returnUrl() });
        if (err) setError(friendlyError(err));
        else setSent({ kind: "reset", email: mail, at: Date.now(), again: false });
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
          {sent && <LinkNotice sent={sent} onResend={() => void resend()} busy={busy} />}

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