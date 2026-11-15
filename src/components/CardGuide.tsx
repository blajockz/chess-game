import { t } from "../i18n";
import "./CardGuide.css";
import { useEffect, useRef } from "react";
import ActionCard from "./ActionCard";
import { CARDS, type CardId, type Category } from "../cards/cards";
import { CARD_BASICS, guideFor } from "../cards/guide";

type Props = {
  cards: CardId[];
  category: Category;
  inGame?: boolean;
  onClose: () => void;
};

export default function CardGuide({ cards, category, inGame, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="cg-scrim" onClick={onClose}>
      <div className="cg" role="dialog" aria-modal="true" aria-labelledby="cg-title" onClick={(e) => e.stopPropagation()}>
        <header className="cg-head">
          <div>
            <h2 className="cg-title" id="cg-title">
              {t("Card guide")}
            </h2>
            <p className="cg-lead">{inGame ? t("The 4 cards of this game.") : t("Every action card in Shatranj.")}</p>
          </div>
          <button className="cg-close" ref={closeRef} onClick={onClose} aria-label={t("Close the card guide")}>
            ✕
          </button>
        </header>

        <div className="cg-body">
          <section className="cg-basics" aria-label={t("How cards work")}>
            <h3 className="cg-sub">{t("How cards work")}</h3>
            <ol>
              {CARD_BASICS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </section>

          {cards.map((card) => {
            const def = CARDS[card];
            const guide = guideFor(card, category);
            return (
              <article className="cg-card" key={card} aria-label={t(def.name)}>
                <ActionCard card={card} face="front" width={78} compact />
                <div className="cg-info">
                  <h3 className="cg-name">
                    {t(def.name)}
                    <span className="cg-chip">{def.kind === "time" ? t("Time card") : t("Board card")}</span>
                    <span className="cg-chip is-cost">{def.cost} {t("Charge")}</span>
                  </h3>
                  <p className="cg-what">{guide.what}</p>
                  <dl className="cg-facts">
                    <dt>{t("Good moment")}</dt>
                    <dd>{guide.when}</dd>
                    <dt>{t("Remember")}</dt>
                    <dd>{guide.remember}</dd>
                  </dl>
                </div>
              </article>
            );
          })}
        </div>

        <footer className="cg-foot">
          <button className="cg-done" onClick={onClose}>
            {t("Got it")}
          </button>
        </footer>
      </div>
    </div>
  );
}