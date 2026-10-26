import "./ThemePicker.css";
import { useEffect, useRef, useState } from "react";
import { THEMES, themeById, type Theme, type ThemeId } from "../theme/themes";

type Props = {
  theme: ThemeId;
  onChange: (id: ThemeId) => void;
};

function Preview({ theme, small = false }: { theme: Theme; small?: boolean }) {
  const cells = small ? 4 : 8;
  return (
    <span
      className={"theme-prev" + (small ? " is-small" : "")}
      style={{ background: theme.sky }}
      aria-hidden="true"
    >
      <span className="theme-checker">
        {Array.from({ length: cells }, (_, i) => {
          const row = Math.floor(i / (cells / 2));
          const light = (i + row) % 2 === 0;
          return (
            <span
              key={i}
              style={{ background: light ? theme.squares[0] : theme.squares[1] }}
            />
          );
        })}
      </span>
      {!small && <span className="theme-icon">{theme.icon}</span>}
    </span>
  );
}

export default function ThemePicker({ theme, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = themeById(theme);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    rootRef.current
      ?.querySelector<HTMLButtonElement>(".theme-card.is-on")
      ?.focus();

    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        className={"theme-btn" + (open ? " is-open" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Change theme"
      >
        <Preview theme={current} small />
        <span className="theme-btn-name">{current.name}</span>
      </button>

      {open && (
        <div className="theme-pop" role="group" aria-label="Themes">
          <p className="theme-pop-title">Theme</p>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={"theme-card" + (t.id === theme ? " is-on" : "")}
                aria-pressed={t.id === theme}
                onClick={() => {
                  onChange(t.id);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <Preview theme={t} />
                <span className="theme-card-name">{t.name}</span>
                <span className="theme-card-blurb">{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}