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
import { usePuzzle, type Phase } from "./usePuzzle";
import { DIFFICULTIES, THEME_GROUPS, themeName } from "./themes";

const KEY_DIFFICULTY = "tempo.puzzleDifficulty";
const KEY_THEME = "tempo.puzzleTheme";

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

const SIDE = { w: "White", b: "Black" } as const;

function statusText(phase: Phase, side: string, message: string, solved: boolean | undefined) {
  switch (phase) {
    case "loading":
      return { tone: "", title: "Loading a puzzle…", text: "" };
    case "intro":
      return { tone: "", title: "Watch your opponent's move…", text: "" };
    case "turn":
      return { tone: "", title: "Your turn", text: `Find the best move for ${side}.` };
    case "checking":
      return { tone: "", title: "Checking…", text: "" };
    case "right":
      return { tone: "good", title: "Best move!", text: "Keep going." };
    case "solved":
      return { tone: "good", title: "Solved!", text: "Well played." };
    case "failed":
      return { tone: "bad", title: "Puzzle failed", text: message || "That's not the move." };
    case "solution":
      return { tone: solved ? "good" : "bad", title: "Solution", text: "The board shows the whole line." };
    case "retry":
      return { tone: "", title: "Practice", text: message || `Find the best move for ${side}. Not rated.` };
    case "retry-solved":
      return { tone: "good", title: "Solved!", text: "Practice: not rated." };
    case "error":
      return { tone: "bad", title: "Something went wrong", text: message };
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
  const [themeFilter, setThemeFilter] = useState(() => remembered(KEY_THEME) ?? "");
  const play = useSounds(soundOn);
  const p = usePuzzle({ difficulty, theme: themeFilter || null, play });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.title = "Puzzles · Tempo";
  }, []);

  const side = SIDE[p.myColor];
  const status = statusText(p.phase, side, p.message, p.end?.solved);
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
    draggableColor: p.canMove ? p.myColor : null,
    flipped: p.myColor === "b",
    onSquareClick: p.onSquareClick,
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
        control="Puzzles"
        onNewGame={goPlay}
        theme={theme}
        onThemeChange={setTheme}
      />

      <Sidebar open={null} onOpen={goPlay} current="puzzles" account={account} onSignOut={onSignOut} />

      <main className="table">
        <section className="board-column">
          <div className={"pz-turn" + (p.phase === "turn" || p.phase === "retry" ? " is-on" : "")}>
            <span className={"pz-dot is-" + p.myColor} aria-hidden="true" />
            {p.phase === "loading" ? "…" : `You play ${side}`}
          </div>
          <div className={"board-wrap pz-board" + (p.wrongMove ? " is-wrong" : "") + (p.phase === "solved" || p.phase === "retry-solved" ? " is-solved" : "")}>
            {mode === "sim" && canThree ? (
              <Safe3D props={boardProps} fallback={<Board {...boardProps} />} onFail={() => setMode("default")} />
            ) : (
              <Board {...boardProps} />
            )}
          </div>
        </section>

        <aside className="side-column pz-side">
          <div className="pz-kind" role="tablist" aria-label="Puzzle type">
            <button className="pz-kind-tab is-on" role="tab" aria-selected="true">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M12 3l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.3l5-.7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              </svg>
              Classic
            </button>
            <button className="pz-kind-tab" role="tab" aria-selected="false" disabled title="Puzzles with action cards are coming soon">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="4" y="5" width="11" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M9 3.5h9a2 2 0 0 1 2 2V17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              Action cards
              <span className="pz-soon">
                <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" />
                </svg>
                Soon
              </span>
            </button>
          </div>

          <section className="pz-card pz-rating" aria-live="polite">
            {account.guest ? (
              <>
                <p className="pz-label">Puzzle rating</p>
                <p className="pz-guest">Guests play without a rating.</p>
                <button className="pz-link" onClick={onSignOut}>
                  Sign in to get your puzzle rating
                </button>
              </>
            ) : (
              <>
                <p className="pz-label">Your puzzle rating</p>
                <p className="pz-number">
                  {p.me ? p.me.rating : "—"}
                  {p.me?.provisional && <span className="pz-prov" title="Provisional: it settles after more puzzles">?</span>}
                  {delta !== null && (
                    <span className={"pz-delta " + (delta >= 0 ? "is-up" : "is-down")} key={p.end?.puzzle.id}>
                      {delta >= 0 ? `+${delta}` : delta}
                    </span>
                  )}
                </p>
                {p.me && (
                  <p className="pz-stats">
                    <span>
                      <strong>{p.me.solved}</strong>/{p.me.played} solved
                    </span>
                    <span>
                      Streak <strong>{p.me.streak}</strong>
                      {p.me.bestStreak > 0 && <em> (best {p.me.bestStreak})</em>}
                    </span>
                  </p>
                )}
              </>
            )}
          </section>

          <section className={"pz-card pz-status" + (status.tone ? " is-" + status.tone : "")} role="status">
            <p className="pz-status-title">{status.title}</p>
            {status.text && <p className="pz-status-text">{status.text}</p>}
            <div className="pz-actions">
              {p.phase === "turn" && (
                <button className="pz-btn" onClick={() => void p.giveUp()}>
                  Give up
                </button>
              )}
              {p.phase === "failed" && (
                <button className="pz-btn" onClick={() => void p.showSolution()}>
                  Show solution
                </button>
              )}
              {(finished || p.phase === "retry") && (
                <button className="pz-btn" onClick={() => void p.retry()}>
                  Retry
                </button>
              )}
              {(finished || p.phase === "error" || p.phase === "retry") && (
                <button className="pz-btn is-main" onClick={() => void p.next()}>
                  Next puzzle
                </button>
              )}
            </div>
          </section>

          {p.end && (
            <section className="pz-card pz-info">
              <p className="pz-label">This puzzle</p>
              <p className="pz-info-line">
                Rated <strong>{p.end.puzzle.rating}</strong>
                {p.end.puzzle.opening && <span> · {p.end.puzzle.opening.split(" ")[0].replace(/_/g, " ")}</span>}
              </p>
              <div className="pz-tags">
                {p.end.puzzle.themes.map((t) => (
                  <span className="pz-tag" key={t}>
                    {themeName(t)}
                  </span>
                ))}
              </div>
              {(p.phase === "solution" || p.end.solved) && p.solutionText && (
                <p className="pz-solution">
                  <span>Solution</span> {p.solutionText}
                </p>
              )}
            </section>
          )}

          <section className="pz-card pz-settings">
            <label className="pz-field">
              <span>Difficulty</span>
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
              <span>Theme</span>
              <select
                name="theme"
                value={themeFilter}
                onChange={(e) => {
                  setThemeFilter(e.target.value);
                  remember(KEY_THEME, e.target.value);
                }}
              >
                <option value="">Any theme</option>
                {THEME_GROUPS.map((g) => (
                  <optgroup label={g.label} key={g.label}>
                    {g.tags.map((t) => (
                      <option value={t} key={t}>
                        {themeName(t)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <p className="pz-hint">Changes apply from the next puzzle.</p>
          </section>

        </aside>
      </main>
    </div>
  );
}