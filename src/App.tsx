import { t } from "./i18n";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import "./theme/themes.css";
import TopBar from "./components/TopBar";
import Board, { type BoardProps } from "./components/Board";
import Safe3D, { hasWebGL } from "./three/Safe3D";
import PlayerStrip from "./components/PlayerStrip";
import MovePanel, { type DrawState } from "./components/MovePanel";
import WeatherLayer from "./components/WeatherLayer";
import Sidebar, { type SidebarItem } from "./components/Sidebar";
import CardPanel from "./components/CardPanel";
import ActionCard from "./components/ActionCard";
import { useCards, useShieldFilter } from "./cards/useCards";
import { CARDS } from "./cards/cards";
import { loadTheme, saveTheme, themeById, type ThemeId } from "./theme/themes";
import GameSetup, {
  controlFor,
  describeSetup,
  type SetupChoice,
} from "./components/GameSetup";
import { useChessGame } from "./game/useChessGame";
import { useReview } from "./game/useReview";
import {
  categoryOf,
  describeControl,
  isBullet,
  useClocks,
  type ClockSync,
  type TimeControl,
} from "./game/useClocks";
import OnlineDialog from "./components/OnlineDialog";
import JoinDialog from "./components/JoinDialog";
import AuthScreen from "./auth/AuthScreen";
import { AuthProvider, useAuth, type Account } from "./auth/AuthProvider";
import { usePresence } from "./net/usePresence";
import Suspended from "./auth/Suspended";
import { useBot } from "./bot/useBot";
import { clampElo, DEFAULT_ELO, levelName } from "./bot/strength";
import GameSummary from "./review/GameSummary";
import { stepsFromMoves, winnerOf, worthKeeping, type GameRecord } from "./review/record";
import { saveGame } from "./review/history";
import { useRating } from "./rating/useRating";
import { ratingApi, ratingOfLevel, type Change } from "./rating/api";
import LevelDialog from "./rating/LevelDialog";

const ReviewView = lazy(() => import("./review/ReviewView"));
const HistoryPage = lazy(() => import("./review/HistoryPage"));
const HISTORY = typeof location !== "undefined" && /^\/history(\/|$)/.test(location.pathname);

const AdminApp = lazy(() => import("./admin/AdminApp"));
const ADMIN = typeof location !== "undefined" && /^\/admin(\/|$)/.test(location.pathname);
const PuzzlesPage = lazy(() => import("./puzzles/PuzzlesPage"));
const SettingsPage = lazy(() => import("./account/SettingsPage"));
const SETTINGS = typeof location !== "undefined" && /^\/settings(\/|$)/.test(location.pathname);
const PUZZLES = typeof location !== "undefined" && /^\/puzzles(\/|$)/.test(location.pathname);
import ConnectionOverlay from "./components/ConnectionOverlay";
import { inviteLink, linkFromUrl, useOnline } from "./net/useOnline";
import {
  FIRST_MOVE_MS,
  IDLE_QUIET_MS,
  IDLE_WARNING_MS,
  IDLE_WINDOW_MS,
  formatWait,
} from "../shared/protocol";

const PRACTICE_OPPONENT = true;

function savedElo() {
  try {
    const raw = localStorage.getItem("tempo.botElo");
    return raw ? clampElo(Number(raw)) : DEFAULT_ELO;
  } catch {
    return DEFAULT_ELO;
  }
}

const DEFAULT_SETUP: SetupChoice = { initial: 300, increment: 0, side: "w", elo: savedElo() };

const DRAW_REPLY_MS = 1200;

const RESIGN_LOCK_MS = 60_000;

type Side = "w" | "b";

function reviewLabel(ply: number, san: string | undefined) {
  if (ply === 0 || !san) return t("Start position");
  const number = Math.ceil(ply / 2);
  return t("After {move}", { move: `${number}${ply % 2 === 1 ? "." : "…"} ${san}` });
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function addressWithoutKey() {
  const url = new URL(window.location.href);
  url.searchParams.delete("k");
  return url.toString();
}

function useGuestNavigation(isGuest: boolean) {
  const [view, setView] = useState<"game" | "auth">("game");
  const gameUrl = useRef("");
  useEffect(() => {
    if (!isGuest) {
      setView("game");
      return;
    }
    gameUrl.current = addressWithoutKey();
    const onAddress = () => {
      if (window.history.state?.tempo !== "auth") gameUrl.current = addressWithoutKey();
    };
    if (window.history.state?.tempo !== "game") {
      window.history.replaceState({ ...(window.history.state ?? {}), tempo: "auth" }, "");
      window.history.pushState({ tempo: "game" }, "");
    }
    const onPop = (e: PopStateEvent) => {
      if (e.state?.tempo === "auth") {
        window.history.replaceState(e.state, "", addressWithoutKey());
        setView("auth");
      } else {
        gameUrl.current = addressWithoutKey();
        setView("game");
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("tempo:address", onAddress);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("tempo:address", onAddress);
    };
  }, [isGuest]);
  return {
    view,
    toAuth: () => {
      if (window.history.state?.tempo === "game") window.history.back();
      else setView("auth");
    },
    toGame: () => {
      window.history.pushState({ tempo: "game" }, "", gameUrl.current || addressWithoutKey());
      setView("game");
    },
  };
}

function Gate() {
  const auth = useAuth();
  const banned = auth.account?.banned ?? null;
  const guestNav = useGuestNavigation(auth.status === "signed_in" && auth.account?.guest === true && !banned && !ADMIN);
  usePresence(auth.status === "signed_in" && !banned ? (auth.account?.id ?? null) : null);
  if (auth.status === "loading") return <div className="auth-loading">{t("Loading…")}</div>;
  if (auth.status === "recovery") return <AuthScreen recovery />;
  if (auth.status !== "signed_in" || !auth.account) return <AuthScreen />;
  if (banned) return <Suspended ban={banned} guest={auth.account.guest === true} />;
  if (ADMIN && auth.account.guest) return <AuthScreen />;
  if (ADMIN) {
    return (
      <Suspense fallback={<div className="auth-loading">{t("Loading…")}</div>}>
        <AdminApp account={auth.account} />
      </Suspense>
    );
  }
  if (auth.account.guest && (guestNav.view === "auth" || auth.prompt)) {
    const toGame = () => {
      auth.clearPrompt();
      guestNav.toGame();
    };
    return <AuthScreen guest={{ name: auth.account.name, onContinue: toGame }} />;
  }
  const onSignOut = auth.account.guest ? guestNav.toAuth : () => void auth.signOut();
  if (HISTORY) {
    return (
      <Suspense fallback={<div className="auth-loading">{t("Loading…")}</div>}>
        <HistoryPage account={auth.account} onSignOut={onSignOut} />
      </Suspense>
    );
  }
  if (SETTINGS) {
    return (
      <Suspense fallback={<div className="auth-loading">{t("Loading…")}</div>}>
        <SettingsPage account={auth.account} onSignOut={onSignOut} />
      </Suspense>
    );
  }
  if (PUZZLES) {
    return (
      <Suspense fallback={<div className="auth-loading">{t("Loading…")}</div>}>
        <PuzzlesPage account={auth.account} onSignOut={onSignOut} />
      </Suspense>
    );
  }
  return <Game account={auth.account} onSignOut={onSignOut} />;
}

function Game({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  const canThree = useMemo(hasWebGL, []);
  const [mode, setMode] = useState<"default" | "sim">(() => {
    try {
      return canThree && localStorage.getItem("tempo.mode") === "sim" ? "sim" : "default";
    } catch {
      return "default";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("tempo.mode", mode);
    } catch {
    }
  }, [mode]);
  const [soundOn, setSoundOn] = useState(true);
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  const [joining, setJoining] = useState<{ room: string; invite: string | null; byCode?: boolean } | null>(linkFromUrl);
  const joiningCode = joining?.room ?? null;
  const [joinOpen, setJoinOpen] = useState(() => !linkFromUrl() && new URLSearchParams(window.location.search).has("join"));
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("join")) return;
    url.searchParams.delete("join");
    window.history.replaceState(null, "", url);
  }, []);
  function joinWithCode(code: string) {
    setJoinOpen(false);
    setSetupOpen(false);
    setJoining({ room: code, invite: null, byCode: true });
    online.joinCode(code);
  }
  const [setupOpen, setSetupOpen] = useState(false);
  const [panel, setPanel] = useState<SidebarItem>("bot");
  const [setupCentered, setSetupCentered] = useState(false);
  const swallowClick = useRef(false);
  const warmUp = useRef(() => {});

  function openPanel(kind: SidebarItem, centered = false) {
    if (kind === "bot") warmUp.current();
    if (setupOpen && panel === kind && setupCentered === centered) {
      setSetupOpen(false);
      return;
    }
    setPanel(kind);
    setSetupCentered(centered);
    setSetupOpen(true);
  }
  const online = useOnline();
  const onlineMode = online.active || online.room !== null || joiningCode !== null;
  const onlineRef = useRef(onlineMode);
  onlineRef.current = onlineMode;
  const serverState = online.room ? online.state : null;
  const [lastSetup, setLastSetup] = useState<SetupChoice>(DEFAULT_SETUP);
  const isGuest = account.guest === true;
  const rating = useRating(isGuest);
  const [ticket, setTicket] = useState<string | null>(null);
  const ticketRef = useRef<string | null>(null);
  ticketRef.current = ticket;
  const [ratingChange, setRatingChange] = useState<Change | null>(null);
  const [ratedNote, setRatedNote] = useState<string | null>(null);
  const [control, setControl] = useState<TimeControl>(controlFor(DEFAULT_SETUP, "w"));
  const [you, setYou] = useState<Side>("w");
  const [started, setStarted] = useState(false);

  const [ended, setEnded] = useState<string | null>(null);
  const [drawState, setDrawState] = useState<DrawState>("idle");
  const [declinedAt, setDeclinedAt] = useState<number | null>(null);
  const drawTimer = useRef<number | undefined>(undefined);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => performance.now());

  const frozen = useRef(false);

  const vsBot = PRACTICE_OPPONENT && !onlineMode;
  const player = onlineMode || PRACTICE_OPPONENT ? you : null;
  const them: Side = you === "w" ? "b" : "w";

  const shield = useShieldFilter();
  const game = useChessGame(soundOn, player, frozen, shield.filter, (m) => {
    if (onlineRef.current) online.move(m.from, m.to, m.promotion, m.ply);
  });

  const u = online.room ? online.update : null;
  const clockSync: ClockSync | null =
    u && game.ply === u.state.moves.length
      ? {
          key: u.key,
          w: u.state.clock.w,
          b: u.state.clock.b,
          running: u.state.running,
          turn: u.state.turn,
          at: u.at,
          mods: u.state.mods,
        }
      : null;

  const serverResult = serverState?.status === "over" ? serverState.result : null;
  const waitingForFriend = onlineMode && serverState?.status !== "playing" && !serverResult;
  const gameEnded = ended ?? serverResult;

  const clocks = useClocks({
    control,
    turn: game.turn,
    ply: game.ply,
    paused:
      setupOpen ||
      gameEnded !== null ||
      waitingForFriend ||
      Boolean(game.status && game.status !== "Check") ||
      Boolean(game.pending),
    sync: clockSync,
  });

  frozen.current =
    clocks.flagged !== null ||
    setupOpen ||
    gameEnded !== null ||
    waitingForFriend ||
    (onlineMode && online.connection !== "open");

  const over =
    gameEnded !== null ||
    clocks.flagged !== null ||
    Boolean(game.status && game.status !== "Check");

  const overRef = useRef(over);
  overRef.current = over;

  const cards = useCards(
    {
      game,
      clocks,
      category: categoryOf(control),
      you,
      bot: vsBot ? them : null,
      over,
      frozen,
      drawPending: drawState === "waiting",
      remote: onlineMode
        ? {
            state: serverState?.cards ?? null,
            play: (card, picks) => online.playCard(card, picks, game.ply),
          }
        : null,
    },
    shield.ref
  );

  const botElo = clampElo(lastSetup.elo ?? DEFAULT_ELO);
  warmUp.current = () => bot.warmUp();
  const bot = useBot({
    enabled: vsBot && !over && !setupOpen,
    side: them,
    elo: botElo,
    game,
    cards,
    clocks,
    control,
    category: categoryOf(control),
  });

  useEffect(() => {
    if (online.error?.code === "card_refused") {
      cards.say(online.error.message);
      online.clearError();
    }
  }, [online.error]);

  useEffect(() => {
    if (!started && !onlineMode && game.ply > 0) {
      setStarted(true);
      setStartedAt(performance.now());
      setNow(performance.now());
    }
  }, [game.ply]);

  useEffect(() => {
    if (joining) online.join(joining.room, joining.invite);
  }, []);

  useEffect(() => {
    if (!online.room || !online.side || !online.state) return;
    setJoining(null);
    setYou(online.side);
    setControl({ ...online.state.control });
    cards.deal(false);
    setEnded(null);
    setDrawState("idle");
    game.reset();
    setStarted(true);
  }, [online.room, online.side]);

  useEffect(() => {
    if (!u) return;
    if (u.state.cards) game.followTimeline(u.state.timeline);
    else game.follow(u.state.moves);
  }, [u?.key]);

  const onlineStarted = serverState?.status === "playing";
  useEffect(() => {
    if (onlineStarted) {
      setStartedAt(performance.now());
      setNow(performance.now());
    }
  }, [onlineStarted]);

  function startGame(choice: SetupChoice) {
    const side: Side =
      choice.side === "random" ? (Math.random() < 0.5 ? "w" : "b") : choice.side;
    setLastSetup(choice);
    if (choice.elo !== undefined) {
      try {
        localStorage.setItem("tempo.botElo", String(clampElo(choice.elo)));
      } catch {
      }
    }
    setControl(controlFor(choice, side));
    setYou(side);
    setJoining(null);
    const withCards = Boolean(choice.cards) && !isBullet(controlFor(choice, side));
    const leaving = ticketRef.current;
    if (leaving && !(choice.rated && choice.opponent !== "friend")) {
      void ratingApi.leave(leaving).then(
        (r) => {
          if (r.left) setRatedNote(t("You left a rated game: it counted as a loss ({delta}).", { delta: r.left.delta }));
          void rating.refresh();
        },
        () => undefined
      );
    }
    setTicket(null);
    setRatingChange(null);
    setRatedNote(null);
    if (choice.opponent === "friend") {
      online.create(controlFor(choice, side), side, withCards, Boolean(choice.rated));
    } else {
      if (onlineMode) online.leave();
      if (choice.rated) {
        void ratingApi.start(clampElo(choice.elo ?? DEFAULT_ELO), withCards).then(
          (s) => {
            setTicket(s.ticket);
            if (!s.rated) setRatedNote(t("This game will be saved without a rating change."));
            else if (s.abandoned) setRatedNote(t("Your last rated game was left unfinished: it counted as a loss ({delta}).", { delta: s.abandoned.delta }));
            void rating.refresh();
          },
          (err) => setRatedNote(t("This game isn't rated: {v1}", { v1: err instanceof Error ? err.message : "the server couldn't be reached." }))
        );
      }
    }
    cards.deal(
      choice.opponent !== "friend" && Boolean(choice.cards) && !isBullet(controlFor(choice, side))
    );
    window.clearTimeout(drawTimer.current);
    setEnded(null);
    setDrawState("idle");
    setDeclinedAt(null);
    setStartedAt(performance.now());
    setNow(performance.now());
    game.reset();
    setStarted(true);
    setSetupOpen(false);
  }

  const turnKey = `${game.gameId}:${game.ply}`;
  const [turnMark, setTurnMark] = useState(() => ({ key: turnKey, at: performance.now() }));
  useEffect(() => {
    setTurnMark({ key: turnKey, at: performance.now() });
  }, [turnKey]);
  const turnSince = turnMark.key === turnKey ? turnMark.at : performance.now();

  type Deadline = { kind: "abort" | "idle"; side: Side; at: number };
  let deadline: Deadline | null = null;
  if (onlineMode) {
    const d = serverState?.deadline;
    if (d && u && !over) deadline = { kind: d.kind, side: d.side, at: u.at + d.in };
  } else if (started && !setupOpen && !over) {
    if (game.ply < 2) {
      deadline = { kind: "abort", side: game.turn, at: turnSince + FIRST_MOVE_MS };
    } else if (turnSince - startedAt < IDLE_WINDOW_MS) {
      deadline = { kind: "idle", side: game.turn, at: turnSince + IDLE_QUIET_MS + IDLE_WARNING_MS };
    }
  }

  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline?.kind, deadline?.side, deadline?.at]);

  useEffect(() => {
    if (onlineMode || !deadline || now < deadline.at) return;
    const who = deadline.side === "w" ? t("White") : t("Black");
    const winner = deadline.side === "w" ? t("Black") : t("White");
    window.clearTimeout(drawTimer.current);
    game.clearPremove();
    setEnded(
      deadline.kind === "abort"
        ? t("Game aborted: {who} didn't make a first move", { who })
        : t("{winner} wins: {who} didn't move for {formatWait}", { winner, who, formatWait: formatWait(IDLE_QUIET_MS + IDLE_WARNING_MS) })
    );
  }, [now]);

  const left = deadline ? Math.max(0, deadline.at - now) : 0;
  const leftText = formatWait(Math.ceil(left / 1000) * 1000);
  let deadlineInfo: { text: string; time: string; urgent: boolean } | null = null;
  if (deadline?.kind === "abort") {
    deadlineInfo = {
      text:
        deadline.side === you
          ? t("Make your first move, or the game is aborted")
          : t("Waiting for your opponent's first move"),
      time: leftText,
      urgent: left <= 10_000,
    };
  } else if (deadline?.kind === "idle" && left <= IDLE_WARNING_MS) {
    deadlineInfo = {
      text: deadline.side === you ? t("Move now, or you lose the game") : t("Your opponent must move"),
      time: leftText,
      urgent: left <= 10_000,
    };
  }

  const resignLockMs = isBullet(control)
    ? 0
    : Math.max(0, startedAt + RESIGN_LOCK_MS - now);
  const resignLocked = resignLockMs > 0 && !over;

  useEffect(() => {
    if (!resignLocked) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [resignLocked]);

  function resign() {
    if (over || resignLocked) return;
    window.clearTimeout(drawTimer.current);
    game.clearPremove();
    if (onlineMode) {
      online.resign();
      return;
    }
    const loser: Side = player ?? game.turn;
    setEnded(t("{v1} wins by resignation", { v1: loser === "w" ? "Black" : "White" }));
    setDrawState("idle");
  }

  function offerDraw() {
    if (over || drawState === "waiting") return;

    if (onlineMode) {
      online.offerDraw();
      return;
    }

    if (!PRACTICE_OPPONENT) {
      setEnded(t("Draw by agreement"));
      return;
    }

    const material = them === "w" ? game.materialForWhite : -game.materialForWhite;
    const botEdge = bot.lastScore.current !== null ? (bot.lastScore.current <= -150 ? -1 : 1) : material;
    const offeredAt = game.ply;
    setDrawState("waiting");

    drawTimer.current = window.setTimeout(() => {
      if (overRef.current) return;
      if (botEdge < 0) {
        game.clearPremove();
        setEnded(t("Draw by agreement"));
        setDrawState("idle");
      } else {
        setDrawState("declined");
        setDeclinedAt(offeredAt);
      }
    }, DRAW_REPLY_MS);
  }

  const mustMoveFirst = declinedAt !== null && game.ply < declinedAt + 2;
  const shownDrawState: DrawState =
    drawState === "declined" && !mustMoveFirst ? "idle" : drawState;
  const serverDraw = onlineMode && serverState ? serverState : null;
  const onlineBlocked = serverDraw ? game.ply < serverDraw.drawBlockedUntil[you] : false;
  const incomingDraw = !!serverDraw && serverDraw.drawOffer === them;
  const drawToShow: DrawState = serverDraw
    ? serverDraw.drawOffer === you
      ? "waiting"
      : onlineBlocked
        ? "declined"
        : "idle"
    : shownDrawState;
  const canOfferDraw = serverDraw
    ? !over &&
      serverDraw.status === "playing" &&
      serverDraw.drawOffer === null &&
      !onlineBlocked &&
      online.connection === "open"
    : !onlineMode && !over && drawState !== "waiting" && !mustMoveFirst;

  const status =
    gameEnded ??
    (clocks.flagged
      ? clocks.flagged === "w"
        ? t("Black wins on time")
        : t("White wins on time")
      : game.status);
  const edge = game.materialForWhite;
  const timeOf = (s: Side) => (s === "w" ? clocks.whiteLabel : clocks.blackLabel);
  const lowOf = (s: Side) => (s === "w" ? clocks.whiteLow : clocks.blackLow);
  const takenBy = (s: Side) => (s === "w" ? game.capturedByWhite : game.capturedByBlack);
  const edgeOf = (s: Side) => (s === "w" ? Math.max(0, edge) : Math.max(0, -edge));
  const name = (s: Side) => (s === "w" ? t("White") : t("Black"));

  const opponentName = onlineMode ? serverState?.players?.[them] || t("Opponent") : t("Shatranj Bot · {botElo}", { botElo });
  const myRating = (cards.on ? rating.ratings?.cards : rating.ratings?.chess) ?? null;
  const ratedNow = onlineMode ? serverState?.rated === true : ticket !== null;
  const finished = over && status !== null && worthKeeping(status, game.ply);
  const [record, setRecord] = useState<GameRecord | null>(null);
  useEffect(() => {
    setRecord(build());
    function build(): GameRecord | null {
      if (!finished || !status) return null;
      const winner = winnerOf(status)!;
      return {
        id: `local:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        kind: onlineMode ? "online" : "bot",
        white: you === "w" ? account.name : opponentName,
        black: you === "b" ? account.name : opponentName,
        you,
        result: status,
        winner,
        control: { ...control },
        cards: cards.on,
        steps: stepsFromMoves(game.verboseMoves),
        endedAt: new Date().toISOString(),
        botElo: onlineMode ? null : botElo,
        plies: game.ply,
        ...(cards.on ? { hand: [...cards.state.hand], cardLog: cards.log.map(({ message: _m, ...c }) => c) } : {}),
        clocks: clocks.trail(),
      };
    }
  }, [finished, game.gameId, online.room]);
  useEffect(() => {
    if (!over || finished || !ticketRef.current) return;
    void ratingApi.leave(ticketRef.current).catch(() => undefined);
    setTicket(null);
  }, [over, finished]);
  const [saved, setSaved] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    setSaved(null);
    setReviewing(false);
    if (!record) return;
    let live = true;
    const mine = ticketRef.current;
    if (mine) setTicket(null);
    void saveGame(record, account.guest === true, record.kind === "bot" ? mine : null).then((result) => {
      if (!live) return;
      setSaved(result.text);
      if (result.rating) setRatingChange(result.rating);
      if (mine) void rating.refresh();
    });
    if (record.kind === "online" && serverState?.rated && !isGuest) {
      const before = myRating?.rating ?? null;
      window.setTimeout(() => {
        void rating.refresh().then((r) => {
          const after = (cards.on ? r?.cards : r?.chess)?.rating ?? null;
          if (live && before !== null && after !== null) setRatingChange({ before, after, delta: after - before });
        });
      }, 1200);
    }
    return () => {
      live = false;
    };
  }, [record]);

  function opponentDetail() {
    if (!onlineMode) {
      if (!PRACTICE_OPPONENT) return t("{name} · Hotseat", { name: name(them) });
      const state =
        bot.status === "loading" ? t(" · Loading engine…") : bot.status === "unavailable" ? t(" · Engine unavailable") : "";
      return `${name(them)} · ${t(levelName(botElo))}${state}`;
    }
    if (!serverState || serverState.status === "waiting") return t("{name} · Waiting to join", { name: name(them) });
    return `${name(them)} · ${serverState.online[them] ? t("Online") : t("Disconnected")}`;
  }

  function youDetail() {
    if (onlineMode && online.connection === "reconnecting") return t("{name} · Reconnecting…", { name: name(you) });
    return name(you);
  }

  function backToSetup() {
    online.leave();
    online.clearError();
    setJoining(null);
    setPanel("bot");
    setSetupOpen(true);
  }

  const FATAL = [
    "offline",
    "no_room",
    "room_full",
    "replaced",
    "invite_expired",
    "invite_used",
    "bad_invite",
    "bad_code",
    "rate_limited",
  ];
  const lostRoom = !!online.error && FATAL.includes(online.error.code) && !online.room;
  const ownLinkExpired = online.error?.code === "invite_expired" && !joiningCode;

  const playing = serverState?.status === "playing";
  const oppAway = onlineMode && playing && serverState ? !serverState.online[them] : false;
  const [awaySince, setAwaySince] = useState<number | null>(null);
  const [backNote, setBackNote] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (oppAway) {
      setAwaySince(performance.now());
      return;
    }
    if (awaySince !== null && serverState?.online[them]) {
      setBackNote({ text: t("Your opponent is back"), key: performance.now() });
    }
    setAwaySince(null);
  }, [oppAway]);
  useEffect(() => {
    if (online.recovered) setBackNote({ text: t("Back online"), key: performance.now() });
  }, [online.recovered]);
  useEffect(() => {
    if (!backNote) return;
    const id = window.setTimeout(() => setBackNote(null), 2200);
    return () => window.clearTimeout(id);
  }, [backNote]);
  useEffect(() => {
    if (awaySince === null) return;
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, [awaySince]);
  const awayFor = awaySince !== null ? Math.max(0, Math.floor((performance.now() - awaySince) / 1000)) : 0;
  const awayText = `${Math.floor(awayFor / 60)}:${String(awayFor % 60).padStart(2, "0")}`;
  const connectionLost = onlineMode && !!online.room && online.connection !== "open" && !lostRoom;

  const review = useReview({
    moves: game.verboseMoves,
    gameId: game.gameId,
    keysOff: setupOpen || !!cards.targeting,
    onStep: (move, forward) => {
      if (!move) return;
      const kind = forward && move.captured ? "capture" : forward && /[kq]/.test(move.flags) ? "castle" : "move";
      game.sound(kind);
    },
  });
  const shown = review.position;

  const cardAt = new Map(cards.log.map((l) => [l.ply, t(CARDS[l.card].name)]));
  const moves = game.moves.map((m, i) => ({
    ...m,
    whiteCard: cardAt.get(i * 2),
    blackCard: cardAt.get(i * 2 + 1),
  }));

  const effects: string[] = [];
  for (const s of ["w", "b"] as Side[]) {
    const who = s === you ? t("Your") : t("Opponent's");
    if (cards.clocksEffect.fast(s)) effects.push(t("{who} clock runs ×2", { who }));
    if (cards.clocksEffect.paused(s)) effects.push(t("{who} clock is paused", { who }));
  }
  if (cards.shieldSquare) effects.push(t("Shield on {shieldSquare}", { shieldSquare: cards.shieldSquare }));

  const boardProps: BoardProps = shown
    ? {
        board: shown.board,
        selected: null,
        legalTargets: [],
        lastMove: shown.lastMove,
        moveKey: 100000 + review.current,
        checkSquare: shown.checkSquare,
        flipped: you === "b",
        draggableColor: null,
        onSquareClick: review.live,
      }
    : {
        board: game.board,
        selected: game.selected,
        legalTargets: game.legalTargets,
        lastMove: game.lastMove,
        lastCapture: game.lastCapture,
        moveKey: game.moveKey,
        checkSquare: game.checkSquare,
        matedSquare: game.matedSquare,
        pending: game.pending,
        premove: game.premove,
        premoveFrom: game.premoveFrom,
        flipped: you === "b",
        draggableColor: frozen.current || cards.targeting ? null : game.myTurn ? game.turn : player,
        onPromote: game.choosePromotion,
        onCancelPromotion: game.cancelPromotion,
        onSquareClick: cards.targeting ? cards.pick : game.selectSquare,
        cardTargets: cards.targetSquares,
        cardPicked: cards.targeting?.picks ?? [],
        cardFlash: cards.flash,
        shielded: cards.shieldSquare,
      };

  return (
    <div className="shell">
      <WeatherLayer theme={themeById(theme)} />

      <TopBar
        mode={mode}
        onModeChange={setMode}
        simAvailable={canThree}
        soundOn={soundOn}
        onSoundToggle={() => setSoundOn((on) => !on)}
        control={
          onlineMode && serverState
            ? t("Online · {describeControl}{v2}", { describeControl: describeControl(serverState.control), v2: serverState.rated ? t(" · Rated") : "" })
            : describeSetup(lastSetup) + (ratedNow ? t(" · Rated") : "")
        }
        onNewGame={() => openPanel("bot", true)}
        theme={theme}
        onThemeChange={setTheme}
      />

      <Sidebar
        open={setupOpen ? panel : null}
        onOpen={(kind) => {
          setJoinOpen(false);
          openPanel(kind);
        }}
        onJoin={() => {
          setSetupOpen(false);
          setJoinOpen((o) => !o);
        }}
        account={account}
        onSignOut={onSignOut}
      />

      {reviewing && record ? (
        <Suspense fallback={<div className="auth-loading">{t("Loading the review…")}</div>}>
          <ReviewView
            record={record}
            mode={mode}
            canThree={canThree}
            onThreeFail={() => setMode("default")}
            soundOn={soundOn}
            onClose={() => setReviewing(false)}
            closeLabel={t("Back to game")}
          />
        </Suspense>
      ) : (
        <main
          className="table"
          onPointerDownCapture={() => {
            if (!setupOpen) return;
            swallowClick.current = true;
            setSetupOpen(false);
          }}
          onClickCapture={(e) => {
            if (!swallowClick.current) return;
            swallowClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <section className="board-column">
            <PlayerStrip
              name={opponentName}
              rating={onlineMode && serverState?.ratings?.[them] != null ? { value: serverState.ratings[them]! } : null}
              admin={onlineMode && serverState?.admins?.[them] === true}
              badgeTip="down"
              detail={opponentDetail()}
              time={timeOf(them)}
              active={clocks.running && game.turn === them}
              low={lowOf(them)}
              captured={takenBy(them)}
              advantage={edgeOf(them)}
              signal={
                onlineMode && serverState && serverState.status !== "waiting"
                  ? serverState.online[them]
                    ? serverState.lag[them]
                    : "down"
                  : undefined
              }
            />

            <div className={"board-wrap" + (shown ? " is-reviewing" : "")}>
              {mode === "sim" && canThree ? (
                <Safe3D props={boardProps} fallback={<Board {...boardProps} />} onFail={() => setMode("default")} />
              ) : (
                <Board key={game.gameId} {...boardProps} />
              )}

              {shown && (
                <button className="review-banner" onClick={review.live}>
                  {reviewLabel(review.current, shown.move?.san)}
                  <span className="review-banner-live">{t("Back to live ⏭")}</span>
                </button>
              )}

              {connectionLost && (
                <ConnectionOverlay offline={online.offline} retry={online.retryInfo} onRetry={online.retryNow} />
              )}

              {!connectionLost && oppAway && (
                <div className="conn-banner" role="status">
                  <span className="conn-dot" aria-hidden="true" />
                  {t("Opponent disconnected · waiting for them")} <strong>{awayText}</strong>
                </div>
              )}

              {!connectionLost && !oppAway && backNote && (
                <div className="conn-banner is-good" role="status" key={backNote.key}>
                  <span className="conn-dot" aria-hidden="true" />
                  {backNote.text}
                </div>
              )}

              {cards.reveal && (
                <div className="card-reveal" key={cards.reveal.key}>
                  <span className="card-reveal-who">
                    {cards.reveal.side === you ? t("You played") : t("Opponent played")}
                  </span>
                  <ActionCard card={cards.reveal.card} width={170} />
                </div>
              )}
            </div>

            <PlayerStrip
              name={account.name}
              rating={myRating ? { value: myRating.rating, provisional: myRating.provisional } : null}
              admin={account.role === "admin"}
              detail={youDetail()}
              time={timeOf(you)}
              active={clocks.running && game.turn === you}
              low={lowOf(you)}
              captured={takenBy(you)}
              advantage={edgeOf(you)}
              signal={onlineMode && online.room ? (online.connection === "open" ? online.rtt : "down") : undefined}
            />
          </section>

          <div className="side-column">
            <MovePanel
              moves={moves}
              status={status}
              over={over}
              drawState={drawToShow}
              canOfferDraw={canOfferDraw}
              resignLockedFor={resignLocked ? Math.ceil(resignLockMs / 1000) : 0}
              onResign={resign}
              onOfferDraw={offerDraw}
              onNewGame={() => openPanel("bot", true)}
              idle={!started && !onlineMode}
              emptyText={
                !started && !onlineMode
                  ? t("Move a piece to start a {describeSetup} game against Shatranj Bot ({botElo}), or pick another game from the menu.", { describeSetup: describeSetup(lastSetup), botElo })
                  : undefined
              }
              incomingDraw={incomingDraw}
              onAcceptDraw={() => online.answerDraw(true)}
              onDeclineDraw={() => online.answerDraw(false)}
              review={review}
              deadline={deadlineInfo}
            />

            {ratedNote && <p className="rated-note">{ratedNote}</p>}
            {record && <GameSummary record={record} saved={saved} rating={ratingChange} onReview={() => setReviewing(true)} />}

            {cards.on && (
              <CardPanel
                you={you}
                hand={cards.hand}
                used={cards.used}
                charge={cards.charge}
                category={categoryOf(control)}
                whyNot={cards.whyNot}
                targeting={cards.targeting}
                note={cards.note}
                effects={effects}
                onPlay={cards.start}
                onCancel={cards.cancel}
              />
            )}
          </div>
        </main>
      )}

      {!setupOpen && lostRoom && (
        <OnlineDialog
          mode="error"
          message={
            online.error!.code === "offline"
              ? t("Can't reach the game server. Make sure it's running (npm run dev in the server folder).")
              : online.error!.message
          }
          title={ownLinkExpired ? t("Link expired") : undefined}
          actionLabel={ownLinkExpired ? t("Create a new link") : joining?.byCode ? t("Enter another code") : undefined}
          onNewGame={() => {
            if (joining?.byCode) {
              online.leave();
              online.clearError();
              setJoining(null);
              setJoinOpen(true);
            } else if (ownLinkExpired) {
              online.clearError();
              startGame(lastSetup);
            } else {
              backToSetup();
            }
          }}
        />
      )}

      {!setupOpen && !lostRoom && joiningCode && !online.room && (
        <OnlineDialog mode="joining" code={joiningCode} onCancel={backToSetup} />
      )}

      {joinOpen && <JoinDialog onJoin={joinWithCode} onCancel={() => setJoinOpen(false)} />}

      {!setupOpen && online.room && online.invite && serverState?.status === "waiting" && (
        <OnlineDialog
          mode="invite"
          code={online.invite.code}
          link={inviteLink(online.room, online.invite.key)}
          expiresAt={online.invite.expiresAt}
          onCancel={backToSetup}
        />
      )}

      {setupOpen && (
        <GameSetup
          key={panel + (setupCentered ? "-c" : "")}
          initial={{ ...lastSetup, opponent: panel }}
          onStart={startGame}
          onCancel={() => setSetupOpen(false)}
          onOpponentChange={setPanel}
          centered={setupCentered}
          ratedBlocked={isGuest ? t("Sign in to play rated games") : !rating.level ? t("Choose your level first") : null}
          ratedLive={ratedNow && started && !over}
        />
      )}

      {rating.needsLevel && !joiningCode && (
        <LevelDialog
          guest={isGuest}
          onChoose={async (level) => {
            await rating.choose(level);
            let chosen = false;
            try {
              chosen = localStorage.getItem("tempo.botElo") !== null;
            } catch {
              chosen = true;
            }
            if (!chosen) setLastSetup((s) => ({ ...s, elo: ratingOfLevel(level) }));
          }}
        />
      )}
    </div>
  );
}
