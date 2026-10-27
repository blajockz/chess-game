import "./Board.css";
import { useEffect, useRef, useState } from "react";
import type { Square } from "chess.js";

type PromotionPiece = "q" | "r" | "b" | "n";
type Pending = { from: Square; to: Square; color: "w" | "b" };
type Arrow = { from: Square; to: Square };

const GLYPHS: Record<string, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const NAMES: Record<string, string> = {
  p: "pawn",
  r: "rook",
  n: "knight",
  b: "bishop",
  q: "queen",
  k: "king",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

const HEAD_LEN = 0.34;
const HEAD_HALF = 0.19;
const START_GAP = 0.3;

type Cell = { square: Square; type: string; color: "w" | "b" } | null;

export type BoardProps = Props;

type Props = {
  board: Cell[][];
  selected: Square | null;
  legalTargets: Square[];
  lastMove: { from: Square; to: Square } | null;
  lastCapture?: Square | null;
  moveKey?: number;
  checkSquare: Square | null;
  matedSquare?: Square | null;
  pending?: Pending | null;
  premove?: { from: Square; to: Square } | null;
  premoveFrom?: Square | null;
  onPromote?: (piece: PromotionPiece) => void;
  onCancelPromotion?: () => void;
  draggableColor?: "w" | "b" | null;
  flipped?: boolean;
  onSquareClick: (square: Square) => void;
  cardTargets?: Square[];
  cardPicked?: Square[];
  cardFlash?: { squares: Square[]; key: number } | null;
  shielded?: Square | null;
};

export default function Board({
  board,
  selected,
  legalTargets,
  lastMove,
  lastCapture = null,
  moveKey = 0,
  checkSquare,
  matedSquare = null,
  pending = null,
  premove = null,
  premoveFrom = null,
  onPromote,
  onCancelPromotion,
  draggableColor = null,
  flipped = false,
  onSquareClick,
  cardTargets = [],
  cardPicked = [],
  cardFlash = null,
  shielded = null,
}: Props) {
  const targeting = cardTargets.length > 0 || cardPicked.length > 0;
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [marks, setMarks] = useState<Square[]>([]);
  const dragFrom = useRef<Square | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    square: Square;
    type: string;
    color: "w" | "b";
    x: number;
    y: number;
    wasActive: boolean;
  } | null>(null);

  useEffect(() => {
    setArrows([]);
    setMarks([]);
  }, [moveKey]);

  useEffect(() => {
    const drop = () => {
      dragFrom.current = null;
    };
    window.addEventListener("pointerup", drop);
    return () => window.removeEventListener("pointerup", drop);
  }, []);

  function endDrag(to: Square) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!from) return;

    if (from === to) {
      setMarks((m) => (m.includes(to) ? m.filter((s) => s !== to) : [...m, to]));
      return;
    }

    setArrows((list) => {
      const hit = list.findIndex((a) => a.from === from && a.to === to);
      if (hit !== -1) return list.filter((_, i) => i !== hit);
      return [...list, { from, to }];
    });
  }

  function squareAt(clientX: number, clientY: number): Square | null {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const size = rect.width / 8;
    const vc = Math.floor((clientX - rect.left) / size);
    const vr = Math.floor((clientY - rect.top) / size);
    if (vc < 0 || vc > 7 || vr < 0 || vr > 7) return null;
    const col = flipped ? 7 - vc : vc;
    const row = flipped ? 7 - vr : vr;
    return (FILES[col] + (8 - row)) as Square;
  }

  useEffect(() => {
    if (!drag) return;

    const move = (e: PointerEvent) => {
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    };

    const up = (e: PointerEvent) => {
      const target = squareAt(e.clientX, e.clientY);
      setDrag(null);

      if (target && target !== drag.square) {
        onSquareClick(target);
        return;
      }
      if (drag.wasActive) onSquareClick(drag.square);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag?.square]);

  function viewOf(square: Square) {
    const col = FILES.indexOf(square[0]);
    const row = 8 - Number(square[1]);
    return flipped ? { c: 7 - col, r: 7 - row } : { c: col, r: row };
  }

  const rows = [0, 1, 2, 3, 4, 5, 6, 7];
  const order = flipped ? [...rows].reverse() : rows;
  const cols = flipped ? [...rows].reverse() : rows;

  const squares = [];

  for (const row of order) {
    for (const col of cols) {
      const name = (FILES[col] + (8 - row)) as Square;
      const cell = board[row][col];
      const isLight = (row + col) % 2 === 0;
      const isTarget = legalTargets.includes(name);

      const classes = ["sq", isLight ? "is-light" : "is-dark"];
      if (selected === name) classes.push("is-selected");
      else if (lastMove && (lastMove.from === name || lastMove.to === name)) {
        classes.push("is-last");
      }
      if (checkSquare === name) classes.push("is-check");
      if (matedSquare === name) classes.push("is-mated");
      if (pending && (pending.from === name || pending.to === name)) {
        classes.push("is-promoting");
      }
      if (cardTargets.includes(name)) classes.push("is-card-target");
      if (cardPicked.includes(name)) classes.push("is-card-picked");
      if (
        premoveFrom === name ||
        (premove && (premove.from === name || premove.to === name))
      ) {
        classes.push("is-premove");
      }

      const showRank = flipped ? col === 7 : col === 0;
      const showFile = flipped ? row === 0 : row === 7;

      squares.push(
        <button
          key={name}
          className={classes.join(" ")}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSquareClick(name);
            }
          }}
          onPointerDown={(e) => {
            if (e.button === 2) {
              e.preventDefault();
              dragFrom.current = name;
              return;
            }
            if (e.button !== 0) return;

            setArrows([]);
            setMarks([]);

            if (targeting) {
              onSquareClick(name);
              return;
            }

            const canLift =
              cell && draggableColor !== null && cell.color === draggableColor;
            const isTarget2 = !!selected && legalTargets.includes(name);

            if (isTarget2) {
              onSquareClick(name);
              return;
            }

            if (canLift) {
              const active = (selected ?? premoveFrom) === name;
              if (!active) onSquareClick(name);
              e.preventDefault();
              setDrag({
                square: name,
                type: cell.type,
                color: cell.color,
                x: e.clientX,
                y: e.clientY,
                wasActive: active,
              });
              return;
            }

            onSquareClick(name);
          }}
          onPointerUp={(e) => {
            if (e.button === 2) {
              e.preventDefault();
              endDrag(name);
            }
          }}
          aria-label={name}
        >
          {showRank && <span className="coord is-rank">{8 - row}</span>}
          {showFile && <span className="coord is-file">{FILES[col]}</span>}

          {cell && (
            <span
              className={
                "piece " +
                (cell.color === "w" ? "is-white" : "is-black") +
                (matedSquare === name ? " is-mated" : "") +
                (lastMove?.to === name && matedSquare !== name ? " is-landing" : "") +
                (drag?.square === name ? " is-lifted" : "")
              }
              role="img"
              aria-label={`${cell.color === "w" ? "white" : "black"} ${NAMES[cell.type]}`}
            >
              {GLYPHS[cell.type]}
            </span>
          )}

          {isTarget && <span className={cell ? "hint is-capture" : "hint"} />}

          {lastCapture === name && <span key={moveKey} className="burst" />}

          {cardFlash?.squares.includes(name) && (
            <span key={`f${cardFlash.key}`} className="card-flash" />
          )}

          {shielded === name && <span className="shield-mark" aria-label="shielded" />}
        </button>
      );
    }
  }

  const promoCol = pending ? FILES.indexOf(pending.to[0]) : 0;
  const promoRow = pending ? 8 - Number(pending.to[1]) : 0;
  const viewCol = flipped ? 7 - promoCol : promoCol;
  const viewRow = flipped ? 7 - promoRow : promoRow;
  const dropDown = viewRow < 4;

  return (
    <div
      className={
        "board-frame" + (drag ? " is-dragging" : "") + (targeting ? " is-targeting" : "")
      }
    >
      {drag && (
        <span
          className={"piece drag-piece " + (drag.color === "w" ? "is-white" : "is-black")}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          {GLYPHS[drag.type]}
        </span>
      )}

      <div
        className="board"
        ref={boardRef}
        onContextMenu={(e) => e.preventDefault()}
      >
        {squares}

        {(arrows.length > 0 || marks.length > 0) && (
          <svg className="annot" viewBox="0 0 8 8" aria-hidden="true">
            {marks.map((square) => {
              const { c, r } = viewOf(square);
              return (
                <circle
                  key={`m${square}`}
                  className="annot-mark"
                  cx={c + 0.5}
                  cy={r + 0.5}
                  r={0.42}
                />
              );
            })}

            {arrows.map((a, i) => {
              const f = viewOf(a.from);
              const t = viewOf(a.to);
              const fx = f.c + 0.5;
              const fy = f.r + 0.5;
              const tx = t.c + 0.5;
              const ty = t.r + 0.5;

              const dc = t.c - f.c;
              const dr = t.r - f.r;
              const isKnight =
                (Math.abs(dc) === 1 && Math.abs(dr) === 2) ||
                (Math.abs(dc) === 2 && Math.abs(dr) === 1);

              const corner = isKnight
                ? Math.abs(dr) > Math.abs(dc)
                  ? { x: fx, y: ty }
                  : { x: tx, y: fy }
                : null;

              const ax = corner ? corner.x : fx;
              const ay = corner ? corner.y : fy;
              const lx = tx - ax;
              const ly = ty - ay;
              const llen = Math.hypot(lx, ly) || 1;
              const ux = lx / llen;
              const uy = ly / llen;

              const endX = tx - ux * HEAD_LEN;
              const endY = ty - uy * HEAD_LEN;

              let startX = fx;
              let startY = fy;
              if (!corner) {
                startX = fx + ux * START_GAP;
                startY = fy + uy * START_GAP;
              } else {
                const sx = corner.x - fx;
                const sy = corner.y - fy;
                const slen = Math.hypot(sx, sy) || 1;
                startX = fx + (sx / slen) * START_GAP;
                startY = fy + (sy / slen) * START_GAP;
              }

              const points = corner
                ? `${startX},${startY} ${corner.x},${corner.y} ${endX},${endY}`
                : `${startX},${startY} ${endX},${endY}`;

              const px = -uy;
              const py = ux;

              return (
                <g className="annot-arrow" key={`a${i}`}>
                  <polyline points={points} />
                  <polygon
                    points={[
                      `${tx},${ty}`,
                      `${endX + px * HEAD_HALF},${endY + py * HEAD_HALF}`,
                      `${endX - px * HEAD_HALF},${endY - py * HEAD_HALF}`,
                    ].join(" ")}
                  />
                </g>
              );
            })}
          </svg>
        )}

        {pending && (
          <>
            <button
              className="promo-veil"
              onClick={onCancelPromotion}
              aria-label="Cancel promotion"
            />
            <div
              className={"promo" + (dropDown ? " is-down" : " is-up")}
              style={{
                left: `calc(var(--sq) * ${viewCol})`,
                top: `calc(var(--sq) * ${dropDown ? viewRow : viewRow - 3})`,
              }}
              role="group"
              aria-label="Choose promotion piece"
            >
              {(["q", "r", "b", "n"] as PromotionPiece[]).map((type) => (
                <button
                  key={type}
                  className="promo-pick"
                  onClick={() => onPromote?.(type)}
                  aria-label={`Promote to ${NAMES[type]}`}
                >
                  <span
                    className={
                      "piece " + (pending.color === "w" ? "is-white" : "is-black")
                    }
                  >
                    {GLYPHS[type]}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}