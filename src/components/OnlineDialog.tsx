import { t } from "../i18n";
import "./GameSetup.css";
import "./OnlineDialog.css";
import { useEffect, useRef, useState } from "react";

type Props =
  | {
      mode: "invite";
      link: string;
      code: string | null;
      expiresAt: number;
      onCancel: () => void;
    }
  | { mode: "joining"; code: string; onCancel: () => void }
  | {
      mode: "error";
      message: string;
      title?: string;
      actionLabel?: string;
      onNewGame: () => void;
    };

function mmss(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function OnlineDialog(props: Props) {
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (props.mode !== "invite") return;
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, [props.mode]);

  useEffect(() => {
    mainRef.current?.focus();
  }, [props.mode]);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      inputRef.current?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 1800);
    } catch {
    }
  }

  return (
    <div className="setup-backdrop">
      <div className="setup online" role="dialog" aria-modal="true" aria-labelledby="online-title">
        {props.mode === "invite" && (
          <>
            <h2 className="setup-title" id="online-title">
              {t("Invite a friend")}
            </h2>
            <p className="online-text">
              {t("Send this link to your friend, or give them the game code: they type it in \"Join game\". The game starts as soon as they arrive.")}
            </p>
            <div className="online-link">
              <input
                ref={inputRef}
                readOnly
                value={props.link}
                aria-label={t("Game link")}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button ref={mainRef} className="start-btn" onClick={() => copy(props.link)}>
                {copied ? t("Copied") : t("Copy")}
              </button>
            </div>
            {props.code && (
              <p className="online-code-row">
                {t("Game code")} <strong>{props.code}</strong>
                <button className="ghost-btn" type="button" onClick={() => void copyCode(props.code!)}>
                  {codeCopied ? t("Copied") : t("Copy code")}
                </button>
              </p>
            )}
            <p className="online-rules">
              {t("The link and the code work for one person only, and expire in")}{" "}
              <strong className="online-timer">{mmss(props.expiresAt - now)}</strong>.
            </p>
            <div className="online-wait" role="status">
              <span className="online-dot" aria-hidden="true" />
              {t("Waiting for your friend to join…")}
            </div>
            <div className="setup-foot online-foot">
              <span />
              <button className="ghost-btn" onClick={props.onCancel}>
                {t("Cancel")}
              </button>
            </div>
          </>
        )}

        {props.mode === "joining" && (
          <>
            <h2 className="setup-title" id="online-title">
              {t("Joining game")} {props.code}
            </h2>
            <div className="online-wait" role="status">
              <span className="online-dot" aria-hidden="true" />
              {t("Connecting to the game server…")}
            </div>
            <div className="setup-foot online-foot">
              <span />
              <button ref={mainRef} className="ghost-btn" onClick={props.onCancel}>
                {t("Cancel")}
              </button>
            </div>
          </>
        )}

        {props.mode === "error" && (
          <>
            <h2 className="setup-title" id="online-title">
              {props.title ?? t("Couldn't join")}
            </h2>
            <p className="online-text">{props.message}</p>
            <div className="setup-foot online-foot">
              <span />
              <button ref={mainRef} className="start-btn" onClick={props.onNewGame}>
                {props.actionLabel ?? t("New game")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}