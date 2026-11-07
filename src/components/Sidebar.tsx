import "./Sidebar.css";
import AdminBadge, { AdminCrest } from "./AdminBadge";

export type SidebarItem = "bot" | "friend";

type Props = {
  open: SidebarItem | null;
  onOpen: (item: SidebarItem) => void;
  account?: { name: string; role: "user" | "admin"; guest?: boolean } | null;
  onSignOut?: () => void;
  current?: "play" | "puzzles";
};

function Icon({ kind }: { kind: SidebarItem }) {
  if (kind === "bot") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 12h8.5V3.5M12 12v8.5h8.5" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
        <circle cx="17.5" cy="17.5" r="5" fill="var(--sb-bg)" />
        <path d="M17.5 14.8v5.4M14.8 17.5h5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1.2 1.2M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1.2-1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ITEMS: { id: SidebarItem; label: string; hint: string }[] = [
  { id: "bot", label: "New game", hint: "Choose a time control and play Tempo Bot" },
  { id: "friend", label: "Play a friend", hint: "Create a link and play a friend online" },
];

export default function Sidebar({ open, onOpen, account, onSignOut, current = "play" }: Props) {
  return (
    <nav className="sidebar" aria-label="Games">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={"sb-item sb-" + item.id + (open === item.id ? " is-on" : "")}
          onClick={() => onOpen(item.id)}
          aria-expanded={open === item.id}
          aria-controls="game-panel"
          title={item.hint}
        >
          <Icon kind={item.id} />
          <span className="sb-label">{item.label}</span>
        </button>
      ))}
      <a
        className={"sb-item sb-puzzles" + (current === "puzzles" ? " is-on" : "")}
        href="/puzzles"
        aria-current={current === "puzzles" ? "page" : undefined}
        title="Solve chess puzzles at your level"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M9 4.5h2.2a1.9 1.9 0 1 1 3.6 0H17a1.5 1.5 0 0 1 1.5 1.5v2.2a1.9 1.9 0 1 0 0 3.6V17a1.5 1.5 0 0 1-1.5 1.5h-2.2a1.9 1.9 0 1 0-3.6 0H9A1.5 1.5 0 0 1 7.5 17v-2.2a1.9 1.9 0 1 1 0-3.6V6A1.5 1.5 0 0 1 9 4.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sb-label">Puzzles</span>
      </a>
      {account?.role === "admin" && (
        <a className="sb-item sb-admin" href="/admin" title="Open the admin dashboard (asks for your password and code)">
          <AdminCrest className="sb-admin-crest" />
          <span className="sb-label">Admin panel</span>
        </a>
      )}
      {account && onSignOut && (
        <div
          className={"account" + (account.role === "admin" ? " is-admin" : "") + (account.guest ? " is-guest" : "")}
          title={account.guest ? `${account.name}: playing as a guest (no rating)` : account.name}
        >
          <span className="account-avatar">
            <span className="account-badge" aria-hidden="true">
              {account.guest ? (
                <svg viewBox="0 0 24 24" width="17" height="17">
                  <circle cx="12" cy="8.5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M5.5 19.5c.8-3.3 3.3-5 6.5-5s5.7 1.7 6.5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              ) : (
                ([...account.name][0]?.toUpperCase() ?? "?")
              )}
            </span>
            {account.role === "admin" && (
              <span className="account-crest">
                <AdminBadge size="sm" label={false} tip="right" />
              </span>
            )}
          </span>
          <span className="account-name">{account.name}</span>
          {account.guest && <span className="account-tag">Guest</span>}
          <button
            className="account-out"
            onClick={onSignOut}
            title={account.guest ? "Sign in or create an account (you can come back as this guest)" : undefined}
          >
            {account.guest ? "Sign in" : "Sign out"}
          </button>
        </div>
      )}
    </nav>
  );
}