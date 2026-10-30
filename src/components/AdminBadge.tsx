import { useId } from "react";
import "./AdminBadge.css";

type Props = {
  size?: "sm" | "md";
  label?: boolean;
  tip?: "up" | "down" | "right";
};

export function AdminCrest({ className = "ab-crest" }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gold = `ab-gold-${id}`;
  const rim = `ab-rim-${id}`;
  const deep = `ab-deep-${id}`;
  const shine = `ab-shine-${id}`;
  const gem = `ab-gem-${id}`;
  return (
    <svg className={className} viewBox="0 0 20 24" aria-hidden="true">
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fff4c2" />
          <stop offset="0.32" stopColor="#f3c95e" />
          <stop offset="0.68" stopColor="#c68b27" />
          <stop offset="1" stopColor="#7c4d0f" />
        </linearGradient>
        <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fdeaa0" />
          <stop offset="0.45" stopColor="#b97d1e" />
          <stop offset="0.75" stopColor="#5e3907" />
          <stop offset="1" stopColor="#e9b84c" />
        </linearGradient>
        <linearGradient id={deep} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d2c11" />
          <stop offset="1" stopColor="#120c04" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={gem} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffb4a8" />
          <stop offset="0.45" stopColor="#d83a2c" />
          <stop offset="1" stopColor="#6e120b" />
        </radialGradient>
      </defs>
      <path
        d="M10 .8 18.8 4v7.2c0 5.7-3.7 10.1-8.8 12-5.1-1.9-8.8-6.3-8.8-12V4z"
        fill={`url(#${rim})`}
        stroke="#4a2c05"
        strokeWidth="0.5"
      />
      <path d="M10 2.9 16.8 5.4v5.8c0 4.6-2.9 8.2-6.8 9.9-3.9-1.7-6.8-5.3-6.8-9.9V5.4z" fill={`url(#${deep})`} />
      <path
        d="M10 3.9 15.8 6v5.2c0 4-2.4 7.2-5.8 8.8-3.4-1.6-5.8-4.8-5.8-8.8V6z"
        fill="none"
        stroke="#f3c95e"
        strokeOpacity="0.28"
        strokeWidth="0.4"
      />
      <path d="M5.9 14.3 5.2 8.9l2.5 2.1L10 7.6l2.3 3.4 2.5-2.1-.7 5.4z" fill={`url(#${gold})`} stroke="#5e3907" strokeWidth="0.3" />
      <rect x="5.8" y="14.6" width="8.4" height="1.7" rx="0.5" fill={`url(#${gold})`} stroke="#5e3907" strokeWidth="0.3" />
      <circle cx="5.1" cy="8.4" r="0.85" fill={`url(#${gold})`} />
      <circle cx="14.9" cy="8.4" r="0.85" fill={`url(#${gold})`} />
      <path d="M10 5.1v2M9.2 5.9h1.6" stroke="#f3c95e" strokeWidth="0.55" strokeLinecap="round" />
      <circle cx="10" cy="15.45" r="0.62" fill={`url(#${gem})`} />
      <circle cx="7.6" cy="15.45" r="0.32" fill="#fff4c2" opacity="0.8" />
      <circle cx="12.4" cy="15.45" r="0.32" fill="#fff4c2" opacity="0.8" />
      <path d="M10 .8 1.2 4v7.2c0 2.2.6 4.2 1.6 5.9L10 2.9z" fill={`url(#${shine})`} opacity="0.7" />
    </svg>
  );
}

export default function AdminBadge({ size = "md", label = true, tip = "up" }: Props) {
  return (
    <span className={`admin-badge-wrap tip-${tip}`} tabIndex={0} aria-label="Admin: verified Tempo staff">
      <span className={`admin-badge ab-${size}` + (label ? "" : " is-icon")} aria-hidden="true">
        <AdminCrest />
        {label && <span className="ab-text">Admin</span>}
      </span>
      <span className="ab-tip" role="tooltip">
        <span className="ab-tip-head">
          <AdminCrest className="ab-tip-crest" />
          <span>
            <strong>Tempo Admin</strong>
            <span className="ab-tip-sub">Verified staff account</span>
          </span>
        </span>
        <span className="ab-tip-body">Keeps games fair and the community safe.</span>
      </span>
    </span>
  );
}
