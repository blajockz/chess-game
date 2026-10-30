import "./AdminApp.css";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { supabase, friendlyError } from "../auth/supabase";
import type { Account } from "../auth/AuthProvider";
import { AdminClient, AdminError } from "./api";

type Stage = "check" | "enroll" | "login" | "panel";

const client = new AdminClient();

async function verifyCode(code: string) {
  if (!supabase) throw new Error("Sign-in isn't set up.");
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const factor = data.totp[0];
  if (!factor) throw new Error("No authenticator app is set up yet.");
  const ch = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (ch.error) throw ch.error;
  const v = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code });
  if (v.error) throw v.error;
}

const CODE = /^\d{6}$/;

function codeError(err: unknown) {
  const e = err as { code?: string; message?: string };
  if (e?.code === "mfa_verification_failed" || /invalid totp|verification/i.test(e?.message ?? "")) {
    return "That code is wrong or too old. Use the newest code from your app.";
  }
  return friendlyError(e as { message?: string });
}

export default function AdminApp({ account }: { account: Account }) {
  const [stage, setStage] = useState<Stage>("check");
  const [note, setNote] = useState("");

  useEffect(() => {
    const leave = () => client.endOnExit();
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  useEffect(() => {
    if (account.role !== "admin" || !supabase) return;
    void supabase.auth.mfa.listFactors().then(({ data }) => {
      setStage(data && data.totp.length > 0 ? "login" : "enroll");
    });
  }, [account.role]);

  const lock = useCallback((message: string) => {
    client.forget();
    setNote(message);
    setStage("login");
  }, []);

  if (account.role !== "admin") {
    return (
      <Shell>
        <div className="adm-card adm-narrow" role="alert">
          <h1>Not allowed</h1>
          <p className="adm-muted">This page is for Tempo administrators only.</p>
          <a className="adm-btn" href="/">
            Back to the game
          </a>
        </div>
      </Shell>
    );
  }

  if (stage === "check") return <Shell><p className="adm-muted adm-center">Checking…</p></Shell>;
  if (stage === "enroll") return <Shell><Enroll onDone={() => setStage("login")} /></Shell>;
  if (stage === "login") {
    return (
      <Shell>
        <Login
          email={account.email ?? ""}
          note={note}
          onDone={() => {
            setNote("");
            setStage("panel");
          }}
        />
      </Shell>
    );
  }
  return <Panel account={account} onLock={lock} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="adm-gate">
      <div className="adm-brand">
        <img src="/favicon.svg" alt="" width={34} height={34} />
        <span>Tempo admin</span>
      </div>
      {children}
    </main>
  );
}

function Enroll({ onDone }: { onDone: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    void (async () => {
      const { data } = await sb.auth.mfa.listFactors();
      for (const f of data?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const res = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Tempo admin " + Date.now() });
      if (res.error) return setError(friendlyError(res.error));
      setQr(res.data.totp.qr_code);
      setSecret(res.data.totp.secret);
      setFactorId(res.data.id);
    })();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || busy) return;
    if (!CODE.test(code)) return setError("Enter the 6-digit code from your app.");
    setBusy(true);
    setError("");
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId });
      if (ch.error) throw ch.error;
      const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
      if (v.error) throw v.error;
      onDone();
    } catch (err) {
      setError(codeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="adm-card adm-narrow" onSubmit={submit}>
      <h1>Set up two-step verification</h1>
      <p className="adm-muted">
        The admin page needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).
        Scan this QR code with it, then type the 6-digit code it shows.
      </p>
      <div className="adm-qr">{qr ? <img src={qr} alt="QR code for your authenticator app" width={180} height={180} /> : "…"}</div>
      {secret && (
        <p className="adm-small">
          Can't scan? Enter this key by hand: <code className="adm-secret">{secret}</code>
        </p>
      )}
      <label className="adm-field">
        <span>6-digit code</span>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" name="code" />
      </label>
      {error && <p className="adm-error" role="alert">{error}</p>}
      <button className="adm-btn adm-primary" disabled={busy || !factorId}>
        {busy ? "Checking…" : "Confirm"}
      </button>
    </form>
  );
}

function Login({ email, note, onDone }: { email: string; note: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || busy) return;
    if (!password) return setError("Enter your password.");
    if (!CODE.test(code)) return setError("Enter the 6-digit code from your authenticator app.");
    setBusy(true);
    setError("");
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      await verifyCode(code);
      await client.start();
      setPassword("");
      onDone();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : codeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="adm-card adm-narrow" onSubmit={submit}>
      <h1>Confirm it's you</h1>
      <p className="adm-muted">The admin page asks for your password and a code every time you open it.</p>
      {note && <p className="adm-notice" role="status">{note}</p>}
      <label className="adm-field">
        <span>Email</span>
        <input value={email} readOnly name="email" />
      </label>
      <label className="adm-field">
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" name="password" />
      </label>
      <label className="adm-field">
        <span>Code from your authenticator app</span>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" name="code" />
      </label>
      {error && <p className="adm-error" role="alert">{error}</p>}
      <button className="adm-btn adm-primary" disabled={busy}>
        {busy ? "Checking…" : "Open the admin page"}
      </button>
      <a className="adm-link" href="/">
        ← Back to the game
      </a>
    </form>
  );
}

type Tab = "overview" | "online" | "users" | "email" | "logs" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "online", label: "Online now" },
  { id: "users", label: "Users" },
  { id: "email", label: "Email" },
  { id: "logs", label: "Logs" },
  { id: "audit", label: "Audit" },
];

type Row = Record<string, unknown>;

function Panel({ account, onLock }: { account: Account; onLock: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [stepUp, setStepUp] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const lastUse = useRef(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - lastUse.current > client.idleMs) {
        void client.end();
        onLock("You were inactive for 15 minutes, so the admin page locked itself.");
      }
    }, 10_000);
    return () => window.clearInterval(id);
  }, [onLock]);

  const act = useCallback(
    async <T = Row,>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      lastUse.current = Date.now();
      try {
        return await client.call<T>(op, args);
      } catch (err) {
        if (err instanceof AdminError && err.code === "step_up") {
          const ok = await new Promise<boolean>((resolve) => setStepUp({ resolve }));
          setStepUp(null);
          if (!ok) throw new AdminError("cancelled", "Cancelled.");
          return client.call<T>(op, args);
        }
        if (err instanceof AdminError && ["session_expired", "session_moved", "not_admin", "banned", "mfa_required"].includes(err.code)) {
          onLock(err.message);
        }
        throw err;
      }
    },
    [onLock]
  );

  async function leave() {
    await client.end();
    window.location.assign("/");
  }

  return (
    <div className="adm">
      <header className="adm-top">
        <div className="adm-brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <span>Tempo admin</span>
        </div>
        <nav className="adm-tabs" aria-label="Admin sections">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "is-on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="adm-me">
          <span className="adm-lock" title="Admin data is encrypted end-to-end between this page and the server">🔒 Encrypted</span>
          <span>{account.name}</span>
          <button className="adm-btn" onClick={() => void client.end().then(() => onLock("Admin page locked."))}>
            Lock
          </button>
          <button className="adm-btn" onClick={() => void leave()}>
            Back to game
          </button>
        </div>
      </header>
      <main className="adm-body">
        {tab === "overview" && <Overview act={act} />}
        {tab === "online" && <Online act={act} />}
        {tab === "users" && <Users act={act} me={account.id} />}
        {tab === "email" && (
          <section>
            <div className="adm-head">
              <h2>Email players</h2>
            </div>
            <Compose act={act} />
          </section>
        )}
        {tab === "logs" && <Logs act={act} />}
        {tab === "audit" && <Audit act={act} />}
      </main>
      {stepUp && <StepUp onDone={(ok) => stepUp.resolve(ok)} />}
    </div>
  );
}

type Act = <T = Row>(op: string, args?: Record<string, unknown>) => Promise<T>;

function StepUp({ onDone }: { onDone: (ok: boolean) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!CODE.test(code)) return setError("Enter the 6-digit code.");
    setBusy(true);
    try {
      await verifyCode(code);
      onDone(true);
    } catch (err) {
      setError(codeError(err));
      setBusy(false);
    }
  }
  return (
    <div className="adm-modal" role="dialog" aria-label="Confirm with a code">
      <form className="adm-card adm-narrow" onSubmit={submit}>
        <h2>Confirm this action</h2>
        <p className="adm-muted">Sensitive actions need a fresh code from your authenticator app.</p>
        <label className="adm-field">
          <span>6-digit code</span>
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" name="stepcode" />
        </label>
        {error && <p className="adm-error">{error}</p>}
        <div className="adm-row">
          <button type="button" className="adm-btn" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button className="adm-btn adm-primary" disabled={busy}>
            Confirm
          </button>
        </div>
      </form>
    </div>
  );
}

function text(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function when(v: unknown) {
  if (typeof v !== "string") return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await load());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, error, busy, reload: run, setData };
}

function Overview({ act }: { act: Act }) {
  const { data, error, busy, reload } = useLoad(() => act<Record<string, number>>("overview"), []);
  const cards: [string, string][] = [
    ["online", "Online now"],
    ["visitors", "Visitors (24 h)"],
    ["pages", "Page loads (24 h)"],
    ["users", "Accounts"],
    ["signups", "New accounts (24 h)"],
    ["bans", "Active bans"],
    ["blocked", "Blocked (Tor/VPN, 24 h)"],
    ["authFailed", "Refused tokens (24 h)"],
    ["denied", "Admin access refused (24 h)"],
  ];
  return (
    <section>
      <div className="adm-head">
        <h2>Overview</h2>
        <button className="adm-btn" onClick={() => void reload()} disabled={busy}>
          Refresh
        </button>
      </div>
      {error && <p className="adm-error">{error}</p>}
      <div className="adm-cards">
        {cards.map(([k, label]) => (
          <div key={k} className={"adm-stat" + (["blocked", "authFailed", "denied"].includes(k) && (data?.[k] ?? 0) > 0 ? " is-warn" : "")}>
            <strong>{data ? text(data[k]) : "…"}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Table({ columns, rows, empty }: { columns: [string, string, ((r: Row) => ReactNode)?][]; rows: Row[]; empty: string }) {
  if (!rows.length) return <p className="adm-muted">{empty}</p>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            {columns.map(([k, label]) => (
              <th key={k}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              {columns.map(([k, , render]) => (
                <td key={k}>{render ? render(r) : text(r[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Online({ act }: { act: Act }) {
  const { data, error, busy, reload } = useLoad(() => act<{ rows: Row[] }>("online"), []);
  return (
    <section>
      <div className="adm-head">
        <h2>Online now</h2>
        <button className="adm-btn" onClick={() => void reload()} disabled={busy}>
          Refresh
        </button>
      </div>
      {error && <p className="adm-error">{error}</p>}
      <Table
        rows={data?.rows ?? []}
        empty="Nobody is connected right now."
        columns={[
          ["name", "Player"],
          ["ip", "IP address", (r) => <code>{text(r.ip)}</code>],
          ["country", "Country"],
          ["room", "In game"],
          ["since", "Since", (r) => when(r.since)],
          ["userAgent", "Browser", (r) => <span className="adm-ua">{text(r.userAgent)}</span>],
        ]}
      />
    </section>
  );
}

const DURATIONS: [string, number | null][] = [
  ["1 hour", 60],
  ["24 hours", 24 * 60],
  ["7 days", 7 * 24 * 60],
  ["30 days", 30 * 24 * 60],
  ["Custom…", -1],
  ["Permanent", null],
];
const UNITS: [string, number][] = [
  ["minutes", 1],
  ["hours", 60],
  ["days", 24 * 60],
];

function Users({ act, me }: { act: Act; me: string }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState({ q: "", filter: "all" });
  const { data, error, busy, reload, setData } = useLoad(
    () => act<{ rows: Row[] }>("users", { q: search.q || undefined, filter: search.filter }),
    [search]
  );
  const [banning, setBanning] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [mailing, setMailing] = useState<Row | null>(null);
  const [message, setMessage] = useState("");

  async function run(label: string, op: string, args: Record<string, unknown>) {
    setMessage("");
    try {
      await act(op, args);
      setMessage(label);
      await reload();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function reveal(r: Row) {
    try {
      const res = await act<{ email: string }>("revealEmail", { id: r.id });
      setData((d) => (d ? { rows: d.rows.map((x) => (x.id === r.id ? { ...x, email: res.email, revealed: true } : x)) } : d));
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <section>
      <div className="adm-head">
        <h2>Users</h2>
        <form
          className="adm-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch({ q: q.trim(), filter });
          }}
        >
          <input placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} name="userq" />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} name="userfilter">
            <option value="all">Everyone</option>
            <option value="banned">Banned</option>
            <option value="admins">Admins</option>
          </select>
          <button className="adm-btn" disabled={busy}>
            Search
          </button>
        </form>
      </div>
      {error && <p className="adm-error">{error}</p>}
      {message && <p className="adm-notice">{message}</p>}
      <Table
        rows={data?.rows ?? []}
        empty="No accounts found."
        columns={[
          ["display_name", "Name"],
          [
            "email",
            "Email",
            (r) => (
              <span className="adm-email">
                {text(r.email)}
                {!r.revealed && (
                  <button className="adm-mini" onClick={() => void reveal(r)} title="Show the full email (recorded in the audit log)">
                    Show
                  </button>
                )}
              </span>
            ),
          ],
          ["role", "Role", (r) => <span className={"adm-pill" + (r.role === "admin" ? " is-admin" : "")}>{text(r.role)}</span>],
          ["created_at", "Joined", (r) => when(r.created_at)],
          ["last_seen_at", "Last seen", (r) => when(r.last_seen_at)],
          [
            "banned_until",
            "Status",
            (r) =>
              r.banned_until && Date.parse(String(r.banned_until)) > Date.now() ? (
                <span className="adm-pill is-banned" title={text(r.ban_reason)}>
                  Banned {new Date(String(r.banned_until)).getFullYear() >= 9999 ? "forever" : "until " + when(r.banned_until)}
                </span>
              ) : (
                <span className="adm-pill">Active</span>
              ),
          ],
          [
            "actions",
            "",
            (r) =>
              r.id === me ? (
                <span className="adm-muted">You</span>
              ) : (
                <span className="adm-actions">
                  {r.banned_until && Date.parse(String(r.banned_until)) > Date.now() ? (
                    <button className="adm-mini" onClick={() => void run("Ban lifted.", "unban", { id: r.id })}>
                      Unban
                    </button>
                  ) : (
                    r.role !== "admin" && (
                      <button className="adm-mini is-danger" onClick={() => setBanning(r)}>
                        Ban
                      </button>
                    )
                  )}
                  <button className="adm-mini" onClick={() => setMailing(r)}>
                    Email
                  </button>
                  {r.role !== "admin" && (
                    <button className="adm-mini is-danger" onClick={() => setDeleting(r)}>
                      Delete
                    </button>
                  )}
                  <button
                    className="adm-mini"
                    onClick={() =>
                      void run(
                        r.role === "admin" ? "Admin role removed." : "Now an admin.",
                        "setRole",
                        { id: r.id, role: r.role === "admin" ? "user" : "admin" }
                      )
                    }
                  >
                    {r.role === "admin" ? "Remove admin" : "Make admin"}
                  </button>
                </span>
              ),
          ],
        ]}
      />
      {banning && (
        <BanDialog
          user={banning}
          onCancel={() => setBanning(null)}
          onBan={(minutes, reason) => {
            setBanning(null);
            void run("Account suspended.", "ban", { id: banning.id, minutes, reason });
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          user={deleting}
          onCancel={() => setDeleting(null)}
          onDelete={(confirm) => {
            setDeleting(null);
            void run("Account deleted.", "deleteUser", { id: deleting.id, confirm });
          }}
        />
      )}
      {mailing && (
        <div className="adm-modal" role="dialog" aria-label="Email a player">
          <div className="adm-card adm-wide">
            <h2>Email {text(mailing.display_name)}</h2>
            <Compose act={act} user={{ id: String(mailing.id), name: text(mailing.display_name) }} onClose={() => setMailing(null)} />
          </div>
        </div>
      )}
    </section>
  );
}

function BanDialog({ user, onCancel, onBan }: { user: Row; onCancel: () => void; onBan: (minutes: number | null, reason: string) => void }) {
  const [choice, setChoice] = useState(1);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("2");
  const [unit, setUnit] = useState(1);
  const custom = DURATIONS[choice][1] === -1;
  const customMinutes = Math.round(Number(amount) * UNITS[unit][1]);
  const customOk = Number.isFinite(customMinutes) && customMinutes >= 5 && customMinutes <= 365 * 24 * 60;
  const ready = reason.trim().length >= 3 && (!custom || customOk);
  return (
    <div className="adm-modal" role="dialog" aria-label="Ban user">
      <form
        className="adm-card adm-narrow"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onBan(custom ? customMinutes : DURATIONS[choice][1], reason.trim());
        }}
      >
        <h2>Ban {text(user.display_name)}</h2>
        <label className="adm-field">
          <span>Duration</span>
          <select value={choice} onChange={(e) => setChoice(Number(e.target.value))} name="duration">
            {DURATIONS.map(([label], i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {custom && (
          <div className="adm-field">
            <span>Ban for</span>
            <div className="adm-row adm-start">
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} name="amount" className="adm-num" />
              <select value={unit} onChange={(e) => setUnit(Number(e.target.value))} name="unit">
                {UNITS.map(([label], i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {!customOk && <small className="adm-small">Between 5 minutes and 365 days.</small>}
          </div>
        )}
        <label className="adm-field">
          <span>Reason (shown to the player)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} name="reason" />
        </label>
        <div className="adm-row">
          <button type="button" className="adm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="adm-btn adm-danger" disabled={!ready}>
            Ban
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteDialog({ user, onCancel, onDelete }: { user: Row; onCancel: () => void; onDelete: (confirm: string) => void }) {
  const [typed, setTyped] = useState("");
  const name = text(user.display_name);
  return (
    <div className="adm-modal" role="dialog" aria-label="Delete account">
      <form
        className="adm-card adm-narrow"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim() === name) onDelete(typed.trim());
        }}
      >
        <h2>Delete {name}'s account?</h2>
        <p className="adm-muted">
          This permanently removes the account: sign-in, password, two-step setup and profile. It can't be undone.
          Security logs about this player are kept (they're deleted automatically after 90 days).
        </p>
        <label className="adm-field">
          <span>
            Type <strong>{name}</strong> to confirm
          </span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} name="confirmname" autoComplete="off" />
        </label>
        <div className="adm-row">
          <button type="button" className="adm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="adm-btn adm-danger" disabled={typed.trim() !== name}>
            Delete forever
          </button>
        </div>
      </form>
    </div>
  );
}

const AUDIENCES: [string, string][] = [
  ["all", "All players"],
  ["active", "Players active in the last 30 days"],
  ["admins", "Admins only"],
];

function Compose({ act, user, onClose }: { act: Act; user?: { id: string; name: string }; onClose?: () => void }) {
  const [status, setStatus] = useState<{ configured: boolean; from: string | null } | null>(null);
  const [audience, setAudience] = useState("all");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<{ id: string; total: number; sent: number; failed: number; done: boolean } | null>(null);

  useEffect(() => {
    void act<{ configured: boolean; from: string | null }>("mailStatus").then(setStatus, () => setStatus(null));
  }, [act]);

  useEffect(() => {
    if (!job || job.done) return;
    const t = window.setTimeout(async () => {
      try {
        const s = await act<{ total: number; sent: number; failed: number; done: boolean }>("emailJob", { job: job.id });
        setJob({ ...job, ...s });
      } catch {
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [job, act]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (subject.trim().length < 3) return setError("Write a subject (at least 3 characters).");
    if (message.trim().length < 10) return setError("Write a message (at least 10 characters).");
    setBusy(true);
    try {
      const res = await act<{ job: string; total: number }>("sendEmail", {
        audience: user ? "user" : audience,
        id: user?.id,
        subject: subject.trim(),
        message: message.trim(),
      });
      setJob({ id: res.job, total: res.total, sent: 0, failed: 0, done: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.configured) {
    return (
      <div className="adm-notice">
        Email sending isn't set up on the server yet. Add SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to the server's
        settings (the same Gmail address and app password used in Supabase), then restart it.
      </div>
    );
  }

  if (job) {
    return (
      <div className="adm-card-inner">
        <p className="adm-notice" role="status">
          {job.done
            ? `Done: ${job.sent} sent${job.failed ? `, ${job.failed} failed` : ""}.`
            : `Sending… ${job.sent + job.failed} of ${job.total} (about one per second).`}
        </p>
        <div className="adm-row adm-start">
          {onClose && (
            <button className="adm-btn" onClick={onClose}>
              Close
            </button>
          )}
          {!onClose && job.done && (
            <button
              className="adm-btn"
              onClick={() => {
                setJob(null);
                setSubject("");
                setMessage("");
              }}
            >
              Write another
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="adm-compose" onSubmit={send}>
      {status?.from && <p className="adm-small">Sent from: {status.from}</p>}
      {!user && (
        <label className="adm-field">
          <span>To</span>
          <select value={audience} onChange={(e) => setAudience(e.target.value)} name="audience">
            {AUDIENCES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <small className="adm-small">Each player gets their own email; banned players are skipped. At most 3 group emails per hour.</small>
        </label>
      )}
      <label className="adm-field">
        <span>Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} name="subject" />
      </label>
      <label className="adm-field">
        <span>Message (plain text; leave an empty line between paragraphs)</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} rows={8} name="message" />
        <small className="adm-small">{message.length} / 5000</small>
      </label>
      {error && <p className="adm-error">{error}</p>}
      <div className="adm-row">
        {onClose && (
          <button type="button" className="adm-btn" onClick={onClose}>
            Cancel
          </button>
        )}
        <button className="adm-btn adm-primary" disabled={busy}>
          {busy ? "Sending…" : user ? `Send to ${user.name}` : "Send"}
        </button>
      </div>
    </form>
  );
}

const KINDS = [
  "",
  "page",
  "api",
  "game_connect",
  "game_disconnect",
  "game_create",
  "game_join",
  "game_refused",
  "blocked",
  "banned",
  "rate_limited",
  "auth_failed",
  "admin_denied",
  "not_found",
  "error",
  "refused",
  "bad_message",
  "bad_pow",
  "kicked",
  "suppressed",
];

function Logs({ act }: { act: Act }) {
  const [form, setForm] = useState({ kind: "", ip: "", q: "" });
  const [filters, setFilters] = useState(form);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(
    async (before?: number) => {
      setBusy(true);
      setError("");
      try {
        const res = await act<{ rows: Row[] }>("logs", {
          kind: filters.kind || undefined,
          ip: filters.ip || undefined,
          q: filters.q || undefined,
          before,
          limit: 50,
        });
        setRows((old) => (before ? [...old, ...res.rows] : res.rows));
        setDone(res.rows.length < 50);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [act, filters]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="adm-head">
        <h2>Logs</h2>
        <form
          className="adm-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ kind: form.kind, ip: form.ip.trim(), q: form.q.trim() });
          }}
        >
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} name="kind">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k || "All events"}
              </option>
            ))}
          </select>
          <input placeholder="IP address" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} name="ip" />
          <input placeholder="Path contains" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} name="path" />
          <button className="adm-btn" disabled={busy}>
            Filter
          </button>
        </form>
      </div>
      {error && <p className="adm-error">{error}</p>}
      <Table
        rows={rows}
        empty={busy ? "Loading…" : "No events."}
        columns={[
          ["at", "Time", (r) => when(r.at)],
          ["kind", "Event", (r) => <span className={"adm-kind k-" + text(r.kind)}>{text(r.kind)}</span>],
          [
            "ip",
            "IP",
            (r) => (
              <button className="adm-linkbtn" onClick={() => setFilters({ ...filters, ip: String(r.ip ?? "") })} title="Show only this IP">
                {text(r.ip)}
              </button>
            ),
          ],
          ["country", "Country"],
          ["user_id", "User", (r) => <code className="adm-id">{r.user_id ? String(r.user_id).slice(0, 8) : "—"}</code>],
          ["method", "Method"],
          ["path", "Path", (r) => <code className="adm-path">{text(r.path)}</code>],
          ["status", "Status"],
          ["detail", "Details", (r) => <code className="adm-detail">{text(r.detail)}</code>],
          ["user_agent", "Browser", (r) => <span className="adm-ua">{text(r.user_agent)}</span>],
        ]}
      />
      {!done && rows.length > 0 && (
        <button className="adm-btn adm-more" disabled={busy} onClick={() => void load(Number(rows[rows.length - 1].id))}>
          Load older
        </button>
      )}
    </section>
  );
}

function Audit({ act }: { act: Act }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const load = useCallback(
    async (before?: number) => {
      try {
        const res = await act<{ rows: Row[] }>("audit", { before, limit: 50 });
        setRows((old) => (before ? [...old, ...res.rows] : res.rows));
        setDone(res.rows.length < 50);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [act]
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section>
      <div className="adm-head">
        <h2>Audit log</h2>
        <span className="adm-muted">Every admin action. Nobody can edit or delete these lines.</span>
      </div>
      {error && <p className="adm-error">{error}</p>}
      <Table
        rows={rows}
        empty="No admin actions yet."
        columns={[
          ["at", "Time", (r) => when(r.at)],
          ["admin_id", "Admin", (r) => <code className="adm-id">{String(r.admin_id ?? "").slice(0, 8)}</code>],
          ["action", "Action", (r) => <span className="adm-pill">{text(r.action)}</span>],
          ["target", "Target", (r) => <code className="adm-id">{r.target ? String(r.target).slice(0, 8) : "—"}</code>],
          ["ip", "IP"],
          ["detail", "Details", (r) => <code className="adm-detail">{text(r.detail)}</code>],
        ]}
      />
      {!done && rows.length > 0 && (
        <button className="adm-btn adm-more" onClick={() => void load(Number(rows[rows.length - 1].id))}>
          Load older
        </button>
      )}
    </section>
  );
}