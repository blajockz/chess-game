import "./Sidebar.css";
import AdminBadge, { AdminCrest } from "./AdminBadge";

export type SidebarItem = "bot" | "friend";

type Props = {
  open: SidebarItem | null;
  onOpen: (item: SidebarItem) => void;
  account?: { name: string; role: "user" | "admin" } | null;
  onSignOut?: () => void;
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
  { id: "bot", label: "New game", hint: "Choose a time control and play the practice bot" },
  { id: "friend", label: "Play a friend", hint: "Create a link and play a friend online" },
];

export default function Sidebar({ open, onOpen, account, onSignOut }: Props) {
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
      {account?.role === "admin" && (
        <a className="sb-item sb-admin" href="/admin" title="Open the admin dashboard (asks for your password and code)">
          <AdminCrest className="sb-admin-crest" />
          <span className="sb-label">Admin panel</span>
        </a>
      )}
      {account && onSignOut && (
        <div className={"account" + (account.role === "admin" ? " is-admin" : "")} title={account.name}>
          <span className="account-avatar">
            <span className="account-badge" aria-hidden="true">
              {[...account.name][0]?.toUpperCase() ?? "?"}
            </span>
            {account.role === "admin" && (
              <span className="account-crest">
                <AdminBadge size="sm" label={false} tip="right" />
              </span>
            )}
          </span>
          <span className="account-name">{account.name}</span>
          <button className="account-out" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}