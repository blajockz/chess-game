import { t } from "../i18n";
import "./PuzzlesPage.css";
import { useEffect, useMemo, useState } from "react";
import Board, { type BoardProps } from "../components/Board";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import WeatherLayer from "../components/WeatherLayer";
import Safe3D, { hasWebGL } from "../three/Safe3D";
import { useSounds } from "../game/useSounds";
import { loadTheme, saveTheme, themeById, type ThemeId } from "../theme/themes";
import type { Account } from "../auth/AuthProvider";
import { usePuzzle, type Armed, type Phase } from "./usePuzzle";
import type { PuzzleKind } from "./api";
import ActionCard from "../components/ActionCard";
import CardGuide from "../components/CardGuide";
import { CARDS, type CardId } from "../../shared/cards";
import { DIFFICULTIES, THEME_GROUPS, themeName } from "./themes";
import { useRating } from "../rating/useRating";
import LevelDialog from "../rating/LevelDialog";

const KEY_DIFFICULTY = "tempo.puzzleDifficulty";
const KEY_THEME = "tempo.puzzleTheme";
const KEY_CARD_THEME = "tempo.cardPuzzleTheme";
const KEY_KIND = "tempo.puzzleKind";

const PUZZLE_CARDS: CardId[] = ["leap", "swap", "retreat", "shield"];

const AIM: Partial<Record<CardId, string[]>> = {
  shield: [t("Choose the piece to shield")],
  leap: [t("Choose the pawn to push")],
  retreat: [t("Choose the piece to send home")],
  swap: [t("Choose a knight or bishop"), t("Choose the piece to trade with")],
};

const tagName = (tag: string) => (tag in CARDS ? t(CARDS[tag as CardId].name) : themeName(tag));

function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

const SIDE = { w: t("White"), b: t("Black") } as const;

type StatusInput = {
  phase: Phase;
  side: string;
  message: string;
  solved: boolean | undefined;
  cards: boolean;
  cardPlayed: boolean;
  armed: Armed | null;
  waiting: boolean;
};

function statusText({ phase, side, message, solved, cards, cardPlayed, armed, waiting }: StatusInput) {
  switch (phase) {
    case "loading":
      return { tone: "", title: t("Loading a puzzle…"), text: waiting ? t("Waiting for the server…") : "" };
    case "intro":
      return { tone: "", title: t("Watch your opponent's move…"), text: "" };
    case "turn":
      if (armed) {
        const steps = AIM[armed.card] ?? [];
        return { tone: "", title: t(CARDS[armed.card].name), text: t("{v1}. Esc to cancel.", { v1: steps[armed.picks.length] ?? "Choose a square" }) };
      }
      if (cards && !cardPlayed) return { tone: "", title: t("Your turn"), text: t("Play the right card, then the best move for {side}.", { side }) };
      if (cards) return { tone: "good", title: t("Right card!"), text: t("Now find the best move for {side}.", { side }) };
      return { tone: "", title: t("Your turn"), text: t("Find the best move for {side}.", { side }) };
    case "checking":
      return { tone: "", title: t("Checking…"), text: "" };
    case "right":
      return { tone: "good", title: t("Best move!"), text: t("Keep going.") };
    case "solved":
      return { tone: "good", title: t("Solved!"), text: t("Well played.") };
    case "failed":
      return { tone: "bad", title: t("Puzzle failed"), text: message || t("That's not the move.") };
    case "solution":
      return { tone: solved ? "good" : "bad", title: t("Solution"), text: t("The board shows the whole line.") };
    case "retry":
      return { tone: "", title: t("Practice"), text: message || t("Find the {v1} for {side}. Not rated.", { v1: cards ? "card and the move" : "best move", side }) };
    case "retry-solved":
      return { tone: "good", title: t("Solved!"), text: t("Practice: not rated.") };
    case "empty":
      return { tone: "", title: t("No puzzle here yet"), text: message };
    case "paused":
      return { tone: "", title: t("Puzzles are paused"), text: message };
  }
}

function useBoardMode(canThree: boolean) {
  const [mode, setMode] = useState<"default" | "sim">(() => (canThree && remembered("tempo.mode") === "sim" ? "sim" : "default"));
  useEffect(() => remember("tempo.mode", mode), [mode]);
  return [mode, setMode] as const;
}

export default function PuzzlesPage({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const canThree = useMemo(hasWebGL, []);
  const [mode, setMode] = useBoardMode(canThree);
  const [soundOn, setSoundOn] = useState(true);
  const [difficulty, setDifficulty] = useState(() => {
    const n = Number(remembered(KEY_DIFFICULTY));
    return [-2, -1, 0, 1, 2].includes(n) ? n : 0;
  });
  const [kind, setKind] = useState<PuzzleKind>(() => (remembered(KEY_KIND) === "cards" ? "cards" : "chess"));
  const [themeFilter, setThemeFilter] = useState(() => remembered(KEY_THEME) ?? "");
  const [cardFilter, setCardFilter] = useState(() => {
    const v = remembered(KEY_CARD_THEME) ?? "";
    return PUZZLE_CARDS.includes(v as CardId) ? v : "";
  });
  const [guide, setGuide] = useState(false);
  const play = useSounds(soundOn);
  const isCards = kind === "cards";
  const filter = isCards ? cardFilter : themeFilter;
  const p = usePuzzle({ kind, difficulty, theme: filter || null, play });

  const { phase: puzzlePhase, next: loadNext } = p;
  useEffect(() => {
    if (puzzlePhase === "empty") void loadNext();
  }, [filter]);

  function chooseKind(next: PuzzleKind) {
    if (next === kind) return;
    setKind(next);
    remember(KEY_KIND, next);
  }

  function chooseFilter(value: string) {
    if (isCards) {
      setCardFilter(value);
      remember(KEY_CARD_THEME, value);
    } else {
      setThemeFilter(value);
      remember(KEY_THEME, value);
    }
  }
  const rating = useRating(account.guest === true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.title = t("Puzzles · Shatranj");
  }, []);

  const side = SIDE[p.myColor];
  const status = statusText({
    phase: p.phase,
    side,
    message: p.message,
    solved: p.end?.solved,
    cards: isCards,
    cardPlayed: p.cardPlayed,
    armed: p.armed,
    waiting: p.waiting,
  });
  const finished = p.phase === "solved" || p.phase === "failed" || p.phase === "solution" || p.phase === "retry-solved";
  const delta = p.end?.rating?.delta ?? null;
  const goPlay = () => window.location.assign("/");

  const boardProps: BoardProps = {
    board: p.board,
    selected: p.selected,
    legalTargets: p.legalTargets,
    lastMove: p.lastMove,
    moveKey: p.moveKey,
    checkSquare: p.checkSquare,
    matedSquare: p.matedSquare,
    pending: p.pending,
    onPromote: p.onPromote,
    onCancelPromotion: p.cancelPromotion,
    draggableColor: p.canMove && !p.armed ? p.myColor : null,
    flipped: p.myColor === "b",
    onSquareClick: p.onSquareClick,
    cardTargets: p.cardTargets,
    cardPicked: p.armed?.picks ?? [],
    cardFlash: p.flash,
    shielded: (p.shield as BoardProps["shielded"]) ?? null,
  };

  return (
    <div className="shell puzzles">
      <WeatherLayer theme={themeById(theme)} />

      <TopBar
        mode={mode}
        onModeChange={setMode}
        simAvailable={canThree}
        soundOn={soundOn}
        onSoundToggle={() => setSoundOn((on) => !on)}
        control={t("Puzzles")}
        onNewGame={goPlay}
        theme={theme}
        onThemeChange={setTheme}
      />

      <Sidebar open={null} onOpen={goPlay} current="puzzles" account={account} onSignOut={onSignOut} />

      <main className="table">
        <section className="board-column">
          <div className={"pz-turn" + (p.phase === "turn" || p.phase === "retry" ? " is-on" : "")}>
            <span className={"pz-dot is-" + p.myColor} aria-hidden="true" />
            {p.phase === "loading" ? "…" : t("You play {side}", { side })}
          </div>
          <div className={"board-wrap pz-board" + (p.wrongMove || p.wrongCard ? " is-wrong" : "") + (p.phase === "solved" || p.phase === "retry-solved" ? " is-solved" : "")}>
            {mode === "sim" && canThree ? (
              <Safe3D props={boardProps} fallback={<Board {...boardProps} />} onFail={() => setMode("default")} />
            ) : (
              <Board {...boardProps} />
            )}
          </div>
        </section>

        <aside className="side-column pz-side">
          <div className="pz-kind" role="tablist" aria-label={t("Puzzle type")}>
            <button className={"pz-kind-tab" + (!isCards ? " is-on" : "")} role="tab" aria-selected={!isCards} onClick={() => chooseKind("chess")}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M12 3l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.3l5-.7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              </svg>
              {t("Classic")}
            </button>
            <button className={"pz-kind-tab" + (isCards ? " is-on" : "")} role="tab" aria-selected={isCards} onClick={() => chooseKind("cards")}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="4" y="5" width="11" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M9 3.5h9a2 2 0 0 1 2 2V17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              {t("Action cards")}
            </button>
          </div>

          <section className="pz-card pz-rating" aria-live="polite">
            {account.guest ? (
              <>
                <p className="pz-label">{t("Puzzle rating")}</p>
                <p className="pz-guest">{t("Guests play without a rating.")}</p>
                <button className="pz-link" onClick={onSignOut}>
                  {t("Sign in to get your puzzle rating")}
                </button>
              </>
            ) : (
              <>
                <p className="pz-label">{t("Your puzzle rating")}</p>
                <p className="pz-number">
                  {p.me ? p.me.rating : "—"}
                  {p.me?.provisional && <span className="pz-prov" title={t("Provisional: it settles after more puzzles")}>?</span>}
                  {delta !== null && (
                    <span className={"pz-delta " + (delta >= 0 ? "is-up" : "is-down")} key={p.end?.puzzle.id}>
                      {delta >= 0 ? `+${delta}` : delta}
                    </span>
                  )}
                </p>
                {p.me && (
                  <p className="pz-stats">
                    <span>
                      <strong>{p.me.solved}</strong>/{p.me.played} {t("solved")}
                    </span>
                    <span>
                      {t("Streak")} <strong>{p.me.streak}</strong>
                      {p.me.bestStreak > 0 && <em> {t("(best")} {p.me.bestStreak})</em>}
                    </span>
                  </p>
                )}
              </>
            )}
          </section>

          {isCards && p.hand.length > 0 && (
            <section className={"pz-card pz-hand" + (p.canCard ? " is-live" : "")} aria-label={t("Your cards")}>
              <p className="pz-label">
                {t("Your cards")}
                <button className="pz-help" onClick={() => setGuide(true)} aria-label={t("Card guide: what each card does")} title={t("Card guide")}>
                  ?
                </button>
              </p>
              <div className="pz-hand-cards">
                {p.hand.map((card) => (
                  <ActionCard
                    key={card}
                    card={card}
                    compact
                    width={86}
                    selected={p.armed?.card === card}
                    disabled={!p.canCard}
                    title={t(CARDS[card].name)}
                    onClick={() => p.onCard(card)}
                  />
                ))}
              </div>
              <p className="pz-hand-note">
                {p.cardPlayed ? t("Card played.") : p.canCard ? t("Click a card, then its square on the board.") : t("One card per puzzle, before your move.")}
              </p>
            </section>
          )}

          <section className={"pz-card pz-status" + (status.tone ? " is-" + status.tone : "")} role="status">
            <p className="pz-status-title">{status.title}</p>
            {status.text && <p className="pz-status-text">{status.text}</p>}
            <div className="pz-actions">
              {p.phase === "turn" && (
                <button className="pz-btn" onClick={() => void p.giveUp()}>
                  {t("Give up")}
                </button>
              )}
              {p.phase === "failed" && (
                <button className="pz-btn" onClick={() => void p.showSolution()}>
                  {t("Show solution")}
                </button>
              )}
              {(finished || p.phase === "retry") && (
                <button className="pz-btn" onClick={() => void p.retry()}>
                  {t("Retry")}
                </button>
              )}
              {(finished || p.phase === "retry") && (
                <button className="pz-btn is-main" onClick={() => void p.next()}>
                  {t("Next puzzle")}
                </button>
              )}
              {p.phase === "empty" && filter && (
                <button className="pz-btn is-main" onClick={() => chooseFilter("")}>
                  {isCards ? t("Any card") : t("Any theme")}
                </button>
              )}
              {p.phase === "empty" && !filter && isCards && (
                <button className="pz-btn is-main" onClick={() => chooseKind("chess")}>
                  {t("Classic puzzles")}
                </button>
              )}
              {p.phase === "paused" && (
                <button className="pz-btn is-main" onClick={() => void p.next()}>
                  {t("Try again")}
                </button>
              )}
            </div>
          </section>

          {p.end && (
            <section className="pz-card pz-info">
              <p className="pz-label">{t("This puzzle")}</p>
              <p className="pz-info-line">
                {t("Rated")} <strong>{p.end.puzzle.rating}</strong>
                {p.end.puzzle.opening && <span> · {p.end.puzzle.opening.split(" ")[0].replace(/_/g, " ")}</span>}
              </p>
              <div className="pz-tags">
                {p.end.puzzle.themes.map((t) => (
                  <span className="pz-tag" key={t}>
                    {tagName(t)}
                  </span>
                ))}
              </div>
              {(p.phase === "solution" || p.end.solved) && p.solutionText && (
                <p className="pz-solution">
                  <span>{t("Solution")}</span> {p.solutionText}
                </p>
              )}
            </section>
          )}

          <section className="pz-card pz-settings">
            <label className="pz-field">
              <span>{t("Difficulty")}</span>
              <select
                name="difficulty"
                value={difficulty}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDifficulty(v);
                  remember(KEY_DIFFICULTY, String(v));
                }}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pz-field">
              <span>{isCards ? t("Card") : t("Theme")}</span>
              <select name="theme" value={filter} onChange={(e) => chooseFilter(e.target.value)}>
                {isCards ? (
                  <>
                    <option value="">{t("Any card")}</option>
                    {PUZZLE_CARDS.map((c) => (
                      <option value={c} key={c}>
                        {t(CARDS[c].name)}
                      </option>
                    ))}
                  </>
                ) : (
                  <>
                    <option value="">{t("Any theme")}</option>
                    {THEME_GROUPS.map((g) => (
                      <optgroup label={g.label} key={g.label}>
                        {g.tags.map((t) => (
                          <option value={t} key={t}>
                            {themeName(t)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </>
                )}
              </select>
            </label>
            <p className="pz-hint">{t("Changes apply from the next puzzle.")}</p>
          </section>

        </aside>
      </main>

      {guide && <CardGuide cards={p.hand.length ? p.hand : PUZZLE_CARDS} category="Blitz" onClose={() => setGuide(false)} />}

      {rating.needsLevel && (
        <LevelDialog
          guest={account.guest === true}
          onChoose={async (level) => {
            await rating.choose(level);
            void p.next();
          }}
        />
      )}
    </div>
  );
}