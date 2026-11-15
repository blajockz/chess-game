import { t } from "../i18n";
import "./History.css";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import TopBar from "../components/TopBar";
import WeatherLayer from "../components/WeatherLayer";
import { hasWebGL } from "../three/Safe3D";
import { loadTheme, saveTheme, themeById, type ThemeId } from "../theme/themes";
import type { Account } from "../auth/AuthProvider";
import { listGames, loadGame } from "./history";
import { describeControl, type GameRecord, type GameSummaryRow } from "./record";

const ReviewView = lazy(() => import("./ReviewView"));

function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1 && new Date().getDate() === d.getDate()) {
    return t("Today, {time}", { time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
  }
  if (days < 2) return t("Yesterday, {time}", { time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function outcome(g: GameSummaryRow) {
  if (g.winner === "draw") return { tone: "draw", label: t("Draw"), short: "½" };
  if (g.you === null) return { tone: "draw", label: g.winner === "w" ? t("White won") : t("Black won"), short: "–" };
  return g.winner === g.you ? { tone: "win", label: t("Won"), short: "W" } : { tone: "loss", label: t("Lost"), short: "L" };
}

function gameFromUrl() {
  return new URLSearchParams(window.location.search).get("game");
}

export default function HistoryPage({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const canThree = useMemo(hasWebGL, []);
  const [mode, setMode] = useState<"default" | "sim">(() => (canThree && remembered("tempo.mode") === "sim" ? "sim" : "default"));
  const [soundOn, setSoundOn] = useState(true);
  const [games, setGames] = useState<GameSummaryRow[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(gameFromUrl);
  const [open, setOpen] = useState<GameRecord | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const guest = account.guest === true;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("tempo.mode", mode);
    } catch {
    }
  }, [mode]);

  useEffect(() => {
    document.title = t("History · Shatranj");
    const onPop = () => setOpenId(gameFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function load(before?: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await listGames(guest, before);
      setGames((list) => (before ? [...list, ...page.games.filter((g) => !list.some((x) => x.id === g.id))] : page.games));
      setMore(page.more);
    } catch (err) {
      setError((err as Error).message || t("Your games couldn't be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [guest]);

  useEffect(() => {
    setOpen(null);
    setOpenError(null);
    if (!openId) return;
    let live = true;
    loadGame(openId)
      .then((g) => live && setOpen(g))
      .catch((err) => live && setOpenError((err as Error).message));
    return () => {
      live = false;
    };
  }, [openId]);

  function openGame(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("game", id);
    else url.searchParams.delete("game");
    window.history.pushState({ tempo: "history" }, "", url);
    setOpenId(id);
  }

  const goPlay = () => window.location.assign("/");

  return (
    <div className="shell history">
      <WeatherLayer theme={themeById(theme)} />
      <TopBar
        mode={mode}
        onModeChange={setMode}
        simAvailable={canThree}
        soundOn={soundOn}
        onSoundToggle={() => setSoundOn((on) => !on)}
        control={t("History")}
        onNewGame={goPlay}
        theme={theme}
        onThemeChange={setTheme}
      />
      <Sidebar open={null} onOpen={goPlay} current="history" account={account} onSignOut={onSignOut} />

      {openId ? (
        open ? (
          <Suspense fallback={<div className="auth-loading">{t("Loading the review…")}</div>}>
            <ReviewView
              record={open}
              mode={mode}
              canThree={canThree}
              onThreeFail={() => setMode("default")}
              soundOn={soundOn}
              onClose={() => openGame(null)}
              closeLabel={t("All games")}
            />
          </Suspense>
        ) : (
          <main className="hs">
            <p className="hs-empty">{openError ?? t("Loading the game…")}</p>
            {openError && (
              <button className="hs-btn" onClick={() => openGame(null)}>
                {t("All games")}
              </button>
            )}
          </main>
        )
      ) : (
        <main className="hs">
          <header className="hs-head">
            <h1 className="hs-title">{t("Your games")}</h1>
            <p className="hs-sub">
              {guest
                ? t("Saved on this device while you play as a guest. Sign in to keep your games on every device.")
                : t("Every game you finish is saved here. Open one to see its review.")}
            </p>
          </header>

          {error && <p className="hs-error">{error}</p>}

          {!loading && !error && games.length === 0 && (
            <div className="hs-empty-card">
              <p className="hs-empty">{t("No games yet. Finished games appear here, ready to review.")}</p>
              <button className="hs-btn" onClick={goPlay}>
                {t("Play a game")}
              </button>
            </div>
          )}

          <ul className="hs-list">
            {games.map((g) => {
              const o = outcome(g);
              const opponent = g.you === "b" ? g.white : g.black;
              return (
                <li key={g.id}>
                  <button className="hs-game" onClick={() => openGame(g.id)}>
                    <span className={"hs-outcome is-" + o.tone} aria-label={o.label}>
                      {o.short}
                    </span>
                    <span className="hs-main">
                      <span className="hs-opponent">
                        {t("vs")} {g.you === null ? `${g.white} – ${g.black}` : opponent}
                        {g.cards && <span className="hs-tag">{t("Cards")}</span>}
                        {g.kind === "online" && <span className="hs-tag">{t("Online")}</span>}
                      </span>
                      <span className="hs-result">{g.result}</span>
                    </span>
                    <span className="hs-meta">
                      <span>{describeControl(g.control)}</span>
                      <span>{Math.ceil(g.plies / 2)} {t("moves")}</span>
                      <span>{when(g.endedAt)}</span>
                    </span>
                    <span className="hs-open">{g.cards ? t("View") : t("Review")}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {loading && <p className="hs-empty">{t("Loading…")}</p>}
          {more && !loading && (
            <button className="hs-btn hs-more" onClick={() => void load(games[games.length - 1]?.endedAt)}>
              {t("Load older games")}
            </button>
          )}
        </main>
      )}
    </div>
  );
}