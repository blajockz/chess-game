import { useEffect, useRef, useState } from "react";
import type { useChessGame } from "../game/useChessGame";
import type { useClocks, TimeControl, Category } from "../game/useClocks";
import type { useCards } from "../cards/useCards";
import { loadEngine } from "./engine";
import { chooseCard, chooseMove } from "./brain";
import { thinkTime } from "./strength";
import type { UciEngine } from "./uci";

type Side = "w" | "b";

type Options = {
  enabled: boolean;
  side: Side;
  elo: number;
  game: ReturnType<typeof useChessGame>;
  cards: ReturnType<typeof useCards>;
  clocks: ReturnType<typeof useClocks>;
  control: TimeControl;
  category: Category;
};

export type BotStatus = "idle" | "loading" | "thinking" | "unavailable";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useBot(opts: Options) {
  const ref = useRef(opts);
  ref.current = opts;
  const [status, setStatus] = useState<BotStatus>("idle");
  const lastScore = useRef<number | null>(null);
  const token = useRef(0);
  const engineRef = useRef<UciEngine | null>(null);

  const { game, enabled, side } = opts;

  useEffect(() => {
    lastScore.current = null;
    engineRef.current?.newGame();
  }, [game.gameId]);

  useEffect(() => {
    if (!enabled || game.turn !== side || game.status === "Checkmate") return;
    const mine = ++token.current;
    const live = () => mine === token.current && ref.current.enabled;
    const began = performance.now();

    void (async () => {
      let engine: UciEngine | null = engineRef.current;
      if (!engine) {
        setStatus("loading");
        try {
          engine = await loadEngine();
          engineRef.current = engine;
        } catch {
          engine = null;
        }
      }
      if (!live()) return;
      if (!engine) {
        setStatus("unavailable");
        await sleep(700);
        if (!live()) return;
        const legal = ref.current.game.legalMoves();
        if (legal.length) ref.current.game.botMove(legal[Math.floor(Math.random() * legal.length)]);
        return;
      }
      setStatus("thinking");

      const { cards, clocks, control, elo, category } = ref.current;
      const myMs = side === "w" ? clocks.white : clocks.black;
      const theirMs = side === "w" ? clocks.black : clocks.white;
      const fast = clocks.fast(side) ? 2 : 1;
      const time = thinkTime(myMs / fast, control.increment * 1000, ref.current.game.ply);

      let forced: string | undefined;
      if (cards.on) {
        const playable = cards.playableFor(side);
        if (playable.length) {
          const state = cards.state;
          const g = ref.current.game;
          const shield = state.shield && state.shield.owner !== side && g.ply < state.shield.untilPly ? state.shield.square : null;
          const choice = await chooseCard({
            engine,
            elo,
            side,
            fen: g.chess.fen(),
            ply: g.ply,
            cards: state,
            playable,
            category,
            mine: myMs,
            theirs: theirMs,
            shielded: shield,
          });
          if (!live()) return;
          if (choice && ref.current.cards.botPlay(choice.card, choice.picks)) {
            forced = choice.move;
            await sleep(900);
            if (!live()) return;
          }
        }
      }

      const g = ref.current.game;
      const legal = g.legalMoves();
      let move: string | null = forced && legal.includes(forced) ? forced : null;
      if (!move) {
        const pos = g.enginePosition();
        const choice = await chooseMove({
          engine,
          elo,
          fen: pos.fen,
          moves: pos.moves,
          legal,
          movetime: time.search,
          threats: ref.current.cards.on ? { cards: ref.current.cards.state, plyAfter: g.ply + 1 } : null,
        });
        if (!live()) return;
        move = choice?.move ?? null;
        if (choice?.score !== null && choice?.score !== undefined) lastScore.current = choice.score;
      }

      const wait = time.total - (performance.now() - began);
      if (wait > 0) await sleep(wait);
      if (!live() || !move) return;
      setStatus("idle");
      if (!ref.current.game.botMove(move)) {
        const now = ref.current.game.legalMoves();
        if (now.length) ref.current.game.botMove(now[0]);
      }
    })();

    return () => {
      token.current++;
      engineRef.current?.cancel();
    };
  }, [enabled, game.turn, game.ply, game.gameId, side]);

  function warmUp() {
    if (engineRef.current) return;
    loadEngine().then(
      (e) => {
        engineRef.current = e;
      },
      () => undefined
    );
  }

  return { status, lastScore, warmUp };
}
