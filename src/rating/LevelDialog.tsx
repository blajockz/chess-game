import { t } from "../i18n";
import "./LevelDialog.css";
import { useState } from "react";
import { LEVELS, type Level } from "./api";

type Props = {
  guest: boolean;
  onChoose: (level: Level) => Promise<void>;
};

export default function LevelDialog({ guest, onChoose }: Props) {
  const [busy, setBusy] = useState<Level | null>(null);
  const [error, setError] = useState("");

  async function pick(level: Level) {
    if (busy) return;
    setBusy(level);
    setError("");
    try {
      await onChoose(level);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Couldn't save your level. Try again."));
      setBusy(null);
    }
  }

  return (
    <div className="lv-scrim">
      <div className="lv" role="dialog" aria-modal="true" aria-labelledby="lv-title">
        <h2 className="lv-title" id="lv-title">
          {t("What is your level?")}
        </h2>
        <p className="lv-lead">
          {guest
            ? t("It sets how hard your puzzles and your first bot are. You can sign in later to get a rating.")
            : t("It sets your starting rating. After that, every rated game moves it: a lot at first, then less as it settles.")}
        </p>
        <div className="lv-choices">
          {LEVELS.map((l) => (
            <button key={l.id} className="lv-choice" data-level={l.id} disabled={busy !== null} onClick={() => void pick(l.id)}>
              <span className="lv-name">{l.name}</span>
              <span className="lv-rating">{guest ? t("around {rating}", { rating: l.rating }) : t("starts at {rating}", { rating: l.rating })}</span>
              <span className="lv-text">{l.text}</span>
            </button>
          ))}
        </div>
        {error && <p className="lv-error">{error}</p>}
      </div>
    </div>
  );
}