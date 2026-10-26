import "./MovePanel.css";
import { useEffect, useRef, useState } from "react";

type Move = { white: string; black?: string; whiteCard?: string; blackCard?: string };

export type DrawState = "idle" | "waiting" | "declined";

type Props = {
  moves?: Move[];
  status?: string | null;
  over?: boolean;
  drawState?: DrawState;
  canOfferDraw?: boolean;
  resignLockedFor?: number;
  onResign?: () => void;
  onOfferDraw?: () => void;
  onNewGame?: () => void;
  incomingDraw?: boolean;
  onAcceptDraw?: () => void;
  onDeclineDraw?: () => void;
  deadline?: { text: string; time: string; urgent: boolean } | null;
  review?: {
    current: number;
    viewing: boolean;
    canBack: boolean;
    canForward: boolean;
    first: () => void;
    prev: () => void;
    next: () => void;
    last: () => void;
    jump: (ply: number) => void;
  };
};

type Confirm = "resign" | "draw" | null;

const QUESTION = {
  resign: "Resign this game?",
  draw: "Offer a draw?",
};

const YES = {
  resign: "Resign",
  draw: "Offer",
};

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

export default function MovePanel({
  moves = [],
  status = null,
  over = false,
  drawState = "idle",
  canOfferDraw = true,
  resignLockedFor = 0,
  onResign,
  onOfferDraw,
  onNewGame,
  incomingDraw = false,
  onAcceptDraw,
  onDeclineDraw,
  review,
  deadline = null,
}: Props) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const current = review?.current ?? -1;

  useEffect(() => {
    const list = listRef.current;
    const cell = list?.querySelector<HTMLElement>(".move-cell.is-current");
    if (!list) return;
    if (!cell) {
      list.scrollTop = review?.viewing ? 0 : list.scrollHeight;
      return;
    }
    const top = cell.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (top < 8 || top > list.clientHeight - 40) {
      list.scrollTop += top - list.clientHeight / 2;
    }
  }, [current, moves.length, review?.viewing]);

  function cell(san: string | undefined, card: string | undefined, ply: number) {
    if (!san) return <span className="move-cell is-empty" />;
    return (
      <button
        className={"move-cell" + (ply === current ? " is-current" : "")}
        onClick={() => review?.jump(ply)}
        aria-label={`Show the position after ${san}`}
        aria-current={ply === current ? "step" : undefined}
      >
        {card && <span className="move-card">{card}</span>}
        {san}
      </button>
    );
  }

  useEffect(() => {
    if (over) setConfirm(null);
  }, [over]);

  useEffect(() => {
    if (!confirm) return;
    noRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirm(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  function accept() {
    if (confirm === "resign") onResign?.();
    if (confirm === "draw") onOfferDraw?.();
    setConfirm(null);
  }

  let note: string | null = null;
  if (!over && drawState === "waiting") note = "Draw offered. Waiting for an answer…";
  if (!over && drawState === "declined") note = "Your opponent declined the draw.";

  return (
    <aside className="rail">
      <h2 className="rail-title">Moves</h2>
      {status && (
        <p className={"rail-status" + (over ? " is-over" : "")} role="status">
          {status}
        </p>
      )}

      {deadline && !over && (
        <p className={"rail-deadline" + (deadline.urgent ? " is-urgent" : "")} role="timer">
          <span>{deadline.text}</span>
          <strong>{deadline.time}</strong>
        </p>
      )}

      {moves.length === 0 ? (
        <p className="rail-empty">Play a move to start the record.</p>
      ) : (
        <ol className="move-list" ref={listRef}>
          {moves.map((move, i) => (
            <li className="move-row" key={i}>
              <span className="move-num">{i + 1}</span>
              {cell(move.white, move.whiteCard, i * 2 + 1)}
              {cell(move.black, move.blackCard, i * 2 + 2)}
            </li>
          ))}
        </ol>
      )}

      {review && moves.length > 0 && (
        <div className="review-nav" role="group" aria-label="Review moves">
          <button className="review-btn" onClick={review.first} disabled={!review.canBack} aria-label="First move" title="First move (Home)">
            <NavIcon kind="first" />
          </button>
          <button className="review-btn" onClick={review.prev} disabled={!review.canBack} aria-label="Previous move" title="Previous move (←)">
            <NavIcon kind="prev" />
          </button>
          <button className="review-btn" onClick={review.next} disabled={!review.canForward} aria-label="Next move" title="Next move (→)">
            <NavIcon kind="next" />
          </button>
          <button
            className={"review-btn" + (review.viewing ? " is-live" : "")}
            onClick={review.last}
            disabled={!review.canForward}
            aria-label="Latest move"
            title="Back to the live game (End)"
          >
            <NavIcon kind="last" />
          </button>
        </div>
      )}

      {note && (
        <p className={"rail-note" + (drawState === "waiting" ? " is-waiting" : "")}>
          {note}
        </p>
      )}

      {incomingDraw && !over && (
        <div className="rail-offer" role="alertdialog" aria-label="Draw offer">
          <span className="rail-question">Your opponent offers a draw</span>
          <button className="rail-btn" onClick={onDeclineDraw}>
            Decline
          </button>
          <button className="rail-btn is-yes" onClick={onAcceptDraw}>
            Accept
          </button>
        </div>
      )}

      {over ? (
        <div className="rail-actions">
          <button className="rail-btn is-primary" onClick={onNewGame}>
            New game
          </button>
        </div>
      ) : confirm ? (
        <div
          className={"rail-actions is-confirm" + (confirm === "resign" ? " is-danger" : "")}
          role="alertdialog"
          aria-label={QUESTION[confirm]}
        >
          <span className="rail-question">{QUESTION[confirm]}</span>
          <button ref={noRef} className="rail-btn" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button className="rail-btn is-yes" onClick={accept}>
            {YES[confirm]}
          </button>
        </div>
      ) : (
        <div className="rail-actions">
          <button
            className="rail-btn"
            onClick={() => setConfirm("draw")}
            disabled={!canOfferDraw}
          >
            Offer draw
          </button>
          <button
            className="rail-btn"
            onClick={() => setConfirm("resign")}
            disabled={resignLockedFor > 0}
            title={
              resignLockedFor > 0
                ? "You can resign after the first minute"
                : undefined
            }
          >
            {resignLockedFor > 0 ? (
              <>
                Resign <span className="rail-wait">{resignLockedFor}s</span>
              </>
            ) : (
              "Resign"
            )}
          </button>
        </div>
      )}
    </aside>
  );
}