import "./CardPanel.css";
import { useEffect, useState } from "react";
import ActionCard from "./ActionCard";
import { CARDS, MAX_CHARGE, type CardId } from "../cards/cards";

type Side = "w" | "b";

type Props = {
  you: Side;
  hand: CardId[];
  used: Record<Side, CardId[]>;
  charge: Record<Side, number>;
  whyNot: (card: CardId, side: Side) => string | null;
  targeting: { card: CardId; picks: string[] } | null;
  note: string | null;
  effects: string[];
  onPlay: (card: CardId) => void;
  onCancel: () => void;
};

const PROMPT: Partial<Record<CardId, string[]>> = {
  shield: ["Choose one of your pieces to shield"],
  leap: ["Choose a pawn to push"],
  retreat: ["Choose a rook, knight or bishop to send home"],
  swap: ["Choose a knight or bishop", "Choose the piece to trade with"],
};

function Pips({ value }: { value: number }) {
  return (
    <span className="cp-pips" aria-label={`${value} of ${MAX_CHARGE} Charge`}>
      {Array.from({ length: MAX_CHARGE }, (_, i) => (
        <span key={i} className={"cp-pip" + (i < value ? " is-full" : "")} />
      ))}
    </span>
  );
}

export default function CardPanel({
  you,
  hand,
  used,
  charge,
  whyNot,
  targeting,
  note,
  effects,
  onPlay,
  onCancel,
}: Props) {
  const [hover, setHover] = useState<CardId | null>(null);
  const them: Side = you === "w" ? "b" : "w";

  useEffect(() => {
    if (!targeting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [targeting, onCancel]);

  let line: { text: string; kind: "prompt" | "note" | "info" } | null = null;
  if (targeting) {
    const steps = PROMPT[targeting.card] ?? [];
    line = {
      text: `${steps[targeting.picks.length] ?? "Choose a square"} · Esc to cancel`,
      kind: "prompt",
    };
  } else if (note) {
    line = { text: note, kind: "note" };
  } else if (hover) {
    const reason = used[you].includes(hover) ? "Already used" : whyNot(hover, you);
    line = {
      text: `${CARDS[hover].name}: ${CARDS[hover].text}${reason ? ` (${reason})` : ""}`,
      kind: "info",
    };
  }

  return (
    <section className="cp" aria-label="Action cards">
      <header className="cp-head">
        <h2 className="cp-title">Cards</h2>
        <span className="cp-charge">
          Charge <Pips value={charge[you]} />
        </span>
      </header>

      <div className="cp-hand">
        {hand.map((card) => {
          const isUsed = used[you].includes(card);
          const reason = isUsed ? "Already used" : whyNot(card, you);
          return (
            <ActionCard
              key={card}
              card={card}
              face={isUsed ? "back" : "front"}
              width={62}
              compact
              disabled={!!reason}
              selected={targeting?.card === card}
              title={`${CARDS[card].name}: ${CARDS[card].text}`}
              onHover={(on) => setHover(on ? card : null)}
              onClick={() => (targeting?.card === card ? onCancel() : onPlay(card))}
            />
          );
        })}
      </div>

      <p className={"cp-line" + (line ? ` is-${line.kind}` : "")} role="status">
        {line?.text ?? " "}
      </p>

      {effects.length > 0 && (
        <div className="cp-effects" aria-label="Active card effects">
          {effects.map((e) => (
            <span key={e} className="cp-effect">
              {e}
            </span>
          ))}
        </div>
      )}

      <footer className="cp-foe">
        <span className="cp-foe-label">Opponent</span>
        <Pips value={charge[them]} />
        <span className="cp-foe-used">
          {used[them].length
            ? `Used: ${used[them].map((c) => CARDS[c].name).join(", ")}`
            : "No cards used yet"}
        </span>
      </footer>
    </section>
  );
}
