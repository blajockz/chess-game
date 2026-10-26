import "./GameSetup.css";
import { useEffect, useRef, useState } from "react";
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
  const category = categoryOf(controlFor(choice, "w"));
  const yours = controlLabel(choice.initial, choice.increment);
  if (!hasHandicap(choice)) return `${yours} ${category}`;
  const theirs = controlLabel(choice.opponentInitial!, choice.increment);
  return `You ${yours} · Opp ${theirs} · ${category}`;
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
  canCancel: boolean;
  onStart: (choice: SetupChoice) => void;
  onCancel: () => void;
};

export default function GameSetup({ initial, canCancel, onStart, onCancel }: Props) {
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

  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canCancel) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCancel, onCancel]);

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
  const cardsBlocked = isBulletGame || online;
  const choice: SetupChoice = { ...base, opponent, cards: cards && !cardsBlocked };
  const sideText =
    side === "random" ? "random side" : side === "w" ? "you play White" : "you play Black";
  const category = categoryOf(controlFor(choice, "w"));
  const yours = controlLabel(choice.initial, choice.increment);
  const headline = hasHandicap(choice)
    ? `You ${yours} · Opponent ${controlLabel(choice.opponentInitial!, choice.increment)}`
    : `${yours} ${category}`;
  const subline =
    (hasHandicap(choice) ? `${category} · ${sideText}` : sideText) +
    (choice.cards ? " · action cards" : "");

  return (
    <div
      className="setup-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && canCancel) onCancel();
      }}
    >
      <div
        className="setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <h2 className="setup-title" id="setup-title">
          New game
        </h2>

        <section className="setup-block" aria-label="Time control">
          {PRESETS.map((group) => (
            <div className="preset-row" key={group.category}>
              <span className="preset-cat">{group.category}</span>
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
            <span className="preset-cat">Custom</span>
            <div className="preset-chips">
              <button
                className={"chip-btn" + (picked === "custom" ? " is-on" : "")}
                aria-pressed={picked === "custom"}
                onClick={() => setPicked("custom")}
              >
                Set your own
              </button>
            </div>
          </div>

          {picked === "custom" && (
            <div className="custom">
              <div className="custom-fields">
                <Stepper
                  label={handicap ? "Your minutes" : "Minutes each"}
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
                  label="Increment (s)"
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
                  Give your opponent a different time
                </span>
              </div>

              {handicap && (
                <div className="custom-fields">
                  <Stepper
                    label="Opponent minutes"
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

        <section className="setup-block" aria-label="Opponent">
          <div className="side-row">
            <span className="preset-cat">Opponent</span>
            <div className="side-seg" role="group" aria-label="Opponent">
              {(
                [
                  ["bot", "Practice bot"],
                  ["friend", "A friend (link)"],
                ] as ["bot" | "friend", string][]
              ).map(([value, text]) => (
                <button
                  key={value}
                  className={"side-btn" + (opponent === value ? " is-on" : "")}
                  aria-pressed={opponent === value}
                  onClick={() => setOpponent(value)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="setup-block" aria-label="Play as">
          <div className="side-row">
            <span className="preset-cat">Play as</span>
            <div className="side-seg" role="group" aria-label="Play as">
              {(
                [
                  ["w", "White"],
                  ["random", "Random"],
                  ["b", "Black"],
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

        <section className="setup-block" aria-label="Action cards">
          <div className="side-row">
            <span className="preset-cat">Cards</span>
            <div className="handicap">
              <button
                className={"switch" + (choice.cards ? " is-on" : "")}
                role="switch"
                aria-checked={!!choice.cards}
                aria-label="Action cards"
                disabled={cardsBlocked}
                onClick={() => setCards((c) => !c)}
              >
                <span className="switch-knob" />
              </button>
              <span className="handicap-text">
                {isBulletGame
                  ? "Action cards are not available in Bullet"
                  : online
                    ? "Action cards aren't available online yet"
                    : "Play with action cards"}
              </span>
            </div>
          </div>
        </section>

        <footer className="setup-foot">
          <p className="setup-summary">
            <strong>{headline}</strong>
            <span>{subline}</span>
          </p>
          <div className="setup-actions">
            {canCancel && (
              <button className="ghost-btn" onClick={onCancel}>
                Cancel
              </button>
            )}
            <button
              ref={startRef}
              className="start-btn"
              data-category={category}
              onClick={() => onStart(choice)}
            >
              {online ? "Create link" : "Start game"}
            </button>
          </div>
        </footer>
      </div>
    </div>
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
          aria-label={`Decrease ${label}`}
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
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </span>
    </label>
  );
}