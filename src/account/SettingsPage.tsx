import { t } from "../i18n";
import "../review/History.css";
import "./Settings.css";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import WeatherLayer from "../components/WeatherLayer";
import { hasWebGL } from "../three/Safe3D";
import { THEMES, loadTheme, saveTheme, themeById, type ThemeId } from "../theme/themes";
import type { Account } from "../auth/AuthProvider";
import { AUTH_OFF, friendlyError, returnUrl, supabase } from "../auth/supabase";
import Captcha, { CAPTCHA_ON } from "../auth/Captcha";
import { askEmailPermit } from "../auth/emailPermit";
import { AccountProblem, accountApi, type AccountInfo } from "./api";
import LanguagePicker from "../i18n/LanguagePicker";

type Note = { tone: "ok" | "error"; text: string } | null;

function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function waitText(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return t("now");
  const hours = Math.ceil(ms / 3_600_000);
  if (hours >= 48) return t("in {n} days", { n: Math.ceil(hours / 24) });
  if (hours > 1) return t("in {n} hours", { n: hours });
  return t("in {n} minutes", { n: Math.max(1, Math.ceil(ms / 60_000)) });
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Message({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p className={"st-note is-" + note.tone} role={note.tone === "error" ? "alert" : "status"}>
      {note.text}
    </p>
  );
}

export default function SettingsPage({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const canThree = useMemo(hasWebGL, []);
  const [mode, setMode] = useState<"default" | "sim">(() => (canThree && remembered("tempo.mode") === "sim" ? "sim" : "default"));
  const [soundOn, setSoundOn] = useState(true);
  const guest = account.guest === true;

  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [name, setName] = useState(account.name);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameNote, setNameNote] = useState<Note>(null);

  const [hasPassword, setHasPassword] = useState(true);
  const [email, setEmail] = useState(account.email ?? "");

  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNote, setResetNote] = useState<Note>(null);
  const [resetCaptcha, setResetCaptcha] = useState<string | null>(null);
  const [resetRound, setResetRound] = useState(0);

  const [mailOpen, setMailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mailBusy, setMailBusy] = useState(false);
  const [mailNote, setMailNote] = useState<Note>(null);
  const [mailCaptcha, setMailCaptcha] = useState<string | null>(null);
  const [mailRound, setMailRound] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("tempo.mode", mode);
    } catch {
    }
  }, [mode]);

  useEffect(() => {
    document.title = t("Settings · Shatranj");
    if (guest) return;
    let alive = true;
    accountApi
      .get()
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        setName(i.name);
      })
      .catch((err: Error) => alive && setNameNote({ tone: "error", text: err.message }));
    if (supabase) {
      void supabase.auth.getUser().then(({ data }) => {
        if (!alive || !data.user) return;
        const providers = (data.user.app_metadata?.providers as string[] | undefined) ?? [];
        if (providers.length) setHasPassword(providers.includes("email"));
        if (data.user.email) setEmail(data.user.email);
      });
    }
    return () => {
      alive = false;
    };
  }, [guest]);

  const goPlay = () => window.location.assign("/");
  const shownName = info?.name ?? account.name;
  const locked = info?.nextNameChangeAt ?? null;

  async function rename(e: FormEvent) {
    e.preventDefault();
    const wanted = name.trim().replace(/\s+/g, " ");
    if (wanted.length < 2) return setNameNote({ tone: "error", text: t("Enter a name of 2 to 24 characters.") });
    if (wanted === shownName) return setNameNote({ tone: "error", text: t("That is already your name.") });
    setNameBusy(true);
    setNameNote(null);
    try {
      const next = await accountApi.rename(wanted);
      setInfo(next);
      setName(next.name);
      setNameNote({ tone: "ok", text: t("Your name is now {name}. You can change it again in 72 hours.", { name: next.name }) });
    } catch (err) {
      const p = err as AccountProblem;
      if (p.nextNameChangeAt && info) setInfo({ ...info, nextNameChangeAt: p.nextNameChangeAt });
      setNameNote({ tone: "error", text: p.message });
    } finally {
      setNameBusy(false);
    }
  }

  async function sendReset() {
    if (!supabase || !email) return;
    if (CAPTCHA_ON && !resetOpen) return setResetOpen(true);
    if (CAPTCHA_ON && !resetCaptcha) return;
    setResetBusy(true);
    setResetNote(null);
    try {
      const permit = await askEmailPermit(email, "recovery");
      if (!permit.ok) {
        setResetNote({ tone: "error", text: permit.nextAt ? t("{message} Next email possible at {clock}.", { message: permit.message, clock: clock(permit.nextAt) }) : permit.message });
        return;
      }
      const captchaToken = resetCaptcha ?? undefined;
      setResetCaptcha(null);
      setResetRound((r) => r + 1);
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: returnUrl(), captchaToken });
      if (error) setResetNote({ tone: "error", text: friendlyError(error) });
      else {
        setResetOpen(false);
        setResetNote({ tone: "ok", text: t("Email sent to {email}. Open its link to choose a new password. Another email is possible at {clock}.", { email, clock: clock(permit.nextAt) }) });
      }
    } finally {
      setResetBusy(false);
    }
  }

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !email) return;
    const wanted = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted) || wanted.length > 254) return setMailNote({ tone: "error", text: t("Enter a valid email address.") });
    if (wanted === email.toLowerCase()) return setMailNote({ tone: "error", text: t("That is already your email address.") });
    if (!password) return setMailNote({ tone: "error", text: t("Enter your current password.") });
    if (CAPTCHA_ON && !mailCaptcha) return setMailNote({ tone: "error", text: t("Wait for the security check, then try again.") });
    setMailBusy(true);
    setMailNote(null);
    try {
      const captchaToken = mailCaptcha ?? undefined;
      setMailCaptcha(null);
      setMailRound((r) => r + 1);
      const check = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (check.error) {
        setMailNote({ tone: "error", text: /invalid/i.test(check.error.message) ? t("Wrong password.") : friendlyError(check.error) });
        return;
      }
      await accountApi.emailPermit(wanted);
      const { error } = await supabase.auth.updateUser({ email: wanted }, { emailRedirectTo: returnUrl() });
      if (error) {
        setMailNote({ tone: "error", text: friendlyError(error) });
        return;
      }
      setPassword("");
      setNewEmail("");
      setMailOpen(false);
      setMailNote({
        tone: "ok",
        text: t("Confirmation sent. Open the link in the email sent to {wanted} (and the one sent to {email}, if you get one). Your address changes only after that.", { wanted, email }),
      });
    } catch (err) {
      setMailNote({ tone: "error", text: (err as Error).message || t("Something went wrong.") });
    } finally {
      setMailBusy(false);
    }
  }

  return (
    <div className="shell history">
      <WeatherLayer theme={themeById(theme)} />
      <TopBar
        mode={mode}
        onModeChange={setMode}
        simAvailable={canThree}
        soundOn={soundOn}
        onSoundToggle={() => setSoundOn((on) => !on)}
        control={t("Settings")}
        onNewGame={goPlay}
        theme={theme}
        onThemeChange={setTheme}
      />
      <Sidebar open={null} onOpen={goPlay} current="settings" account={{ ...account, name: shownName }} onSignOut={onSignOut} />

      <main className="hs st">
        <header className="hs-head">
          <h1 className="hs-title">{t("Settings")}</h1>
          <p className="hs-sub">{guest ? t("Sign in to manage an account. The language and theme are kept on this device.") : t("Your account, and how Shatranj looks.")}</p>
        </header>

        {!guest && (
          <>
            <section className="st-card" aria-labelledby="st-name">
              <h2 className="st-h" id="st-name">
                {t("Username")}
              </h2>
              <p className="st-text">
                {t("The name other players see. It can be changed once every 72 hours.")}
                {locked && <strong> {t("Next change possible")} {waitText(locked)}.</strong>}
              </p>
              <form className="st-row" onSubmit={rename}>
                <input
                  className="st-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  aria-label={t("Username")}
                  autoComplete="nickname"
                  disabled={!!locked || nameBusy || !info}
                />
                <button className="hs-btn" type="submit" disabled={!!locked || nameBusy || !info}>
                  {nameBusy ? t("Saving…") : t("Change name")}
                </button>
              </form>
              <Message note={nameNote} />
            </section>

            {!AUTH_OFF && (
              <section className="st-card" aria-labelledby="st-pass">
                <h2 className="st-h" id="st-pass">
                  {t("Password")}
                </h2>
                {hasPassword ? (
                  <>
                    <p className="st-text">
                      {t("We send a link to")} <strong>{email}</strong>{t(". Open it to choose a new password. Each email makes the next one wait longer.")}
                    </p>
                    {resetOpen && CAPTCHA_ON && <Captcha onToken={setResetCaptcha} round={resetRound} action="reset" />}
                    <button className="hs-btn" onClick={() => void sendReset()} disabled={resetBusy || (resetOpen && CAPTCHA_ON && !resetCaptcha)}>
                      {resetBusy ? t("Sending…") : t("Email me a reset link")}
                    </button>
                    <Message note={resetNote} />
                  </>
                ) : (
                  <p className="st-text">{t("This account signs in with Google. It has no Shatranj password.")}</p>
                )}
              </section>
            )}

            {!AUTH_OFF && (
              <section className="st-card" aria-labelledby="st-mail">
                <h2 className="st-h" id="st-mail">
                  {t("Email address")}
                </h2>
                {hasPassword ? (
                  <>
                    <p className="st-text">
                      {t("Your address is")} <strong>{email}</strong>{t(". To change it, enter your password. The change happens only after the new address is confirmed by email. At most 3 requests a day.")}
                    </p>
                    {mailOpen ? (
                      <form className="st-form" onSubmit={changeEmail}>
                        <label className="st-label">
                          {t("New email address")}
                          <input
                            className="st-input"
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            maxLength={254}
                            autoComplete="email"
                            required
                          />
                        </label>
                        <label className="st-label">
                          {t("Current password")}
                          <input
                            className="st-input"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            maxLength={200}
                            autoComplete="current-password"
                            required
                          />
                        </label>
                        {CAPTCHA_ON && <Captcha onToken={setMailCaptcha} round={mailRound} action="signin" />}
                        <div className="st-row">
                          <button className="hs-btn" type="submit" disabled={mailBusy || (CAPTCHA_ON && !mailCaptcha)}>
                            {mailBusy ? t("Checking…") : t("Send confirmation")}
                          </button>
                          <button
                            className="st-ghost"
                            type="button"
                            onClick={() => {
                              setMailOpen(false);
                              setPassword("");
                              setMailNote(null);
                            }}
                          >
                            {t("Cancel")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        className="hs-btn"
                        onClick={() => {
                          setMailOpen(true);
                          setMailNote(null);
                        }}
                      >
                        {t("Change email")}
                      </button>
                    )}
                    <Message note={mailNote} />
                  </>
                ) : (
                  <p className="st-text">
                    {t("Your address is")} <strong>{email}</strong>{t(". This account signs in with Google, so the address is managed by Google.")}
                  </p>
                )}
              </section>
            )}
          </>
        )}

        <section className="st-card" aria-labelledby="st-lang">
          <h2 className="st-h" id="st-lang">
            {t("Language")}
          </h2>
          <p className="st-text">{t("The language of the whole game. Kept on this device.")}</p>
          <LanguagePicker compact />
        </section>

        <section className="st-card" aria-labelledby="st-theme">
          <h2 className="st-h" id="st-theme">
            {t("Theme")}
          </h2>
          <p className="st-text">{t("The colours of the board and the page. Kept on this device.")}</p>
          <div className="st-themes" role="radiogroup" aria-label={t("Theme")}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={"st-theme" + (t.id === theme ? " is-on" : "")}
                role="radio"
                aria-checked={t.id === theme}
                onClick={() => setTheme(t.id)}
              >
                <span className="st-swatch" style={{ background: t.sky }} aria-hidden="true">
                  <span style={{ background: t.squares[0] }} />
                  <span style={{ background: t.squares[1] }} />
                  <span style={{ background: t.squares[1] }} />
                  <span style={{ background: t.squares[0] }} />
                </span>
                <span className="st-theme-name">
                  {t.icon} {t.name}
                </span>
              </button>
            ))}
          </div>
        </section>

        {guest && (
          <button className="hs-btn" onClick={onSignOut}>
            {t("Sign in or create an account")}
          </button>
        )}
      </main>
    </div>
  );
}