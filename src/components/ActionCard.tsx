import "./ActionCard.css";
import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { CARDS, type CardId } from "../cards/cards";

const W = 250;
const H = 350;
const CX = 125;
const CY = 182;

const PAWN =
  "M109 126 A34 34 0 1 1 141 126 L156 126 Q162 126 162 132 L162 138 Q162 144 156 144 L146 144 " +
  "C148 180 160 215 176 240 L184 248 Q190 252 190 260 L190 280 Q190 288 182 288 L68 288 " +
  "Q60 288 60 280 L60 260 Q60 252 66 248 L74 240 C90 215 102 180 104 144 L94 144 " +
  "Q88 144 88 138 L88 132 Q88 126 94 126 Z";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heptagram(cx: number, cy: number, r: number) {
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  const order = Array.from({ length: 7 }, (_, i) => pts[(i * 3) % 7]);
  return "M" + order.map((p) => p.map((n) => n.toFixed(1)).join(" ")).join(" L") + " Z";
}

function heptagon(cx: number, cy: number, r: number) {
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = -Math.PI / 2 + Math.PI / 7 + (i * 2 * Math.PI) / 7;
    return `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  });
  return "M" + pts.join(" L") + " Z";
}

function useArt() {
  return useMemo(() => {
    const rnd = seeded(7);

    const rays = Array.from({ length: 44 }, (_, i) => {
      const a = (i / 44) * Math.PI * 2 + rnd() * 0.08;
      const half = 0.012 + rnd() * 0.03;
      const len = 210 + rnd() * 90;
      const p1 = [CX + Math.cos(a - half) * len, CY + Math.sin(a - half) * len];
      const p2 = [CX + Math.cos(a + half) * len, CY + Math.sin(a + half) * len];
      return {
        d: `M${CX} ${CY} L${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L${p2[0].toFixed(1)} ${p2[1].toFixed(1)} Z`,
        o: 0.08 + rnd() * 0.22,
      };
    });

    const swirls = Array.from({ length: 34 }, () => {
      const rx = 60 + rnd() * 120;
      const ry = 22 + rnd() * 100;
      const rot = rnd() * 180;
      const a0 = rnd() * Math.PI * 2;
      const sweep = 0.8 + rnd() * 2.2;
      const at = (a: number) => {
        const x = rx * Math.cos(a);
        const y = ry * Math.sin(a);
        const r = (rot * Math.PI) / 180;
        return [CX + x * Math.cos(r) - y * Math.sin(r), CY + x * Math.sin(r) + y * Math.cos(r)];
      };
      const [x0, y0] = at(a0);
      const [x1, y1] = at(a0 + sweep);
      return {
        d: `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rx.toFixed(1)} ${ry.toFixed(1)} ${rot.toFixed(1)} ${sweep > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`,
        w: 0.4 + rnd() * 1.5,
        o: 0.45 + rnd() * 0.55,
      };
    });

    const edge = () => {
      const side = Math.floor(rnd() * 4);
      const t = rnd();
      if (side === 0) return [t * W, -10];
      if (side === 1) return [W + 10, t * H];
      if (side === 2) return [t * W, H + 10];
      return [-10, t * H];
    };
    const sparks = Array.from({ length: 10 }, () => {
      const [x0, y0] = edge();
      const [x1, y1] = edge();
      const c1 = [CX + (rnd() - 0.5) * 260, CY + (rnd() - 0.5) * 320];
      const c2 = [CX + (rnd() - 0.5) * 260, CY + (rnd() - 0.5) * 320];
      return {
        d: `M${x0.toFixed(1)} ${y0.toFixed(1)} C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`,
        w: 0.5 + rnd() * 1.3,
        o: 0.3 + rnd() * 0.45,
      };
    });

    return { rays, swirls, sparks };
  }, []);
}

const ICONS: Record<CardId, ReactNode> = {
  thief: (
    <>
      <circle cx="12" cy="9" r="6.5" />
      <path d="M12 5.5V9l2.2 1.6" />
      <path d="M20 20H5M8.5 16.5L5 20l3.5 3.5" />
    </>
  ),
  overclock: (
    <>
      <circle cx="11" cy="13" r="7" />
      <path d="M11 9v4l2.5 2" />
      <path d="M19 2v6M16 5h6" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7.5 3c0 5 9 6 9 9s-9 4-9 9M16.5 3c0 5-9 6-9 9s9 4 9 9" />
      <path d="M10 18.5h4" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 8v8M14.5 8v8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  leap: <path d="M6 13l6-6 6 6M6 19l6-6 6 6" />,
  swap: <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />,
  retreat: <path d="M9 5L4 10l5 5M4 10h10a6 6 0 0 1 0 12h-3" />,
};

type Props = {
  card?: CardId;
  face?: "front" | "back";
  width?: number;
  disabled?: boolean;
  selected?: boolean;
  compact?: boolean;
  title?: string;
  onClick?: () => void;
  onHover?: (hovering: boolean) => void;
};

export default function ActionCard({
  card,
  face = card ? "front" : "back",
  width = 180,
  disabled = false,
  selected = false,
  compact = false,
  title,
  onClick,
  onHover,
}: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `${name}-${uid}`;
  const url = (name: string) => `url(#${id(name)})`;
  const art = useArt();
  const def = card ? CARDS[card] : null;
  const front = face === "front" && def;

  const classes = ["acard"];
  if (front) classes.push("is-front");
  if (disabled) classes.push("is-disabled");
  if (selected) classes.push("is-selected");
  if (onClick) classes.push("is-clickable");
  if (compact) classes.push("is-compact");

  const body = (
    <>
      <svg className="acard-art" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          <radialGradient id={id("bg")} cx="50%" cy="52%" r="65%">
            <stop offset="0" stopColor="#FFC46B" />
            <stop offset="0.22" stopColor="#E8741F" />
            <stop offset="0.55" stopColor="#8A2A08" />
            <stop offset="1" stopColor="#2A0802" />
          </radialGradient>
          <linearGradient id={id("pawnFill")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3A1004" />
            <stop offset="0.5" stopColor="#7A2A08" />
            <stop offset="1" stopColor="#2A0A03" />
          </linearGradient>
          <radialGradient id={id("star")} cx="50%" cy="50%" r="50%">
            <stop offset="0.2" stopColor="#5A1A05" />
            <stop offset="0.75" stopColor="#F2A23C" />
            <stop offset="1" stopColor="#FFE2A0" />
          </radialGradient>
          <filter id={id("glow")} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={id("soft")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
          <filter id={id("inner")} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <clipPath id={id("pawnClip")}>
            <path d={PAWN} />
          </clipPath>
          <filter id={id("scorch")} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="7" />
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
          <clipPath id={id("clip")}>
            <rect x="0" y="0" width={W} height={H} rx="14" />
          </clipPath>
        </defs>

        <g clipPath={url("clip")}>
          <rect width={W} height={H} fill={url("bg")} />

          <g className="acard-rays" filter={url("soft")}>
            {art.rays.map((r, i) => (
              <path key={i} d={r.d} fill="#FFD9A0" opacity={r.o} />
            ))}
          </g>

          <g className="acard-swirl" filter={url("glow")}>
            {art.swirls.map((s, i) => (
              <path
                key={i}
                d={s.d}
                fill="none"
                stroke={i % 3 === 0 ? "#FFE58A" : "#FFAA3C"}
                strokeWidth={s.w}
                strokeLinecap="round"
                opacity={s.o}
              />
            ))}
          </g>

          <g filter={url("glow")} opacity="0.9">
            {art.sparks.map((s, i) => (
              <path key={i} d={s.d} fill="none" stroke="#FFD25A" strokeWidth={s.w} strokeLinecap="round" opacity={s.o} />
            ))}
          </g>

          {front ? (
            <>
              <rect width={W} height={H} fill="#1A0602" opacity="0.38" />
              <circle cx={CX} cy="150" r="62" fill="#2A0A03" opacity="0.75" />
              <path d={heptagram(CX, 150, 70)} fill={url("star")} opacity="0.45" />
              <g
                transform={`translate(${CX - 54} ${150 - 54}) scale(4.5)`}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <g stroke="#FF8A2A" strokeWidth="3.2" filter={url("soft")} opacity="0.9">
                  {ICONS[def.id]}
                </g>
                <g stroke="#FFE9C2" strokeWidth="1.5">
                  {ICONS[def.id]}
                </g>
              </g>
              <rect x="0" y="232" width={W} height={H - 232} fill="#160501" opacity="0.72" />
            </>
          ) : (
            <>
              <path
                d={PAWN}
                fill="none"
                stroke="#FF8A2A"
                strokeWidth="30"
                strokeLinejoin="round"
                opacity="0.5"
                filter={url("inner")}
              />
              <path d={PAWN} fill={url("pawnFill")} opacity="0.78" />
              <g clipPath={url("pawnClip")}>
                <path
                  d={PAWN}
                  fill="none"
                  stroke="#1A0401"
                  strokeWidth="26"
                  strokeLinejoin="round"
                  opacity="0.85"
                  filter={url("inner")}
                />
              </g>
              <g filter={url("glow")}>
                <path d={heptagram(CX, 198, 74)} fill={url("star")} stroke="#FFE7B0" strokeWidth="1" opacity="0.95" />
                <path d={heptagon(CX, 198, 74 * 0.357)} fill="#230701" />
              </g>
              <path d={PAWN} fill="none" stroke="#E8701E" strokeWidth="12" strokeLinejoin="round" />
              <path d={PAWN} fill="none" stroke="#FFB55A" strokeWidth="5" strokeLinejoin="round" />
              <path d={PAWN} fill="none" stroke="#FFF0C8" strokeWidth="1.3" strokeLinejoin="round" opacity="0.9" />
            </>
          )}
        </g>

        <rect
          x="5"
          y="5"
          width={W - 10}
          height={H - 10}
          rx="11"
          fill="none"
          stroke="#FF9A3C"
          strokeWidth="7"
          filter={url("scorch")}
        />
        <rect x="9" y="9" width={W - 18} height={H - 18} rx="9" fill="none" stroke="#FFD08A" strokeWidth="1" opacity="0.7" />

        {front && (
          <g filter={url("glow")}>
            <circle cx="36" cy="38" r="19" fill="#2A0802" stroke="#FFB04D" strokeWidth="2.5" />
          </g>
        )}
      </svg>

      {front && (
        <>
          <span className="acard-cost" aria-label={`Cost ${def.cost}`}>
            {def.cost}
          </span>
          <span className="acard-kind">{def.kind === "time" ? "Time" : "Board"}</span>
          <span className="acard-name">{def.name}</span>
          <span className="acard-text">{def.text}</span>
        </>
      )}
    </>
  );

  const style = { "--card-w": `${width}px` } as CSSProperties;
  const label = front ? `${def.name}, cost ${def.cost}. ${def.text}` : "Action card";

  if (onClick) {
    return (
      <button
        className={classes.join(" ")}
        style={style}
        onClick={onClick}
        aria-disabled={disabled}
        aria-pressed={selected}
        aria-label={label}
        title={title}
        onPointerEnter={() => onHover?.(true)}
        onPointerLeave={() => onHover?.(false)}
        onFocus={() => onHover?.(true)}
        onBlur={() => onHover?.(false)}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={classes.join(" ")} style={style} role="img" aria-label={label}>
      {body}
    </div>
  );
}