import { useEffect, useMemo, useRef, useState } from "react";
import type { Move, Square } from "chess.js";
import {
  CARDS,
  CLOCK_FLOOR_MS,
  MAX_CHARGE,
  UNLOCK_PLY,
  amountsFor,
  applyBoardCard,
  capturedSquare,
  dealHand,
  newCardsState,
  shieldBroken,
  targetsFor,
  type CardId,
  type CardsState,
  type PlayedCard,
  type Shield,
} from "./cards";
import type { Category } from "../game/useClocks";
import type { useChessGame } from "../game/useChessGame";
import type { useClocks } from "../game/useClocks";

type Side = "w" | "b";
type Game = ReturnType<typeof useChessGame>;
type Clocks = ReturnType<typeof useClocks>;

const other = (s: Side): Side => (s === "w" ? "b" : "w");
const NAME = { w: "White", b: "Black" };

const BOT_CARD_CHANCE = 0.45;

export type { PlayedCard };

type State = CardsState & { on: boolean };

const OFF: State = { ...newCardsState([]), on: false };

export type RemoteCards = {
  state: CardsState | null;
  play: (card: CardId, picks: string[]) => void;
};

type Options = {
  game: Game;
  clocks: Clocks;
  category: Category;
  you: Side;
  bot: Side | null;
  over: boolean;
  frozen: { current: boolean };
  drawPending: boolean;
  remote: RemoteCards | null;
};

export function useShieldFilter() {
  const ref = useRef<{ shield: Shield | null; ply: number }>({ shield: null, ply: 0 });
  const filter = (move: Move) => {
    const { shield } = ref.current;
    if (!shield || !move.captured) return true;
    return capturedSquare(move) !== shield.square;
  };
  return { ref, filter };
}

export function useCards(opts: Options, shieldRef: ReturnType<typeof useShieldFilter>["ref"]) {
  const [local, setLocal] = useState<State>(OFF);
  const [targeting, setTargeting] = useState<{ card: CardId; picks: Square[] } | null>(null);
  const [flash, setFlash] = useState<{ squares: Square[]; key: number } | null>(null);
  const [reveal, setReveal] = useState<{ card: CardId; side: Side; key: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { game, clocks, remote } = opts;
  const s: State = remote ? (remote.state ? { ...remote.state, on: true } : OFF) : local;

  const sRef = useRef(s);
  sRef.current = s;
  const o = useRef(opts);
  o.current = opts;

  const fen = game.chess.fen();

  const shieldLive =
    s.shield && game.turn !== s.shield.owner && game.ply < s.shield.untilPly && !shieldBroken(fen, s.shield)
      ? s.shield
      : null;
  shieldRef.current = { shield: shieldLive, ply: game.ply };

  const prevPly = useRef(game.ply);
  const prevGame = useRef(game.gameId);
  useEffect(() => {
    if (prevGame.current !== game.gameId) {
      prevGame.current = game.gameId;
      prevPly.current = game.ply;
      return;
    }
    if (game.ply !== prevPly.current + 1) {
      prevPly.current = game.ply;
      return;
    }
    prevPly.current = game.ply;
    setTargeting(null);
    if (o.current.remote) return;
    const mover = other(game.turn);
    const last = game.lastFullMove;

    setLocal((cur) => {
      if (!cur.on) return cur;
      let shield = cur.shield;
      if (shield && shield.owner === mover && last && last.from === shield.square) {
        shield = { ...shield, square: last.to as Square };
      }
      if (shield && game.ply >= shield.untilPly) shield = null;
      return {
        ...cur,
        shield,
        charge: { ...cur.charge, [mover]: Math.min(MAX_CHARGE, cur.charge[mover] + 1) },
      };
    });
  }, [game.ply, game.gameId]);

  useEffect(() => {
    if (opts.over) setTargeting(null);
  }, [opts.over]);

  const seen = useRef<number | null>(null);
  const remoteLog = remote?.state?.log;
  useEffect(() => {
    if (!remoteLog) {
      seen.current = null;
      return;
    }
    if (seen.current === null || remoteLog.length < seen.current) {
      seen.current = remoteLog.length;
      return;
    }
    if (remoteLog.length > seen.current) {
      seen.current = remoteLog.length;
      announce(remoteLog[remoteLog.length - 1]);
    }
  }, [remoteLog?.length]);

  const targetCache = useMemo(() => new Map<string, Square[]>(), [fen]);
  function targets(card: CardId, side: Side, picks: Square[] = []): Square[] {
    const key = `${card}:${side}:${picks.join(",")}`;
    let hit = targetCache.get(key);
    if (!hit) {
      hit = targetsFor(card, o.current.game.chess.fen(), side, picks) as Square[];
      targetCache.set(key, hit);
    }
    return hit;
  }

  function whyNot(card: CardId, side: Side): string | null {
    const cur = sRef.current;
    const { game, clocks, over, frozen, drawPending, you } = o.current;
    const def = CARDS[card];
    if (!cur.on) return "Cards are off";
    if (cur.used[side].includes(card)) return "Already used";
    if (over) return "The game is over";
    if (frozen.current) return "Not now";
    if (game.ply < UNLOCK_PLY) {
      const left = Math.ceil((UNLOCK_PLY - game.ply) / 2);
      return `Cards unlock in ${left} move${left > 1 ? "s" : ""}`;
    }
    if (game.turn !== side) return "Wait for your turn";
    if (cur.lastPlayed[side] === game.ply) return "One card per turn";
    if (game.inCheck) return "Not while in check";
    if (side === you && drawPending) return "Not while your draw offer is open";
    if (cur.charge[side] < def.cost) return `Needs ${def.cost} Charge`;
    if (card === "thief") {
      const theirs = other(side) === "w" ? clocks.white : clocks.black;
      if (theirs <= CLOCK_FLOOR_MS) return "Their clock is already under 10 s";
    }
    if (def.targets > 0 && targets(card, side).length === 0) return "No valid target right now";
    return null;
  }

  function announce(played: PlayedCard) {
    const key = Date.now();
    if (played.squares.length) setFlash({ squares: played.squares as Square[], key });
    setReveal({ card: played.card, side: played.side, key });
    setNote(played.message);
  }

  function resolve(card: CardId, side: Side, picks: Square[]) {
    const { game, clocks, category } = o.current;
    const a = amountsFor(category);
    const foe = other(side);
    let squares: string[] = [];
    let message = `${NAME[side]} played ${CARDS[card].name}`;

    if (card === "thief") {
      const theirs = foe === "w" ? clocks.white : clocks.black;
      const take = Math.min(a.steal * 1000, Math.max(0, theirs - CLOCK_FLOOR_MS));
      clocks.adjust(foe, -take);
      clocks.adjust(side, take);
      message += `: took ${Math.round(take / 1000)} s`;
    } else if (card === "overclock") {
      clocks.adjust(side, a.bonus * 1000);
      message += `: +${a.bonus} s`;
    } else if (card === "hourglass") {
      clocks.setMods(foe, { rate: 2, extra: a.cap * 1000 });
      message += `: ${NAME[foe]}'s clock runs ×2`;
    } else if (card === "pause") {
      clocks.setMods(side, { free: a.cap * 1000 });
      message += `: clock stopped for up to ${a.cap} s`;
    } else if (card === "shield") {
      squares = [picks[0]];
    } else {
      const result = applyBoardCard(card, game.chess.fen(), side, picks);
      if (!result) return false;
      game.edit((chess) => {
        chess.load(result.fen);
        return true;
      });
      squares = result.squares;
    }

    const played: PlayedCard = { ply: game.ply, side, card, squares, message };
    setLocal((cur) => ({
      ...cur,
      charge: { ...cur.charge, [side]: cur.charge[side] - CARDS[card].cost },
      used: { ...cur.used, [side]: [...cur.used[side], card] },
      lastPlayed: { ...cur.lastPlayed, [side]: game.ply },
      shield: card === "shield" ? { square: picks[0], owner: side, untilPly: game.ply + 2 } : cur.shield,
      log: [...cur.log, played],
    }));
    announce(played);
    return true;
  }

  function play(card: CardId, side: Side, picks: Square[]) {
    const { remote } = o.current;
    if (remote) {
      remote.play(card, picks);
      return true;
    }
    return resolve(card, side, picks);
  }

  function start(card: CardId) {
    const side = o.current.you;
    const reason = whyNot(card, side);
    if (reason) {
      setNote(reason);
      return;
    }
    if (CARDS[card].targets === 0) {
      play(card, side, []);
      return;
    }
    o.current.game.clearSelection();
    setTargeting({ card, picks: [] });
    setNote(null);
  }

  function pick(square: Square) {
    if (!targeting) return;
    const side = o.current.you;
    if (!targets(targeting.card, side, targeting.picks).includes(square)) return;
    const picks = [...targeting.picks, square];
    if (picks.length < CARDS[targeting.card].targets) {
      setTargeting({ ...targeting, picks });
      return;
    }
    setTargeting(null);
    if (!play(targeting.card, side, picks)) setNote("That isn't allowed");
  }

  function cancel() {
    setTargeting(null);
  }

  function deal(on: boolean) {
    setLocal(on ? { ...newCardsState(dealHand()), on: true } : OFF);
    setTargeting(null);
    setFlash(null);
    setReveal(null);
    setNote(null);
  }

  useEffect(() => {
    const { bot } = o.current;
    if (!bot || !s.on || remote || game.turn !== bot || opts.over) return;
    const id = window.setTimeout(() => {
      const cur = sRef.current;
      const playable = cur.hand.filter((c) => whyNot(c, bot) === null);
      if (!playable.length || Math.random() > BOT_CARD_CHANCE) return;
      const card = playable[Math.floor(Math.random() * playable.length)];
      const picks: Square[] = [];
      for (let i = 0; i < CARDS[card].targets; i++) {
        const options = targetsFor(card, o.current.game.chess.fen(), bot, picks);
        if (!options.length) return;
        picks.push(options[Math.floor(Math.random() * options.length)] as Square);
      }
      resolve(card, bot, picks);
    }, 250);
    return () => window.clearTimeout(id);
  }, [game.ply, game.gameId, s.on, opts.over]);

  useEffect(() => {
    if (!reveal) return;
    const id = window.setTimeout(() => setReveal(null), 1500);
    return () => window.clearTimeout(id);
  }, [reveal]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1100);
    return () => window.clearTimeout(id);
  }, [flash]);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 3200);
    return () => window.clearTimeout(id);
  }, [note]);

  const you = opts.you;
  const targetSquares = targeting ? targets(targeting.card, you, targeting.picks) : [];

  return {
    on: s.on,
    hand: s.hand,
    used: s.used,
    charge: s.charge,
    log: s.log,
    shieldSquare:
      (shieldLive?.square ?? (s.shield && s.shield.untilPly > game.ply ? s.shield.square : null)) as Square | null,
    targeting,
    targetSquares,
    flash,
    reveal,
    note,
    say: setNote,
    whyNot,
    start,
    pick,
    cancel,
    deal,
    clocksEffect: {
      fast: (side: Side) => clocks.fast(side),
      paused: (side: Side) => clocks.frozenByCard(side),
    },
  };
}