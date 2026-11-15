import { t } from "../i18n";

const NAMES: Record<string, string> = {
  mateIn1: t("Mate in 1"),
  mateIn2: t("Mate in 2"),
  mateIn3: t("Mate in 3"),
  mateIn4: t("Mate in 4"),
  mateIn5: t("Mate in 5 or more"),
  oneMove: t("One move"),
  xRayAttack: t("X-ray attack"),
  enPassant: t("En passant"),
  underPromotion: t("Underpromotion"),
};

export function themeName(tag: string) {
  if (NAMES[tag]) return NAMES[tag];
  const words = tag.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
  return t(words.charAt(0).toUpperCase() + words.slice(1));
}

export const THEME_GROUPS: { label: string; tags: string[] }[] = [
  { label: t("Checkmates"), tags: ["mate", "mateIn1", "mateIn2", "mateIn3", "backRankMate", "smotheredMate", "doubleCheck"] },
  {
    label: t("Tactics"),
    tags: ["fork", "pin", "skewer", "discoveredAttack", "sacrifice", "deflection", "attraction", "hangingPiece", "trappedPiece", "xRayAttack", "intermezzo", "clearance"],
  },
  { label: t("Phases"), tags: ["opening", "middlegame", "endgame", "rookEndgame", "pawnEndgame", "queenEndgame"] },
  { label: t("Ideas"), tags: ["advancedPawn", "promotion", "kingsideAttack", "defensiveMove", "quietMove", "zugzwang", "crushing"] },
  { label: t("Length"), tags: ["oneMove", "short", "long", "veryLong"] },
];

export const DIFFICULTIES: { value: number; label: string }[] = [
  { value: -2, label: t("Easiest (−600)") },
  { value: -1, label: t("Easier (−300)") },
  { value: 0, label: t("Normal") },
  { value: 1, label: t("Harder (+300)") },
  { value: 2, label: t("Hardest (+600)") },
];