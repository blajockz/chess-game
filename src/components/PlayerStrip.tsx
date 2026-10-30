import "./PlayerStrip.css";
import AdminBadge from "./AdminBadge";

type Props = {
  name: string;
  detail: string;
  time: string;
  active?: boolean;
  low?: boolean;
  captured?: string[];
  advantage?: number;
  signal?: number | null | "down";
  admin?: boolean;
  badgeTip?: "up" | "down";
};

function Signal({ value }: { value: number | null | "down" }) {
  const bars = value === "down" ? 0 : value === null ? -1 : value < 150 ? 3 : value < 400 ? 2 : 1;
  const label =
    value === "down" ? "Disconnected" : value === null ? "Measuring connection…" : `Connection: ${value} ms`;
  const tone = bars === 0 ? "is-down" : bars === 1 ? "is-poor" : bars === 2 ? "is-ok" : bars === 3 ? "is-good" : "";
  return (
    <span className={"signal " + tone} title={label} aria-label={label} role="img">
      {[1, 2, 3].map((i) => (
        <span key={i} className={"signal-bar" + (i <= bars ? " is-on" : "")} style={{ height: 3 + i * 3 }} />
      ))}
      {typeof value === "number" && <span className="signal-ms">{value} ms</span>}
    </span>
  );
}

const GLYPHS: Record<string, string> = {
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

export default function PlayerStrip({
  name,
  detail,
  time,
  active = false,
  low = false,
  captured = [],
  advantage = 0,
  signal,
  admin = false,
  badgeTip = "up",
}: Props) {
  return (
    <div className="strip">
      <span className={"avatar" + (admin ? " is-admin" : "")}>{name.charAt(0)}</span>

      <div className="who">
        <span className="who-line">
          <span className="who-name">{name}</span>
          {admin && <AdminBadge tip={badgeTip} />}
        </span>
        <span className="who-detail">
          {detail}
          {signal !== undefined && <Signal value={signal} />}
        </span>
      </div>

      {captured.length > 0 && (
        <div className="captured" aria-label="Captured pieces">
          {captured.map((type, i) => (
            <span className="taken" key={i}>
              {GLYPHS[type]}
            </span>
          ))}
        </div>
      )}

      {advantage > 0 && <span className="edge">+{advantage}</span>}

      <span
        className={
          "clock" + (active ? " is-active" : "") + (low ? " is-low" : "")
        }
        role="timer"
        aria-live="off"
      >
        {time}
      </span>
    </div>
  );
}