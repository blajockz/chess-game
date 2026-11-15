import { t } from "../i18n";
import "./GameSetup.css";
import "./OnlineDialog.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { GAME_CODE_LENGTH } from "../../shared/protocol";

type Props = {
  onJoin: (code: string) => void;
  onCancel: () => void;
};

export function cleanCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, GAME_CODE_LENGTH);
}

export default function JoinDialog({ onJoin, onCancel }: Props) {
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ready = code.length === GAME_CODE_LENGTH;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) onJoin(code);
  }

  return (
    <div className="setup-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="setup online" role="dialog" aria-modal="true" aria-labelledby="join-title" onSubmit={submit}>
        <h2 className="setup-title" id="join-title">
          {t("Join a game")}
        </h2>
        <p className="online-text">
          {t("Enter the game code your friend sent you (")}{GAME_CODE_LENGTH} {t("letters and digits). You join their game right away.")}
        </p>
        <input
          ref={input}
          className="join-code"
          value={code}
          onChange={(e) => setCode(cleanCode(e.target.value))}
          placeholder={"•".repeat(GAME_CODE_LENGTH)}
          aria-label={t("Game code")}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
        />
        <div className="setup-foot online-foot">
          <button className="ghost-btn" type="button" onClick={onCancel}>
            {t("Cancel")}
          </button>
          <button className="start-btn" type="submit" disabled={!ready}>
            {t("Join game")}
          </button>
        </div>
      </form>
    </div>
  );
}