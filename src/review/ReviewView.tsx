import { t } from "../i18n";
import "./Review.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import Board, { type Badge, type BoardProps, type Hint } from "../components/Board";
import Safe3D from "../three/Safe3D";
import PlayerStrip from "../components/PlayerStrip";
import { useSounds } from "../game/useSounds";
import { useAnalysis, type AltEval, type PositionEval, type TurnEval } from "./analyse";
import { VERDICTS, VERDICT_ORDER, judge, scoreText, winChance, type Judged } from "./judge";
import { opinion } from "./coach";
import { type GameRecord, type Side } from "./record";
import { turnsOf } from "./cardTurns";
import { judgeCards } from "./cardJudge";
import { CARDS } from "../../shared/cards";

type Props = {
  record: GameRecord;
  mode: "default" | "sim";
  canThree: boolean;
  onThreeFail: () => void;
  soundOn: boolean;
  onClose: () => void;
  closeLabel: string;
};

type LineView = {
  kind: "best" | "reply" | "card" | "alt" | "threat";
  steps: { fen: string; from: Square; to: Square; san: string }[];
  index: number;
};

const BAD = new Set(["inaccuracy", "mistake", "blunder", "miss"]);

export function moveLabel(ply: number, san: string) {
  return `${Math.ceil(ply / 2)}${ply % 2 === 1 ? "." : "…"} ${san}`;
}

function lineFrom(fen: string, uci: string[], max = 8) {
  const chess = new Chess(fen);
  const steps: LineView["steps"] = [];
  for (const u of uci.slice(0, max)) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      steps.push({ fen: m.after, from: m.from as Square, to: m.to as Square, san: m.san });
    } catch {
      break;
    }
  }
  return steps;
}

function cardLine(fen: string, squares: string[], label: string, pv: string[] = []): LineView["steps"] {
  const from = (squares[0] ?? "a1") as Square;
  const to = (squares[1] ?? squares[0] ?? "a1") as Square;
  return [{ fen, from, to, san: label }, ...lineFrom(fen, pv, 6)];
}

const BANNER: Record<LineView["kind"], string> = {
  best: t("Best line"),
  reply: t("Opponent's best reply"),
  card: "After the card",
  alt: t("The stronger card"),
  threat: t("The card this allows"),
};

function checkSquareOf(chess: Chess): Square | null {
  if (!chess.isCheck()) return null;
  return (chess.findPiece({ type: "k", color: chess.turn() })[0] as Square) ?? null;
}

function EvalBar({ score, flipped }: { score: number | null; flipped: boolean }) {
  const white = score === null ? 50 : winChance(score);
  return (
    <div className={"rv-evalbar" + (flipped ? " is-flipped" : "")} title={score === null ? t("Analysing…") : t("Evaluation {score}", { score: scoreText(score) })}>
      <div className="rv-evalbar-white" style={{ height: `${white}%` }} />
      <span className={"rv-evalbar-text" + (white >= 50 ? " is-white" : " is-black")}>
        {score === null ? "…" : scoreText(score).replace("+", "")}
      </span>
    </div>
  );
}

export default function ReviewView({ record, mode, canThree, onThreeFail, soundOn, onClose, closeLabel }: Props) {
  const state = useAnalysis(record);
  const game = useMemo(() => turnsOf(record), [record]);
  const plies = game.plies;
  const positions: PositionEval[] =
    state?.status === "done" ? state.analysis.positions : state?.status === "running" ? state.partial : [];
  const turnEvals: TurnEval[] =
    state?.status === "done" ? (state.analysis.turns ?? []) : state?.status === "running" ? state.turns : [];
  const result = useMemo(() => judge(plies, positions, turnEvals), [plies, positions, turnEvals]);
  const you = record.you;
  const cardResult = useMemo(
    () => judgeCards(game, positions, turnEvals, result.moves, record, you),
    [game, positions, turnEvals, result, record, you]
  );
  const startOf = (n: number): PositionEval | undefined => turnEvals[n]?.pre ?? positions[n];
  const [ply, setPly] = useState(0);
  const [line, setLine] = useState<LineView | null>(null);
  const play = useSounds(soundOn);
  const flipped = you === "b";
  const listRef = useRef<HTMLDivElement>(null);

  function go(target: number) {
    const next = Math.max(0, Math.min(plies.length, target));
    setLine(null);
    if (next === ply) return;
    const m = next > 0 ? plies[next - 1] : null;
    if (m && next > ply) play(m.captured ? "capture" : /[kq]/.test(m.flags) ? "castle" : "move");
    setPly(next);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape" && line) setLine(null);
      else if (e.key === "ArrowLeft") go(ply - 1);
      else if (e.key === "ArrowRight") go(ply + 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(plies.length);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!line || line.index >= line.steps.length - 1) return;
    const id = window.setTimeout(() => {
      setLine((l) => (l ? { ...l, index: l.index + 1 } : l));
      play("move");
    }, 850);
    return () => window.clearTimeout(id);
  }, [line]);

  useEffect(() => {
    listRef.current?.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
  }, [ply]);

  const judged: Judged | null = ply > 0 ? (result.moves[ply - 1] ?? null) : null;
  const after = startOf(ply);
  const view = judged && after ? opinion(judged, positions[ply - 1], after, you, ply > 1 ? plies[ply - 2] : null) : null;
  const turn = ply > 0 ? game.turns[ply - 1] : null;
  const card = ply > 0 ? (cardResult.cards[ply - 1] ?? null) : null;
  const missed = ply > 0 ? (cardResult.missed[ply - 1] ?? null) : null;
  const allowed = ply > 0 ? (cardResult.allowed[ply - 1] ?? null) : null;

  let fen = ply > 0 ? plies[ply - 1].after : new Chess().fen();
  let lastMove: { from: Square; to: Square } | null = ply > 0 ? { from: plies[ply - 1].from as Square, to: plies[ply - 1].to as Square } : null;
  const hints: Hint[] = [];
  let badge: Badge | null = null;
  if (line) {
    const step = line.steps[line.index];
    fen = step.fen;
    lastMove = { from: step.from, to: step.to };
  } else if (judged) {
    const v = judged.verdict;
    if (judged.best && judged.best !== judged.uci && (BAD.has(v) || v === "good")) {
      hints.push({ from: judged.best.slice(0, 2) as Square, to: judged.best.slice(2, 4) as Square, tone: "best" });
    }
    if (BAD.has(v)) hints.push({ from: judged.from as Square, to: judged.to as Square, tone: "played" });
    badge = { square: judged.to as Square, mark: VERDICTS[v].mark, tone: v, label: VERDICTS[v].label };
  }
  const chess = new Chess(fen);
  const boardProps: BoardProps = {
    board: chess.board(),
    selected: null,
    legalTargets: [],
    lastMove,
    moveKey: line ? 200000 + line.index : 100000 + ply,
    checkSquare: checkSquareOf(chess),
    flipped,
    draggableColor: null,
    onSquareClick: () => undefined,
    hints,
    badge,
  };
  const shownScore = line ? null : (startOf(ply)?.score ?? null);

  const running = state?.status === "running";
  const done = state?.status === "done";
  const nameOf = (s: Side) => (s === "w" ? record.white : record.black);
  const top: Side = flipped ? "w" : "b";
  const bottom: Side = flipped ? "b" : "w";
  const accuracyText = (s: Side) => (done ? `${Math.round(result.accuracy[s])}%` : "…");

  function showLine(kind: LineView["kind"]) {
    if (!judged) return;
    const steps =
      kind === "best"
        ? lineFrom(judged.before, positions[ply - 1]?.pv ?? [])
        : lineFrom(judged.after, startOf(ply)?.pv ?? [], 6);
    if (!steps.length) return;
    setLine({ kind, steps, index: 0 });
    play("move");
  }

  function showCard() {
    if (!card?.shown) return;
    setLine({ kind: "card", steps: cardLine(card.shown.fen, card.shown.squares, card.label), index: 0 });
    play("move");
  }

  function showAlt(alt: AltEval, label: string, kind: LineView["kind"] = "alt") {
    setLine({ kind, steps: cardLine(alt.fen, alt.squares, label, alt.pv), index: 0 });
    play("move");
  }

  const rows: { n: number; w?: Judged | (typeof plies)[number]; b?: Judged | (typeof plies)[number] }[] = [];
  for (let i = 0; i < plies.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: result.moves[i] ?? plies[i], b: result.moves[i + 1] ?? plies[i + 1] });
  }
  const cardTag = (n: number) => {
    const played = game.turns[n - 1]?.card;
    if (!played) {
      return plies[n - 1].afterCard ? (
        <span className="rv-cardtag" title={t("A card changed the board before this move")}>
          {t("card")}
        </span>
      ) : null;
    }
    const judgedCard = cardResult.cards[n - 1];
    return (
      <span
        className={"rv-cardtag" + (judgedCard?.verdict ? " tone-" + judgedCard.verdict : "")}
        title={judgedCard ? `${judgedCard.label}: ${judgedCard.title}` : t(CARDS[played.card].name)}
      >
        {t(CARDS[played.card].name).split(" ").pop()}
      </span>
    );
  };
  const cell = (m: Judged | (typeof plies)[number] | undefined) => {
    if (!m) return <span className="rv-cell is-empty" />;
    const verdict = "verdict" in m ? m.verdict : null;
    return (
      <button
        className={"rv-cell" + (m.ply === ply ? " is-current" : "") + (verdict ? " tone-" + verdict : "")}
        onClick={() => go(m.ply)}
        aria-label={moveLabel(m.ply, m.san) + (verdict ? `, ${VERDICTS[verdict].label}` : "")}
      >
        {cardTag(m.ply)}
        {m.san}
        {verdict && verdict !== "excellent" && verdict !== "good" && <span className="rv-mark">{VERDICTS[verdict].mark}</span>}
        {cardResult.missed[m.ply - 1] && (
          <span className="rv-missedtag" title={t("Missed card: {label}", { label: cardResult.missed[m.ply - 1]!.label })}>
            ◇
          </span>
        )}
      </button>
    );
  };

  return (
    <main className="table rv">
      <section className="board-column">
        <PlayerStrip name={nameOf(top)} detail={t("{v1} · Accuracy", { v1: top === "w" ? "White" : "Black" })} time={accuracyText(top)} />
        <div className="rv-boardrow">
          <EvalBar score={shownScore} flipped={flipped} />
          <div className={"board-wrap" + (line ? " is-reviewing" : "")}>
            {mode === "sim" && canThree ? (
              <Safe3D props={boardProps} fallback={<Board {...boardProps} />} onFail={onThreeFail} />
            ) : (
              <Board {...boardProps} />
            )}
            {line && (
              <button className="review-banner" onClick={() => setLine(null)}>
                {BANNER[line.kind]}: {line.steps.slice(0, line.index + 1).map((s) => s.san).join(" ")}
                <span className="review-banner-live">{t("Back ⏎")}</span>
              </button>
            )}
          </div>
        </div>
        <PlayerStrip name={nameOf(bottom)} detail={t("{v1} · Accuracy", { v1: bottom === "w" ? "White" : "Black" })} time={accuracyText(bottom)} />
      </section>

      <div className="side-column">
        <section className="rv-panel" aria-label={t("Game review")}>
          <header className="rv-head">
            <div>
              <h2 className="rv-title">{t("Game review")}</h2>
              <p className="rv-result">{record.result}</p>
            </div>
            <button className="rv-close" onClick={onClose}>
              {closeLabel}
            </button>
          </header>

          {state?.status === "unsupported" && <p className="rv-note">{state.reason}</p>}
          {record.cards && !game.known && state?.status !== "unsupported" && (
            <p className="rv-note">{t("The cards of this game weren't saved, so only the moves are judged.")}</p>
          )}
          {state?.status === "error" && <p className="rv-note is-bad">{state.message}</p>}
          {running && (
            <div className="rv-progress" role="status">
              <span>
                {t("Analysing…")} {state.done} {t("of")} {state.total} {t("positions")}
              </span>
              <div className="rv-progress-bar">
                <div style={{ width: `${(state.done / state.total) * 100}%` }} />
              </div>
            </div>
          )}

          <div className="rv-moment" aria-live="polite">
            {ply === 0 ? (
              <>
                <p className="rv-moment-title">{t("Start position")}</p>
                <p className="rv-text">
                  {t("Step through the game with ▶ or the arrow keys. Each move gets a verdict, an opinion, and the better move when there was one.")}{game.known ? t(" Each card played is judged too, and a card that should have been played is pointed out.") : ""}
                </p>
              </>
            ) : !judged || !view ? (
              <>
                <p className="rv-moment-title">{moveLabel(ply, plies[ply - 1].san)}</p>
                <p className="rv-text">{t("The coach is still looking at this move…")}</p>
              </>
            ) : (
              <>
                {turn?.card && !card && (
                  <div className="rv-card">
                    <p className="rv-card-title">
                      <span className="rv-chip">◆</span>
                      {t(CARDS[turn.card.card].name)}
                    </p>
                    <p className="rv-text">{t("The coach is still looking at this card…")}</p>
                  </div>
                )}
                {card && (
                  <div className={"rv-card" + (card.verdict ? " tone-" + card.verdict : "")}>
                    <p className="rv-card-title">
                      <span className="rv-chip">◆</span>
                      {card.label} · {card.title}
                    </p>
                    <p className="rv-text">{card.text}</p>
                    {card.better && (
                      <div className="rv-better">
                        <span className="rv-better-label">{t("Stronger card")}</span>
                        <strong>{card.better.label}</strong> {card.better.why}
                      </div>
                    )}
                    {card.chance && <p className="rv-chance">{card.chance}</p>}
                    {(card.shown || card.better) && (
                      <div className="rv-actions">
                        {card.shown && (
                          <button className="rv-btn" onClick={showCard}>
                            {t("Show the card")}
                          </button>
                        )}
                        {card.better && (
                          <button className="rv-btn" onClick={() => showAlt(card.better!.alt, card.better!.label)}>
                            {t("Show the stronger card")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <p className={"rv-moment-title tone-" + judged.verdict}>
                  <span className="rv-chip">{VERDICTS[judged.verdict].mark}</span>
                  {moveLabel(ply, judged.san)} · {view.title}
                </p>
                <p className="rv-text">{allowed ? allowed.text : view.text}</p>
                {view.better && (
                  <div className="rv-better">
                    <span className="rv-better-label">{BAD.has(judged.verdict) ? t("Better") : t("The coach preferred")}</span>
                    <strong>{view.better.san}</strong> {view.better.why}
                  </div>
                )}
                <p className="rv-chance">{view.chance}</p>
                <div className="rv-actions">
                  {view.line && view.line.san.length > 0 && (
                    <button className="rv-btn" onClick={() => showLine("best")}>
                      {t("Show best line")}
                    </button>
                  )}
                  {allowed ? (
                    <button className="rv-btn" onClick={() => showAlt(allowed.alt, allowed.label, "threat")}>
                      {t("Show the card")}
                    </button>
                  ) : (
                    view.reply &&
                    view.reply.san.length > 0 && (
                      <button className="rv-btn" onClick={() => showLine("reply")}>
                        {t("Show the punishment")}
                      </button>
                    )
                  )}
                </div>
                {missed && (
                  <div className="rv-card tone-miss">
                    <p className="rv-card-title">
                      <span className="rv-chip">◇</span>
                      {t("Missed card ·")} {missed.label}
                    </p>
                    <p className="rv-text">
                      {t("Playing this card before the move was much stronger.")} {missed.text}
                    </p>
                    <div className="rv-actions">
                      <button className="rv-btn" onClick={() => showAlt(missed.alt, missed.label)}>
                        {t("Show the card")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rv-nav">
            <button className="rv-btn" onClick={() => go(0)} disabled={ply === 0} aria-label={t("First move")}>⏮</button>
            <button className="rv-btn" onClick={() => go(ply - 1)} disabled={ply === 0} aria-label={t("Previous move")}>◀</button>
            <button className="rv-btn" onClick={() => go(ply + 1)} disabled={ply === plies.length} aria-label={t("Next move")}>▶</button>
            <button className="rv-btn" onClick={() => go(plies.length)} disabled={ply === plies.length} aria-label={t("Last move")}>⏭</button>
          </div>

          <div className="rv-moves" ref={listRef}>
            {rows.map((r) => (
              <div className="rv-row" key={r.n}>
                <span className="rv-num">{r.n}</span>
                {cell(r.w)}
                {cell(r.b)}
              </div>
            ))}
          </div>

          {done && (
            <details className="rv-counts">
              <summary>{t("Move quality")}</summary>
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>{t("White")}</th>
                    <th>{t("Black")}</th>
                  </tr>
                </thead>
                <tbody>
                  {VERDICT_ORDER.map((v) => (
                    <tr key={v} className={"tone-" + v}>
                      <td>
                        <span className="rv-chip">{VERDICTS[v].mark}</span>
                        {VERDICTS[v].label}
                      </td>
                      <td>{result.counts.w[v]}</td>
                      <td>{result.counts.b[v]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {game.known && (
                <table className="rv-cardcounts">
                  <thead>
                    <tr>
                      <th>{t("Cards")}</th>
                      <th>{t("White")}</th>
                      <th>{t("Black")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="tone-best">
                      <td>{t("Good cards")}</td>
                      <td>{cardResult.tally.w.good}</td>
                      <td>{cardResult.tally.b.good}</td>
                    </tr>
                    <tr className="tone-inaccuracy">
                      <td>{t("Little effect")}</td>
                      <td>{cardResult.tally.w.weak}</td>
                      <td>{cardResult.tally.b.weak}</td>
                    </tr>
                    <tr className="tone-blunder">
                      <td>{t("Bad cards")}</td>
                      <td>{cardResult.tally.w.bad}</td>
                      <td>{cardResult.tally.b.bad}</td>
                    </tr>
                    <tr className="tone-miss">
                      <td>{t("Missed cards")}</td>
                      <td>{cardResult.tally.w.missed}</td>
                      <td>{cardResult.tally.b.missed}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </details>
          )}
        </section>
      </div>
    </main>
  );
}