import { t } from "../i18n";
import "../components/MovePanel.css";
import "./SolutionNav.css";
import { useEffect } from "react";

type Nav = { step: number; total: number; first: () => void; prev: () => void; next: () => void; last: () => void };

function NavIcon({ kind }: { kind: "first" | "prev" | "next" | "last" }) {
  const back = kind === "first" || kind === "prev";
  const bar = kind === "first" || kind === "last";
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style={{ transform: back ? "scaleX(-1)" : undefined }}>
      <path d={bar ? "M3 3l6 5-6 5z" : "M5 3l7 5-7 5z"} fill="currentColor" />
      {bar && <rect x="11" y="3" width="2" height="10" rx="0.5" fill="currentColor" />}
    </svg>
  );
}

export default function SolutionNav({ nav }: { nav: Nav }) {
  const canBack = nav.step > 0;
  const canForward = nav.step < nav.total;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.altKey || e.ctrlKey || e.metaKey) return;
      const act = { ArrowLeft: nav.prev, ArrowRight: nav.next, Home: nav.first, End: nav.last }[e.key];
      if (!act) return;
      e.preventDefault();
      act();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  return (
    <div className="pz-solnav">
      <div className="review-nav pz-solnav-buttons" role="group" aria-label={t("Review moves")}>
        <button className="review-btn" onClick={nav.first} disabled={!canBack} aria-label={t("First move")} title={t("First move (Home)")}>
          <NavIcon kind="first" />
        </button>
        <button className="review-btn" onClick={nav.prev} disabled={!canBack} aria-label={t("Previous move")} title={t("Previous move (←)")}>
          <NavIcon kind="prev" />
        </button>
        <button className="review-btn" onClick={nav.next} disabled={!canForward} aria-label={t("Next move")} title={t("Next move (→)")}>
          <NavIcon kind="next" />
        </button>
        <button className="review-btn" onClick={nav.last} disabled={!canForward} aria-label={t("Last move")} title={t("Last move")}>
          <NavIcon kind="last" />
        </button>
      </div>
      <p className="pz-solnav-count" aria-live="polite">
        {nav.step} / {nav.total}
      </p>
    </div>
  );
}
