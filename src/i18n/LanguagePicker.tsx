import "./LanguagePicker.css";
import { LANG, LANGS, setLang, t, type Lang } from "./index.ts";

export default function LanguagePicker({ compact = false }: { compact?: boolean }) {
  return (
    <label className={"lang-pick" + (compact ? " is-compact" : "")}>
      <span className={compact ? "lang-hidden" : "lang-label"}>{t("Language")}</span>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <select value={LANG} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("Language")}>
        {LANGS.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
