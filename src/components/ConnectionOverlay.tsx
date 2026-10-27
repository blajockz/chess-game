import "./ConnectionOverlay.css";
import { useEffect, useState } from "react";

type Props = {
  offline: boolean;
  retry: { attempt: number; at: number } | null;
  onRetry: () => void;
};

export default function ConnectionOverlay({ offline, retry, onRetry }: Props) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const wait = retry ? Math.max(0, Math.ceil((retry.at - now) / 1000)) : 0;
  const status = offline
    ? "Waiting for your internet to come back…"
    : retry && wait > 0
      ? `Attempt ${retry.attempt} · next try in ${wait} s`
      : "Reconnecting…";

  return (
    <div className="conn-overlay" role="alertdialog" aria-live="assertive" aria-label="Connection lost">
      <div className="conn-box">
        <span className={"conn-icon" + (offline ? " is-offline" : "")} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path
              d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="12" cy="19.3" r="1.4" fill="currentColor" />
            {offline && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
          </svg>
        </span>
        <strong className="conn-title">{offline ? "You're offline" : "Connection lost"}</strong>
        <span className="conn-status">
          {!offline && <span className="conn-spinner" aria-hidden="true" />}
          {status}
        </span>
        <p className="conn-warn">Your clock keeps running on the server while you're away.</p>
        {!offline && (
          <button className="conn-retry" onClick={onRetry}>
            Retry now
          </button>
        )}
      </div>
    </div>
  );
}
