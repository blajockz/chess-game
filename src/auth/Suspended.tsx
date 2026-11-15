import { t } from "../i18n";
import "./AuthScreen.css";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { Ban } from "./guest";
import { banLength, endDate, isPermanent, span } from "./banText";
import { useAuthFonts } from "./authFonts";

export default function Suspended({ ban, guest = false }: { ban: Ban; guest?: boolean }) {
  const { signOut } = useAuth();
  useAuthFonts();
  const [now, setNow] = useState(() => Date.now());
  const forever = isPermanent(ban);
  useEffect(() => {
    if (forever) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [forever]);
  const left = Date.parse(ban.until) - now;
  const over = !forever && left <= 0;
  const length = banLength(ban);
  return (
    <main className="auth">
      <div className="auth-card auth-banned" role="alert">
        <div className="auth-ban-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5.7 5.7l12.6 12.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <p className="auth-brand">{t("Shatranj")}</p>
        <h1 className="auth-title">
          {over ? t("Your suspension has ended") : guest ? t("Guest play suspended") : t("Account suspended")}
        </h1>
        <p className="auth-text">
          {over
            ? t("You can play again.")
            : guest
              ? t("An admin suspended guest play from your network.")
              : t("An admin suspended this account. You can't play with it until the suspension ends.")}
        </p>
        {!over && (
          <dl className={"auth-ban-facts" + (forever ? " is-forever" : "")}>
            <div>
              <dt>{t("Duration")}</dt>
              <dd className={forever ? "is-forever" : ""}>{length ?? t("Until the date below")}</dd>
            </div>
            {!forever && (
              <>
                <div>
                  <dt>{t("Time left")}</dt>
                  <dd>{span(left)}</dd>
                </div>
                <div>
                  <dt>{t("Ends")}</dt>
                  <dd>{endDate(ban)}</dd>
                </div>
              </>
            )}
            <div className="auth-ban-reason">
              <dt>{t("Reason")}</dt>
              <dd>{ban.reason?.trim() || t("No reason was given.")}</dd>
            </div>
          </dl>
        )}
        {over ? (
          <button className="auth-submit" onClick={() => window.location.reload()}>
            {t("Continue")}
          </button>
        ) : (
          <>
            {guest && <p className="auth-text">{t("You can still sign in with an account.")}</p>}
            <button className="auth-submit" onClick={() => void signOut()}>
              {guest ? t("Sign in instead") : t("Sign out")}
            </button>
          </>
        )}
      </div>
    </main>
  );
}