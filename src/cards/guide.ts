import { t } from "../i18n";
import { amountsFor, type CardId, type Category } from "./cards";

export type CardGuideEntry = {
  what: string;
  when: string;
  remember: string;
};

export const CARD_BASICS: string[] = [
  t("Both players get the same 4 cards."),
  t("Each move you make gives you 1 Charge (6 at most). Playing a card costs Charge."),
  t("Cards unlock once both players have made 5 moves."),
  t("On your turn: play a card first, then make your move. One card per turn."),
  t("Each card can be played once per game, and never while you are in check."),
];

export function guideFor(card: CardId, category: Category): CardGuideEntry {
  const a = amountsFor(category);
  switch (card) {
    case "thief":
      return {
        what: t("Takes {steal} seconds from your opponent's clock and adds them to yours.", { steal: a.steal }),
        when: t("When your opponent is short on time, or when you need a little more yourself."),
        remember: t("It never pushes their clock below 10 seconds."),
      };
    case "overclock":
      return {
        what: t("Adds {bonus} seconds to your clock.", { bonus: a.bonus }),
        when: t("When your clock is getting low. It is the cheapest card."),
        remember: t("It changes nothing on the board."),
      };
    case "hourglass":
      return {
        what: t("On their next move, your opponent's clock runs twice as fast."),
        when: t("Just before a hard decision for them: the longer they think, the more it costs."),
        remember: t("It works for one move only and takes {cap} extra seconds at most.", { cap: a.cap }),
      };
    case "pause":
      return {
        what: t("Your clock stops while you think on this turn, for up to {cap} seconds.", { cap: a.cap }),
        when: t("When the position is difficult and you need time to calculate."),
        remember: t("Play it before you start thinking: only this turn is free."),
      };
    case "shield":
      return {
        what: t("Choose one of your pieces (not the king). Your opponent can't capture it on their next move."),
        when: t("To save a piece that is attacked, or to capture something that is defended: they can't take back."),
        remember: t("It lasts one move only. It follows the piece if you move it. It is lost if that piece gives check."),
      };
    case "leap":
      return {
        what: t("Pushes one of your pawns one square forward. Then you still make your normal move."),
        when: t("To attack a piece with a pawn and still move, or to bring a pawn closer to promotion."),
        remember: t("The square in front must be empty. A pawn can't leap onto the last row, and no king may end up in check."),
      };
    case "swap":
      return {
        what: t("One of your knights and one of your bishops trade squares. Then you still make your normal move."),
        when: t("To bring a piece into the attack at once, or to pull one out of danger."),
        remember: t("Only a knight with a bishop. Not allowed if a king would end up in check."),
      };
    case "retreat":
      return {
        what: t("Sends one of your rooks, knights or bishops back to its starting square. Then you still make your normal move."),
        when: t("To save a piece that is trapped or attacked."),
        remember: t("The starting square must be empty. A bishop returns to the square of its own colour."),
      };
  }
}