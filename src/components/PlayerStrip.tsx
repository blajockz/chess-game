import "./PlayerStrip.css";

type Props = {
  name: string;
  detail: string;
  time: string;
  active?: boolean;
  low?: boolean;
  captured?: string[];
  advantage?: number;
};

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
}: Props) {
  return (
    <div className="strip">
      <span className="avatar">{name.charAt(0)}</span>

      <div className="who">
        <span className="who-name">{name}</span>
        <span className="who-detail">{detail}</span>
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