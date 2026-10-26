import { useEffect, useRef, useState } from "react";
import "./theme/themes.css";
import TopBar from "./components/TopBar";
import Board from "./components/Board";
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
import { inviteLink, linkFromUrl, useOnline } from "./net/useOnline";
import {
  FIRST_MOVE_MS,
  IDLE_QUIET_MS,
  IDLE_WARNING_MS,
  IDLE_WINDOW_MS,
  formatWait,
} from "../shared/protocol";

const PRACTICE_OPPONENT = true;

const DEFAULT_SETUP: SetupChoice = { initial: 300, increment: 0, side: "w" };

const DRAW_REPLY_MS = 1200;

const RESIGN_LOCK_MS = 60_000;

type Side = "w" | "b";

function reviewLabel(ply: number, san: string | undefined) {
  if (ply === 0 || !san) return "Start position";
  const number = Math.ceil(ply / 2);
  return `After ${number}${ply % 2 === 1 ? "." : "…"} ${san}`;
}

export default function App() {
  const [mode, setMode] = useState<"default" | "sim">("default");
  const [soundOn, setSoundOn] = useState(true);
  const [theme, setTheme] = useState<ThemeId>(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  const [joining, setJoining] = useState(linkFromUrl);
  const joiningCode = joining?.room ?? null;
  const [setupOpen, setSetupOpen] = useState(false);
  const [panel, setPanel] = useState<SidebarItem>("bot");
  const swallowClick = useRef(false);

  function openPanel(kind: SidebarItem) {
    if (setupOpen && panel === kind) {
      setSetupOpen(false);
      return;
    }
    setPanel(kind);
    setSetupOpen(true);
  }
  const online = useOnline();
  const onlineMode = online.active || online.room !== null || joiningCode !== null;
  const onlineRef = useRef(onlineMode);
  onlineRef.current = onlineMode;
  const serverState = online.room ? online.state : null;
  const [lastSetup, setLastSetup] = useState<SetupChoice>(DEFAULT_SETUP);
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
  const game = useChessGame(soundOn, player, vsBot, frozen, shield.filter, (m) => {
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
    setControl(controlFor(choice, side));
    setYou(side);
    setJoining(null);
    if (choice.opponent === "friend") {
      online.create(
        controlFor(choice, side),
        side,
        Boolean(choice.cards) && !isBullet(controlFor(choice, side))
      );
    } else if (onlineMode) {
      online.leave();
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
    const who = deadline.side === "w" ? "White" : "Black";
    const winner = deadline.side === "w" ? "Black" : "White";
    window.clearTimeout(drawTimer.current);
    game.clearPremove();
    setEnded(
      deadline.kind === "abort"
        ? `Game aborted: ${who} didn't make a first move`
        : `${winner} wins: ${who} didn't move for ${formatWait(IDLE_QUIET_MS + IDLE_WARNING_MS)}`
    );
  }, [now]);

  const left = deadline ? Math.max(0, deadline.at - now) : 0;
  const leftText = `0:${String(Math.ceil(left / 1000)).padStart(2, "0")}`;
  let deadlineInfo: { text: string; time: string; urgent: boolean } | null = null;
  if (deadline?.kind === "abort") {
    deadlineInfo = {
      text:
        deadline.side === you
          ? "Make your first move, or the game is aborted"
          : "Waiting for your opponent's first move",
      time: leftText,
      urgent: left <= 10_000,
    };
  } else if (deadline?.kind === "idle" && left <= IDLE_WARNING_MS) {
    deadlineInfo = {
      text: deadline.side === you ? "Move now, or you lose the game" : "Your opponent must move",
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
    setEnded(`${loser === "w" ? "Black" : "White"} wins by resignation`);
    setDrawState("idle");
  }

  function offerDraw() {
    if (over || drawState === "waiting") return;

    if (onlineMode) {
      online.offerDraw();
      return;
    }

    if (!PRACTICE_OPPONENT) {
      setEnded("Draw by agreement");
      return;
    }

    const botEdge = them === "w" ? game.materialForWhite : -game.materialForWhite;
    const offeredAt = game.ply;
    setDrawState("waiting");

    drawTimer.current = window.setTimeout(() => {
      if (overRef.current) return;
      if (botEdge < 0) {
        game.clearPremove();
        setEnded("Draw by agreement");
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
        ? "Black wins on time"
        : "White wins on time"
      : game.status);
  const edge = game.materialForWhite;
  const timeOf = (s: Side) => (s === "w" ? clocks.whiteLabel : clocks.blackLabel);
  const lowOf = (s: Side) => (s === "w" ? clocks.whiteLow : clocks.blackLow);
  const takenBy = (s: Side) => (s === "w" ? game.capturedByWhite : game.capturedByBlack);
  const edgeOf = (s: Side) => (s === "w" ? Math.max(0, edge) : Math.max(0, -edge));
  const name = (s: Side) => (s === "w" ? "White" : "Black");

  function opponentDetail() {
    if (!onlineMode) return `${name(them)} · ${PRACTICE_OPPONENT ? "Practice bot" : "Hotseat"}`;
    if (!serverState || serverState.status === "waiting") return `${name(them)} · Waiting to join`;
    return `${name(them)} · ${serverState.online[them] ? "Online" : "Disconnected"}`;
  }

  function youDetail() {
    if (onlineMode && online.connection === "reconnecting") return `${name(you)} · Reconnecting…`;
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
    "rate_limited",
  ];
  const lostRoom = !!online.error && FATAL.includes(online.error.code) && !online.room;
  const ownLinkExpired = online.error?.code === "invite_expired" && !joiningCode;

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

  const cardAt = new Map(cards.log.map((l) => [l.ply, CARDS[l.card].name]));
  const moves = game.moves.map((m, i) => ({
    ...m,
    whiteCard: cardAt.get(i * 2),
    blackCard: cardAt.get(i * 2 + 1),
  }));

  const effects: string[] = [];
  for (const s of ["w", "b"] as Side[]) {
    const who = s === you ? "Your" : "Opponent's";
    if (cards.clocksEffect.fast(s)) effects.push(`${who} clock runs ×2`);
    if (cards.clocksEffect.paused(s)) effects.push(`${who} clock is paused`);
  }
  if (cards.shieldSquare) effects.push(`Shield on ${cards.shieldSquare}`);

  return (
    <div className="shell">
      <WeatherLayer theme={themeById(theme)} />

      <TopBar
        mode={mode}
        onModeChange={setMode}
        soundOn={soundOn}
        onSoundToggle={() => setSoundOn((on) => !on)}
        control={
          onlineMode && serverState
            ? `Online · ${describeControl(serverState.control)}`
            : describeSetup(lastSetup)
        }
        onNewGame={() => openPanel("bot")}
        theme={theme}
        onThemeChange={setTheme}
      />

      <Sidebar open={setupOpen ? panel : null} onOpen={openPanel} />

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
            name="Opponent"
            detail={opponentDetail()}
            time={timeOf(them)}
            active={clocks.running && game.turn === them}
            low={lowOf(them)}
            captured={takenBy(them)}
            advantage={edgeOf(them)}
          />

          <div className={"board-wrap" + (shown ? " is-reviewing" : "")}>
            {shown ? (
              <Board
                key={game.gameId}
                board={shown.board}
                selected={null}
                legalTargets={[]}
                lastMove={shown.lastMove}
                moveKey={100000 + review.current}
                checkSquare={shown.checkSquare}
                flipped={you === "b"}
                draggableColor={null}
                onSquareClick={review.live}
              />
            ) : (
              <Board
                key={game.gameId}
                board={game.board}
                selected={game.selected}
                legalTargets={game.legalTargets}
                lastMove={game.lastMove}
                lastCapture={game.lastCapture}
                moveKey={game.moveKey}
                checkSquare={game.checkSquare}
                matedSquare={game.matedSquare}
                pending={game.pending}
                premove={game.premove}
                premoveFrom={game.premoveFrom}
                flipped={you === "b"}
                draggableColor={
                  frozen.current || cards.targeting ? null : game.myTurn ? game.turn : player
                }
                onPromote={game.choosePromotion}
                onCancelPromotion={game.cancelPromotion}
                onSquareClick={cards.targeting ? cards.pick : game.selectSquare}
                cardTargets={cards.targetSquares}
                cardPicked={cards.targeting?.picks ?? []}
                cardFlash={cards.flash}
                shielded={cards.shieldSquare}
              />
            )}

            {shown && (
              <button className="review-banner" onClick={review.live}>
                {reviewLabel(review.current, shown.move?.san)}
                <span className="review-banner-live">Back to live ⏭</span>
              </button>
            )}

            {cards.reveal && (
              <div className="card-reveal" key={cards.reveal.key}>
                <span className="card-reveal-who">
                  {cards.reveal.side === you ? "You played" : "Opponent played"}
                </span>
                <ActionCard card={cards.reveal.card} width={170} />
              </div>
            )}
          </div>

          <PlayerStrip
            name="You"
            detail={youDetail()}
            time={timeOf(you)}
            active={clocks.running && game.turn === you}
            low={lowOf(you)}
            captured={takenBy(you)}
            advantage={edgeOf(you)}
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
            onNewGame={() => openPanel("bot")}
            idle={!started && !onlineMode}
            emptyText={
              !started && !onlineMode
                ? `Move a piece to start a ${describeSetup(lastSetup)} game against the practice bot, or pick another game from the menu.`
                : undefined
            }
            incomingDraw={incomingDraw}
            onAcceptDraw={() => online.answerDraw(true)}
            onDeclineDraw={() => online.answerDraw(false)}
            review={review}
            deadline={deadlineInfo}
          />

          {cards.on && (
            <CardPanel
              you={you}
              hand={cards.hand}
              used={cards.used}
              charge={cards.charge}
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

      {!setupOpen && lostRoom && (
        <OnlineDialog
          mode="error"
          message={
            online.error!.code === "offline"
              ? "Can't reach the game server. Make sure it's running (npm run dev in the server folder)."
              : online.error!.message
          }
          title={ownLinkExpired ? "Link expired" : undefined}
          actionLabel={ownLinkExpired ? "Create a new link" : undefined}
          onNewGame={() => {
            if (ownLinkExpired) {
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

      {!setupOpen && online.room && online.invite && serverState?.status === "waiting" && (
        <OnlineDialog
          mode="invite"
          code={online.room}
          link={inviteLink(online.room, online.invite.key)}
          expiresAt={online.invite.expiresAt}
          onCancel={backToSetup}
        />
      )}

      {setupOpen && (
        <GameSetup
          key={panel}
          initial={{ ...lastSetup, opponent: panel }}
          onStart={startGame}
          onCancel={() => setSetupOpen(false)}
          onOpponentChange={setPanel}
        />
      )}
    </div>
  );
}