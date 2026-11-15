import { t } from "../i18n";
import "./GameSetup.css";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_ELO, ELO_PRESETS, ELO_STEP, MAX_ELO, MIN_ELO, clampElo, levelName } from "../bot/strength";
import CardGuide from "./CardGuide";
import { CARD_IDS } from "../cards/cards";
import {
  categoryOf,
  controlLabel,
  type Category,
  type TimeControl,
} from "../game/useClocks";

export type SideChoice = "w" | "b" | "random";

export type SetupChoice = {
  initial: number;
  increment: number;
  opponentInitial?: number;
  side: SideChoice;
  cards?: boolean;
  opponent?: "bot" | "friend";
  elo?: number;
  rated?: boolean;
};

const hasHandicap = (c: SetupChoice) =>
  c.opponentInitial !== undefined && c.opponentInitial !== c.initial;

export function controlFor(choice: SetupChoice, you: "w" | "b"): TimeControl {
  const { initial, increment, opponentInitial } = choice;
  if (!hasHandicap(choice)) return { initial, increment };
  return you === "w"
    ? { initial, increment, blackInitial: opponentInitial }
    : { initial: opponentInitial!, increment, blackInitial: initial };
}

export function describeSetup(choice: SetupChoice) {
  const category = t(categoryOf(controlFor(choice, "w")));
  const yours = controlLabel(choice.initial, choice.increment);
  if (!hasHandicap(choice)) return `${yours} ${category}`;
  const theirs = controlLabel(choice.opponentInitial!, choice.increment);
  return t("You {yours} · Opp {theirs} · {category}", { yours, theirs, category });
}

const PRESETS: { category: Category; items: [number, number][] }[] = [
  { category: "Bullet", items: [[1, 0], [1, 1], [2, 1]] },
  { category: "Blitz", items: [[3, 0], [3, 2], [5, 0], [5, 3]] },
  { category: "Rapid", items: [[10, 0], [10, 5], [15, 10]] },
  { category: "Classical", items: [[30, 0], [30, 20]] },
];

const MIN_MINUTES = 0.5;
const MAX_MINUTES = 60;
const MAX_INCREMENT = 30;

const clampMinutes = (m: number) =>
  Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(m * 2) / 2));
const clampIncrement = (s: number) =>
  Math.min(MAX_INCREMENT, Math.max(0, Math.round(s)));

function stepMinutes(m: number, dir: 1 | -1) {
  const step = m < 1 || (m === 1 && dir === -1) ? 0.5 : 1;
  return clampMinutes(m + dir * step);
}

const keyOf = (m: number, inc: number) => `${m}+${inc}`;

function presetKey(choice: SetupChoice): string | null {
  if (hasHandicap(choice)) return null;
  const k = keyOf(choice.initial / 60, choice.increment);
  return PRESETS.some((g) => g.items.some(([m, i]) => keyOf(m, i) === k)) ? k : null;
}

type Props = {
  initial: SetupChoice;
  onStart: (choice: SetupChoice) => void;
  onCancel: () => void;
  onOpponentChange?: (opponent: "bot" | "friend") => void;
  centered?: boolean;
  ratedBlocked?: string | null;
  ratedLive?: boolean;
};

export default function GameSetup({ initial, onStart, onCancel, onOpponentChange, centered, ratedBlocked = null, ratedLive }: Props) {
  const startKey = presetKey(initial);
  const [picked, setPicked] = useState<string>(startKey ?? "custom");

  const [minutes, setMinutes] = useState(initial.initial / 60);
  const [increment, setIncrement] = useState(initial.increment);
  const [handicap, setHandicap] = useState(hasHandicap(initial));
  const [opponentMinutes, setOpponentMinutes] = useState(
    (initial.opponentInitial ?? initial.initial) / 60
  );
  const [side, setSide] = useState<SideChoice>(initial.side);
  const [cards, setCards] = useState(initial.cards ?? false);
  const [opponent, setOpponent] = useState<"bot" | "friend">(initial.opponent ?? "bot");
  const [elo, setElo] = useState(clampElo(initial.elo ?? DEFAULT_ELO));
  const [guide, setGuide] = useState(false);
  const [rated, setRated] = useState(initial.rated ?? false);

  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function pickOpponent(value: "bot" | "friend") {
    setOpponent(value);
    onOpponentChange?.(value);
  }

  function build(): SetupChoice {
    if (picked !== "custom") {
      const [m, inc] = picked.split("+").map(Number);
      return { initial: m * 60, increment: inc, side };
    }
    const choice: SetupChoice = {
      initial: clampMinutes(minutes) * 60,
      increment: clampIncrement(increment),
      side,
    };
    if (handicap) choice.opponentInitial = clampMinutes(opponentMinutes) * 60;
    return choice;
  }

  const base = build();
  const isBulletGame = categoryOf(controlFor(base, "w")) === "Bullet";
  const online = opponent === "friend";
  const cardsBlocked = isBulletGame;
  const choice: SetupChoice = { ...base, opponent, cards: cards && !cardsBlocked, elo, rated: rated && !ratedBlocked };
  const sideText =
    side === "random" ? t("random side") : side === "w" ? t("you play White") : t("you play Black");
  const category = categoryOf(controlFor(choice, "w"));
  const yours = controlLabel(choice.initial, choice.increment);
  const headline = hasHandicap(choice)
    ? t("You {yours} · Opponent {controlLabel}", { yours, controlLabel: controlLabel(choice.opponentInitial!, choice.increment) })
    : `${yours} ${t(category)}`;
  const subline =
    (hasHandicap(choice) ? `${t(category)} · ${sideText}` : sideText) +
    (online ? "" : t(" · bot {elo}", { elo })) +
    (choice.cards ? t(" · action cards") : "") +
    (choice.rated ? t(" · rated") : "");

  return (
    <>
      <div className={"setup-scrim" + (centered ? " is-centered" : "")} onPointerDown={onCancel} aria-hidden="true" />
      <aside
        id="game-panel"
        className={"setup" + (online ? " is-online" : "") + (centered ? " is-centered" : "")}
        role="dialog"
        aria-modal="false"
        aria-labelledby="setup-title"
      >
        <header className="setup-head">
          <div>
            <h2 className="setup-title" id="setup-title">
              {online ? t("Play a friend") : t("New game")}
            </h2>
            <p className="setup-lead">
              {online
                ? t("Pick a time control, then send the link to your friend.")
                : t("Pick a time control and the bot's strength.")}
            </p>
          </div>
          <button className="setup-close" onClick={onCancel} aria-label={t("Close the game panel")} title={t("Close (Esc)")}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <section className="setup-block" aria-label={t("Time control")}>
          {PRESETS.map((group) => (
            <div className="preset-row" key={group.category}>
              <span className="preset-cat">{t(group.category)}</span>
              <div className="preset-chips">
                {group.items.map(([m, inc]) => {
                  const k = keyOf(m, inc);
                  return (
                    <button
                      key={k}
                      className={"chip-btn" + (picked === k ? " is-on" : "")}
                      aria-pressed={picked === k}
                      onClick={() => setPicked(k)}
                    >
                      {m}+{inc}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="preset-row">
            <span className="preset-cat">{t("Custom")}</span>
            <div className="preset-chips">
              <button
                className={"chip-btn" + (picked === "custom" ? " is-on" : "")}
                aria-pressed={picked === "custom"}
                onClick={() => setPicked("custom")}
              >
                {t("Set your own")}
              </button>
            </div>
          </div>

          {picked === "custom" && (
            <div className="custom">
              <div className="custom-fields">
                <Stepper
                  label={handicap ? t("Your minutes") : t("Minutes each")}
                  value={minutes}
                  onDec={() => setMinutes((m) => stepMinutes(m, -1))}
                  onInc={() => setMinutes((m) => stepMinutes(m, 1))}
                  onType={(v) => setMinutes(v)}
                  onBlur={() => setMinutes((m) => clampMinutes(m))}
                  min={MIN_MINUTES}
                  max={MAX_MINUTES}
                  step={0.5}
                />
                <Stepper
                  label={t("Increment (s)")}
                  value={increment}
                  onDec={() => setIncrement((s) => clampIncrement(s - 1))}
                  onInc={() => setIncrement((s) => clampIncrement(s + 1))}
                  onType={(v) => setIncrement(v)}
                  onBlur={() => setIncrement((s) => clampIncrement(s))}
                  min={0}
                  max={MAX_INCREMENT}
                  step={1}
                />
              </div>

              <div className="handicap">
                <button
                  className={"switch" + (handicap ? " is-on" : "")}
                  role="switch"
                  aria-checked={handicap}
                  onClick={() => setHandicap((h) => !h)}
                >
                  <span className="switch-knob" />
                </button>
                <span className="handicap-text">
                  {t("Give your opponent a different time")}
                </span>
              </div>

              {handicap && (
                <div className="custom-fields">
                  <Stepper
                    label={t("Opponent minutes")}
                    value={opponentMinutes}
                    onDec={() => setOpponentMinutes((m) => stepMinutes(m, -1))}
                    onInc={() => setOpponentMinutes((m) => stepMinutes(m, 1))}
                    onType={(v) => setOpponentMinutes(v)}
                    onBlur={() => setOpponentMinutes((m) => clampMinutes(m))}
                    min={MIN_MINUTES}
                    max={MAX_MINUTES}
                    step={0.5}
                  />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="setup-block" aria-label={t("Opponent")}>
          <div className="side-row">
            <span className="preset-cat">{t("Opponent")}</span>
            <div className="side-seg" role="group" aria-label={t("Opponent")}>
              {(
                [
                  ["bot", t("Shatranj Bot")],
                  ["friend", t("A friend (link)")],
                ] as ["bot" | "friend", string][]
              ).map(([value, text]) => (
                <button
                  key={value}
                  className={"side-btn" + (opponent === value ? " is-on" : "")}
                  aria-pressed={opponent === value}
                  onClick={() => pickOpponent(value)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="setup-block" aria-label={t("Rated game")}>
          <div className="side-row">
            <span className="preset-cat">{t("Rated")}</span>
            <div className="handicap">
              <button
                className={"switch" + (choice.rated ? " is-on" : "")}
                role="switch"
                aria-checked={!!choice.rated}
                aria-label={t("Rated game")}
                disabled={!!ratedBlocked}
                onClick={() => setRated((r) => !r)}
              >
                <span className="switch-knob" />
              </button>
              <span className="handicap-text">
                {ratedBlocked ??
                  (choice.rated
                    ? online
                      ? t("Rated: counts if your friend has an account too")
                      : t("Rated: your rating goes up or down")
                    : t("Not rated: your rating doesn't change"))}
              </span>
            </div>
          </div>
          {ratedLive && <p className="rated-warning">{t("A rated game is in progress. Starting a new game counts it as a loss.")}</p>}
        </section>

        {!online && (
          <section className="setup-block bot-block" aria-label={t("Bot strength")}>
            <div className="bot-head">
              <span className="preset-cat">{t("Bot rating")}</span>
              <span className="bot-elo">
                <strong>{elo}</strong>
                <span>{t(levelName(elo))}</span>
              </span>
            </div>
            <div className="bot-slider">
              <button
                type="button"
                className="stepper-btn"
                aria-label={t("Lower the bot's rating")}
                disabled={elo <= MIN_ELO}
                onClick={() => setElo((e) => clampElo(e - ELO_STEP))}
              >
                −
              </button>
              <input
                type="range"
                min={MIN_ELO}
                max={MAX_ELO}
                step={ELO_STEP}
                value={elo}
                aria-label={t("Bot rating")}
                aria-valuetext={`${elo}, ${t(levelName(elo))}`}
                style={{ ["--fill" as string]: `${((elo - MIN_ELO) / (MAX_ELO - MIN_ELO)) * 100}%` }}
                onChange={(e) => setElo(clampElo(Number(e.target.value)))}
              />
              <button
                type="button"
                className="stepper-btn"
                aria-label={t("Raise the bot's rating")}
                disabled={elo >= MAX_ELO}
                onClick={() => setElo((e) => clampElo(e + ELO_STEP))}
              >
                +
              </button>
            </div>
            <div className="preset-chips bot-presets">
              {ELO_PRESETS.map((p) => (
                <button
                  key={p.elo}
                  className={"chip-btn" + (elo === p.elo ? " is-on" : "")}
                  aria-pressed={elo === p.elo}
                  onClick={() => setElo(p.elo)}
                >
                  {t(p.name)} <span className="bot-chip-elo">{p.elo}</span>
                </button>
              ))}
            </div>
            <p className="bot-credit">
              {t("Plays like a human of this rating, cards included.")}{" "}
              <a href="/licenses.txt" target="_blank" rel="noreferrer">
                {t("Open-source licences")}
              </a>
            </p>
          </section>
        )}

        <section className="setup-block" aria-label={t("Play as")}>
          <div className="side-row">
            <span className="preset-cat">{t("Play as")}</span>
            <div className="side-seg" role="group" aria-label={t("Play as")}>
              {(
                [
                  ["w", t("White")],
                  ["random", t("Random")],
                  ["b", t("Black")],
                ] as [SideChoice, string][]
              ).map(([value, text]) => (
                <button
                  key={value}
                  className={"side-btn" + (side === value ? " is-on" : "")}
                  aria-pressed={side === value}
                  onClick={() => setSide(value)}
                >
                  {value !== "random" && (
                    <span className={"side-dot side-" + value} aria-hidden="true" />
                  )}
                  {text}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="setup-block" aria-label={t("Action cards")}>
          <div className="side-row">
            <span className="preset-cat">{t("Cards")}</span>
            <div className="handicap">
              <button
                className={"switch" + (choice.cards ? " is-on" : "")}
                role="switch"
                aria-checked={!!choice.cards}
                aria-label={t("Action cards")}
                disabled={cardsBlocked}
                onClick={() => setCards((c) => !c)}
              >
                <span className="switch-knob" />
              </button>
              <span className="handicap-text">
                {isBulletGame ? t("Action cards are not available in Bullet") : t("Play with action cards")}
              </span>
            </div>
          </div>
          <button className="cards-guide-link" onClick={() => setGuide(true)}>
            {t("What are action cards?")}
          </button>
        </section>

        <footer className="setup-foot">
          <p className="setup-summary">
            <strong>{headline}</strong>
            <span>{subline}</span>
          </p>
          <div className="setup-actions">
            <button className="ghost-btn" onClick={onCancel}>
              {t("Cancel")}
            </button>
            <button
              ref={startRef}
              className="start-btn"
              data-category={category}
              onClick={() => onStart(choice)}
            >
              {online ? t("Create link") : t("Start game")}
            </button>
          </div>
        </footer>
      </aside>
      {guide && <CardGuide cards={CARD_IDS} category={category} onClose={() => setGuide(false)} />}
    </>
  );
}

type StepperProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onDec: () => void;
  onInc: () => void;
  onType: (v: number) => void;
  onBlur: () => void;
};

function Stepper({ label, value, min, max, step, onDec, onInc, onType, onBlur }: StepperProps) {
  return (
    <label className="stepper">
      <span className="stepper-label">{label}</span>
      <span className="stepper-box">
        <button
          type="button"
          className="stepper-btn"
          onClick={onDec}
          disabled={value <= min}
          aria-label={t("Decrease {label}", { label })}
        >
          −
        </button>
        <input
          className="stepper-input"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onType(v);
          }}
          onBlur={onBlur}
        />
        <button
          type="button"
          className="stepper-btn"
          onClick={onInc}
          disabled={value >= max}
          aria-label={t("Increase {label}", { label })}
        >
          +
        </button>
      </span>
    </label>
  );
}