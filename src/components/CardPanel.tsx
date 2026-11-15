import { t } from "../i18n";
import "./CardPanel.css";
import { useEffect, useState } from "react";
import ActionCard from "./ActionCard";
import CardGuide from "./CardGuide";
import { CARDS, MAX_CHARGE, type CardId, type Category } from "../cards/cards";

type Side = "w" | "b";

type Props = {
  you: Side;
  hand: CardId[];
  used: Record<Side, CardId[]>;
  charge: Record<Side, number>;
  category: Category;
  whyNot: (card: CardId, side: Side) => string | null;
  targeting: { card: CardId; picks: string[] } | null;
  note: string | null;
  effects: string[];
  onPlay: (card: CardId) => void;
  onCancel: () => void;
};

const GUIDE_SEEN = "tempo.cardguide";

function guideSeen() {
  try {
    return localStorage.getItem(GUIDE_SEEN) === "1";
  } catch {
    return true;
  }
}

const PROMPT: Partial<Record<CardId, string[]>> = {
  shield: [t("Choose one of your pieces to shield")],
  leap: [t("Choose a pawn to push")],
  retreat: [t("Choose a rook, knight or bishop to send home")],
  swap: [t("Choose a knight or bishop"), t("Choose the piece to trade with")],
};

function Pips({ value }: { value: number }) {
  return (
    <span className="cp-pips" aria-label={t("{value} of {MAX_CHARGE} Charge", { value, MAX_CHARGE })}>
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
  category,
  whyNot,
  targeting,
  note,
  effects,
  onPlay,
  onCancel,
}: Props) {
  const [hover, setHover] = useState<CardId | null>(null);
  const [guide, setGuide] = useState(false);
  const [isNew, setIsNew] = useState(() => !guideSeen());

  function openGuide() {
    setGuide(true);
    setIsNew(false);
    try {
      localStorage.setItem(GUIDE_SEEN, "1");
    } catch {
    }
  }
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
      text: t("{v1} · Esc to cancel", { v1: steps[targeting.picks.length] ?? "Choose a square" }),
      kind: "prompt",
    };
  } else if (note) {
    line = { text: note, kind: "note" };
  } else if (hover) {
    const reason = used[you].includes(hover) ? t("Already used") : whyNot(hover, you);
    line = {
      text: `${t(CARDS[hover].name)}: ${t(CARDS[hover].text)}${reason ? ` (${reason})` : ""}`,
      kind: "info",
    };
  } else if (isNew) {
    line = { text: t("New to action cards? Open the guide with the ? button."), kind: "info" };
  }

  return (
    <section className="cp" aria-label={t("Action cards")}>
      <header className="cp-head">
        <h2 className="cp-title">
          {t("Cards")}
          <button
            className={"cp-help" + (isNew ? " is-new" : "")}
            onClick={openGuide}
            aria-label={t("Card guide: what each card does")}
            title={t("Card guide")}
          >
            ?
          </button>
        </h2>
        <span className="cp-charge">
          {t("Charge")} <Pips value={charge[you]} />
        </span>
      </header>

      <div className="cp-hand">
        {hand.map((card) => {
          const isUsed = used[you].includes(card);
          const reason = isUsed ? t("Already used") : whyNot(card, you);
          return (
            <ActionCard
              key={card}
              card={card}
              face={isUsed ? "back" : "front"}
              width={62}
              compact
              disabled={!!reason}
              selected={targeting?.card === card}
              title={`${t(CARDS[card].name)}: ${t(CARDS[card].text)}`}
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
        <div className="cp-effects" aria-label={t("Active card effects")}>
          {effects.map((e) => (
            <span key={e} className="cp-effect">
              {e}
            </span>
          ))}
        </div>
      )}

      <footer className="cp-foe">
        <span className="cp-foe-label">{t("Opponent")}</span>
        <Pips value={charge[them]} />
        <span className="cp-foe-used">
          {used[them].length
            ? t("Used: {cards}", { cards: used[them].map((c) => t(CARDS[c].name)).join(", ") })
            : t("No cards used yet")}
        </span>
      </footer>

      {guide && <CardGuide cards={hand} category={category} inGame onClose={() => setGuide(false)} />}
    </section>
  );
}