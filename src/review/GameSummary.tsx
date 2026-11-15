import { t } from "../i18n";
import "./Review.css";
import { useMemo } from "react";
import { useAnalysis } from "./analyse";
import { VERDICTS, judge } from "./judge";
import { gameVerdict } from "./coach";
import { type GameRecord, type Side } from "./record";
import { turnsOf, type CardGame } from "./cardTurns";
import { judgeCards } from "./cardJudge";
import { moveLabel } from "./ReviewView";

type Props = {
  record: GameRecord;
  onReview: () => void;
  saved?: string | null;
  rating?: { before: number; after: number; delta: number } | null;
};

const NAME = { w: t("White"), b: t("Black") };

export default function GameSummary({ record, onReview, saved, rating }: Props) {
  const state = useAnalysis(record);
  const game = useMemo((): CardGame | null => {
    try {
      return turnsOf(record);
    } catch {
      return null;
    }
  }, [record]);
  const result = useMemo(
    () => (state?.status === "done" && game ? judge(game.plies, state.analysis.positions, state.analysis.turns) : null),
    [state, game]
  );
  const me: Side | null = record.you;
  const cards = useMemo(
    () =>
      state?.status === "done" && game?.known && result
        ? judgeCards(game, state.analysis.positions, state.analysis.turns ?? [], result.moves, record, me)
        : null,
    [state, game, result, record, me]
  );
  const tally = cards?.tally[me ?? "w"];
  const cardLine = tally
    ? [
        tally.good ? t("{n} good", { n: tally.good }) : "",
        tally.weak ? t("{weak} with little effect", { weak: tally.weak }) : "",
        tally.bad ? t("{n} bad", { n: tally.bad }) : "",
        tally.missed ? t("{n} missed", { n: tally.missed }) : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const won = record.winner === me;
  const lost = record.winner !== "draw" && me !== null && !won;
  const headline = record.winner === "draw" ? t("Draw") : me === null ? t("{side} won", { side: NAME[record.winner] }) : won ? t("You won") : t("You lost");

  let keyMoment: string | null = null;
  if (result) {
    const mine = result.moves.filter((m) => (me ? m.side === me : true));
    const worst = mine.reduce((a, b) => (b.loss > (a?.loss ?? 0) ? b : a), null as (typeof mine)[number] | null);
    if (worst && worst.loss >= 10) {
      keyMoment = t("{moveLabel} ({v2}): win chance {v3}% → {v4}%.", { moveLabel: moveLabel(worst.ply, worst.san), v2: VERDICTS[worst.verdict].label.toLowerCase(), v3: Math.round(
        worst.winBefore
      ), v4: Math.round(worst.winAfter) });
    }
  }

  return (
    <section className={"rv-summary" + (won ? " is-win" : lost ? " is-loss" : "")} aria-label={t("Game summary")}>
      <p className="rv-summary-kicker">{t("Game over")}</p>
      <h2 className="rv-summary-title">{headline}</h2>
      <p className="rv-summary-result">{record.result}</p>
      {rating && (
        <p className={"rv-rating " + (rating.delta >= 0 ? "is-up" : "is-down")}>
          <span>{t("Rating")}</span>
          {rating.before} → <strong>{rating.after}</strong>
          <em>{rating.delta >= 0 ? `+${rating.delta}` : rating.delta}</em>
        </p>
      )}
      {saved && <p className="rv-summary-saved">{saved}</p>}

      {state?.status === "unsupported" && <p className="rv-note">{state.reason}</p>}
      {state?.status === "error" && <p className="rv-note is-bad">{state.message}</p>}
      {state?.status === "running" && (
        <div className="rv-progress" role="status">
          <span>{t("The coach is checking every move…")} {Math.round((state.done / state.total) * 100)}%</span>
          <div className="rv-progress-bar">
            <div style={{ width: `${(state.done / state.total) * 100}%` }} />
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="rv-acc">
            {(["w", "b"] as Side[]).map((s) => (
              <div key={s} className={"rv-acc-side" + (s === me ? " is-me" : "")}>
                <span className="rv-acc-name">{s === me ? t("You") : s === "w" ? record.white : record.black}</span>
                <strong className="rv-acc-value">{Math.round(result.accuracy[s])}%</strong>
                <span className="rv-acc-label">{t("accuracy")}</span>
                <span className="rv-acc-errors">
                  {result.counts[s].blunder > 0 && <span className="tone-blunder">{result.counts[s].blunder} ??</span>}
                  {result.counts[s].mistake > 0 && <span className="tone-mistake">{result.counts[s].mistake} ?</span>}
                  {result.counts[s].inaccuracy > 0 && <span className="tone-inaccuracy">{result.counts[s].inaccuracy} ?!</span>}
                  {result.counts[s].blunder + result.counts[s].mistake + result.counts[s].inaccuracy === 0 && (
                    <span className="tone-best">{t("No errors")}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="rv-text">
            {gameVerdict(result.accuracy[me ?? "w"], result.counts[me ?? "w"].blunder, result.counts[me ?? "w"].mistake)}
          </p>
          {cardLine && (
            <p className="rv-key">
              <span>{me ? t("Your cards") : t("White's cards")}</span>
              {cardLine}.
            </p>
          )}
          {keyMoment && (
            <p className="rv-key">
              <span>{t("Key moment")}</span>
              {keyMoment}
            </p>
          )}
        </>
      )}

      {result && (
        <button className="rv-review-btn" onClick={onReview}>
          {t("Review game")}
        </button>
      )}
    </section>
  );
}