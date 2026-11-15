import { t } from "../i18n";
import "./AuthScreen.css";
import "./GoogleButton.css";
import { useEffect, useState, type FormEvent } from "react";
import { LINK_MINUTES, confirmUrl, friendlyError, linkLifetime, returnUrl, supabase } from "./supabase";
import { WAIT_STEPS, askEmailPermit } from "./emailPermit";
import { guestProblemText, useAuth } from "./AuthProvider";
import { GuestProblem } from "./guest";
import Captcha, { CAPTCHA_ON } from "./Captcha";
import { useAuthFonts } from "./authFonts";
import LanguagePicker from "../i18n/LanguagePicker";

type Mode = "signin" | "signup" | "forgot" | "reset";

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const NAME = /^\p{L}+(?:[ '-]\p{L}+)*$/u;

export function nameProblem(raw: string) {
  const n = raw.trim();
  if (/\d/.test(n)) return t("Your name can't contain numbers.");
  if ([...n].length < 2 || [...n].length > 24) return t("Your name must be 2 to 24 letters long.");
  if (!NAME.test(n)) return t("Use letters only (spaces, - and ' are allowed between words).");
  return "";
}

const GOOGLE_ON = import.meta.env.VITE_GOOGLE_AUTH === "1";

export const MIN_PASSWORD = 8;

export const PASSWORD_RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: t("At least {MIN_PASSWORD} characters", { MIN_PASSWORD }), ok: (p) => p.length >= MIN_PASSWORD },
  { label: t("An uppercase letter (A–Z)"), ok: (p) => /[A-Z]/.test(p) },
  { label: t("A lowercase letter (a–z)"), ok: (p) => /[a-z]/.test(p) },
  { label: t("A number (0–9)"), ok: (p) => /[0-9]/.test(p) },
  { label: t("A symbol (! @ # $ % …)"), ok: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

function passwordProblem(p: string) {
  const missing = PASSWORD_RULES.filter((r) => !r.ok(p));
  return missing.length ? t("Your password needs: ") + missing.map((r) => r.label.toLowerCase()).join(", ") + "." : "";
}

type Sent = { kind: "signup" | "reset"; email: string; at: number; again: boolean; nextAt: number };

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function left(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s > 3600) return t("{v1} h {v2} min", { v1: Math.floor(s / 3600), v2: String(Math.floor((s % 3600) / 60)).padStart(2, "0") });
  if (s >= 60) return t("{mins} min", { mins: Math.ceil(s / 60) });
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
  const wait = sent.nextAt - now;
  const what = sent.kind === "signup" ? t("confirm your account") : t("choose a new password");
  return (
    <div className={"auth-notice auth-link-notice" + (expired ? " is-expired" : "")} role="status">
      <p className="auth-link-main">
        {sent.kind === "signup" ? (
          <>
            {sent.again ? t("New link sent") : t("Almost done! We sent a link")} {t("to")} <strong>{sent.email}</strong>{t(". Open it to")} {what}{t(", then sign in.")}
          </>
        ) : (
          <>
            {sent.again ? t("New link sent.") : t("Reset link on its way.")} {t("If an account uses")} <strong>{sent.email}</strong>{t(", open the link to")} {what}.
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
            <strong>{t("This link has expired.")}</strong> {t("Ask for a new one.")}
          </span>
        ) : (
          <span>
            {t("Works")} <strong>{t("once")}</strong>{t(", until")} <strong>{clock(expires)}</strong> ({left(expires - now)} {t("left)")}
          </span>
        )}
      </div>
      {!expired && (
        <div className="auth-expiry-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, ((expires - now) / (LINK_MINUTES * 60_000)) * 100))}%` }} />
        </div>
      )}
      <p className="auth-link-help">
        {t("Each link works for")} {linkLifetime()}{t(". Nothing arrived? Check your spam folder. Asking for a new link cancels the previous one.")}
      </p>
      <button type="button" className="auth-link auth-resend" onClick={onResend} disabled={busy || wait > 0}>
        {wait > 0 ? t("Send a new link at {clock} (in {left})", { clock: clock(sent.nextAt), left: left(wait) }) : busy ? t("Sending…") : t("Send a new link")}
      </button>
      <p className="auth-wait-rule">{t("To stop spam, each new link makes the next wait longer:")} {WAIT_STEPS}.</p>
    </div>
  );
}

export type CurrentGuest = { name: string; onContinue: () => void };

function GuestEntry({ withDivider, current }: { withDivider: boolean; current?: CurrentGuest }) {
  const { playAsGuest, guestError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(guestError);
  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await playAsGuest();
    } catch (err) {
      setError(err instanceof GuestProblem ? guestProblemText(err) : t("Couldn't start a guest game. Try again."));
      setBusy(false);
    }
  }
  if (current) {
    return (
      <div className="auth-guest">
        {withDivider && (
          <p className="auth-or">
            <span>{t("or")}</span>
          </p>
        )}
        <button type="button" className="auth-guest-btn" onClick={current.onContinue}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            {t("Continue as")} <span className="auth-guest-name">{current.name}</span>
          </span>
        </button>
        <p className="auth-guest-note">
          {t("Signing in or creating an account here replaces this guest.")}
        </p>
      </div>
    );
  }
  return (
    <div className="auth-guest">
      {withDivider && (
        <p className="auth-or">
          <span>{t("or")}</span>
        </p>
      )}
      <button type="button" className="auth-guest-btn" onClick={() => void start()} disabled={busy}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M4.8 20c.9-3.7 3.7-5.6 7.2-5.6s6.3 1.9 7.2 5.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {busy ? t("Getting your guest name…") : t("Play as guest")}
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <p className="auth-guest-note">
        {t("No account needed. You get a random name like")} <strong>{t("guest2654840")}</strong> {t("and no rating. To prevent abuse, guest games are linked to your IP address.")}
      </p>
    </div>
  );
}

export default function AuthScreen({ recovery = false, guest }: { recovery?: boolean; guest?: CurrentGuest }) {
  const { finishRecovery, prompt, askSignIn, holdSessions } = useAuth();
  useAuthFonts();
  const [mode, setMode] = useState<Mode>(recovery ? "reset" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [notice, setNotice] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const needsCaptcha = CAPTCHA_ON && (mode === "signin" || mode === "signup" || mode === "forgot");
  function spendCaptcha() {
    const token = captcha ?? undefined;
    setCaptcha(null);
    setCaptchaRound((r) => r + 1);
    return token;
  }
  const captchaWait = t("Wait a second: the security check above the button isn't finished yet.");

  useEffect(() => {
    if (!prompt || recovery) return;
    setMode("signin");
    setCaptcha(null);
    setSent(null);
    setPassword("");
    if (prompt.email) setEmail(prompt.email);
    setError(prompt.tone === "error" ? prompt.text : "");
    setNotice(prompt.tone === "notice" ? prompt.text : "");
  }, [prompt, recovery]);

  function go(next: Mode) {
    setMode(next);
    setCaptcha(null);
    setError("");
    setNotice("");
    setSent(null);
    setPassword("");
  }

  async function resend() {
    if (!supabase || !sent || busy) return;
    if (CAPTCHA_ON && !captcha) return setError(captchaWait);
    setBusy(true);
    setError("");
    const permit = await askEmailPermit(sent.email, sent.kind === "signup" ? "signup" : "recovery");
    if (!permit.ok) {
      setError(permit.message);
      if (permit.nextAt) setSent({ ...sent, nextAt: permit.nextAt });
      setBusy(false);
      return;
    }
    const captchaToken = spendCaptcha();
    try {
      const { error: err } =
        sent.kind === "signup"
          ? await supabase.auth.resend({ type: "signup", email: sent.email, options: { emailRedirectTo: confirmUrl(), captchaToken } })
          : await supabase.auth.resetPasswordForEmail(sent.email, { redirectTo: returnUrl(), captchaToken });
      if (err) setError(friendlyError(err));
      else setSent({ ...sent, at: Date.now(), again: true, nextAt: permit.nextAt });
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
    setNotice("");
    setSent(null);

    const mail = email.trim().toLowerCase();
    if (mode !== "reset" && (!EMAIL.test(mail) || mail.includes(".."))) {
      return setError(t("Enter a valid email address, like name@example.com."));
    }
    if (mode === "signup") {
      const problem = nameProblem(name);
      if (problem) return setError(problem);
    }
    if (mode === "signup" || mode === "reset") {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
    }
    if (mode === "signin" && !password) return setError(t("Enter your password."));
    if (needsCaptcha && !captcha) return setError(captchaWait);

    setBusy(true);
    let nextAt = Date.now();
    if (mode === "signup" || mode === "forgot") {
      const permit = await askEmailPermit(mail, mode === "signup" ? "signup" : "recovery");
      if (!permit.ok) {
        setError(permit.message);
        setBusy(false);
        return;
      }
      nextAt = permit.nextAt;
    }
    const captchaToken = needsCaptcha ? spendCaptcha() : undefined;
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: mail, password, options: { captchaToken } });
        if (err) setError(friendlyError(err));
      } else if (mode === "signup") {
        holdSessions(true);
        let signUpResult;
        try {
          signUpResult = await supabase.auth.signUp({
            email: mail,
            password,
            options: { data: { display_name: name.trim().replace(/\s+/g, " ") }, emailRedirectTo: confirmUrl(), captchaToken },
          });
          if (signUpResult.data.session) await supabase.auth.signOut({ scope: "local" });
        } finally {
          holdSessions(false);
        }
        const { data, error: err } = signUpResult;
        if (err) setError(friendlyError(err));
        else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError(t("An account already uses this email. Sign in instead, or use “Forgot it?” to reset the password."));
        }
        else if (!data.session) {
          setSent({ kind: "signup", email: mail, at: Date.now(), again: false, nextAt });
          setPassword("");
        }
        else askSignIn({ tone: "notice", text: t("Your account is ready. Sign in to start playing."), email: mail });
      } else if (mode === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: returnUrl(), captchaToken });
        if (err) setError(friendlyError(err));
        else setSent({ kind: "reset", email: mail, at: Date.now(), again: false, nextAt });
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
    signin: t("Welcome back"),
    signup: t("Create your account"),
    forgot: t("Reset your password"),
    reset: t("Choose a new password"),
  };
  const buttons: Record<Mode, string> = {
    signin: t("Sign in"),
    signup: t("Create account"),
    forgot: t("Send reset link"),
    reset: t("Save new password"),
  };

  if (!supabase) {
    return (
      <main className="auth">
        <div className="auth-lang">
          <LanguagePicker compact />
        </div>
        <div className="auth-card">
          <img className="auth-logo" src="/favicon.svg" alt="" width={56} height={56} />
          <h1 className="auth-title">{t("Sign-in isn't set up")}</h1>
          <p className="auth-text">
            {t("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing. Add them to the .env file (and to Render), then build again.")}
          </p>
          <GuestEntry withDivider current={guest} />
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-lang">
        <LanguagePicker compact />
      </div>
      <div className="auth-card">
        <img className="auth-logo" src="/favicon.svg" alt="" width={56} height={56} />
        <p className="auth-brand">{t("Shatranj")}</p>
        <h1 className="auth-title">{titles[mode]}</h1>

        {(mode === "signin" || mode === "signup") && (
          <div className="auth-tabs" role="tablist">
            <button role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "is-on" : ""} onClick={() => go("signin")}>
              {t("Sign in")}
            </button>
            <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-on" : ""} onClick={() => go("signup")}>
              {t("Create account")}
            </button>
          </div>
        )}

        {GOOGLE_ON && (mode === "signin" || mode === "signup") && (
          <>
            <button className="auth-google-img" onClick={google} disabled={busy} type="button" aria-label={t("Continue with Google")}>
              <img src="/google-signin.svg" alt="" width={198} height={44} draggable={false} />
            </button>
            <p className="auth-or">
              <span>{t("or with your email")}</span>
            </p>
          </>
        )}

        {mode === "forgot" && <p className="auth-text">{t("Enter your email. We'll send you a link to choose a new password.")}</p>}

        <form className="auth-form" onSubmit={submit} noValidate>
          {mode === "signup" && (
            <label>
              <span>{t("Name shown to other players")}</span>
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
              <span>{t("Email")}</span>
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
              <span>{mode === "reset" ? t("New password") : t("Password")}</span>
              <span className="auth-password">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  name="password"
                />
                <button type="button" className="auth-show" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                  {show ? t("Hide") : t("Show")}
                </button>
              </span>
              {mode === "signin" && (
                <button type="button" className="auth-link" style={{ justifySelf: "end" }} onClick={() => go("forgot")}>
                  {t("Forgot it?")}
                </button>
              )}
              {(mode === "signup" || mode === "reset") && (
                <ul className="auth-rules" aria-label={t("Password rules")}>
                  {PASSWORD_RULES.map((r) => (
                    <li key={r.label} className={r.ok(password) ? "is-ok" : ""}>
                      {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </label>
          )}

          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {sent && <LinkNotice sent={sent} onResend={() => void resend()} busy={busy} />}

          {needsCaptcha && (
            <Captcha
              key={mode}
              action={mode === "signin" ? "signin" : mode === "signup" ? "signup" : "reset"}
              round={captchaRound}
              onToken={setCaptcha}
            />
          )}

          <button className="auth-submit" type="submit" disabled={busy || (needsCaptcha && !captcha)}>
            {busy ? t("Please wait…") : buttons[mode]}
          </button>
        </form>

        {mode === "forgot" && (
          <button className="auth-link auth-back" onClick={() => go("signin")}>
            {t("← Back to sign in")}
          </button>
        )}
        {(mode === "signin" || mode === "signup") && (!sent || guest) && <GuestEntry withDivider current={guest} />}
        {(mode === "signin" || mode === "signup") && (
          <p className="auth-small">{t("Signing in keeps games fair and protects them from spam and cheating.")}</p>
        )}
      </div>
    </main>
  );
}