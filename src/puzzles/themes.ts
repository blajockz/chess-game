const NAMES: Record<string, string> = {
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  mateIn4: "Mate in 4",
  mateIn5: "Mate in 5 or more",
  oneMove: "One move",
  xRayAttack: "X-ray attack",
  enPassant: "En passant",
  underPromotion: "Underpromotion",
};

export function themeName(tag: string) {
  if (NAMES[tag]) return NAMES[tag];
  const words = tag.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const THEME_GROUPS: { label: string; tags: string[] }[] = [
  { label: "Checkmates", tags: ["mate", "mateIn1", "mateIn2", "mateIn3", "backRankMate", "smotheredMate", "doubleCheck"] },
  {
    label: "Tactics",
    tags: ["fork", "pin", "skewer", "discoveredAttack", "sacrifice", "deflection", "attraction", "hangingPiece", "trappedPiece", "xRayAttack", "intermezzo", "clearance"],
  },
  { label: "Phases", tags: ["opening", "middlegame", "endgame", "rookEndgame", "pawnEndgame", "queenEndgame"] },
  { label: "Ideas", tags: ["advancedPawn", "promotion", "kingsideAttack", "defensiveMove", "quietMove", "zugzwang", "crushing"] },
  { label: "Length", tags: ["oneMove", "short", "long", "veryLong"] },
];

export const DIFFICULTIES: { value: number; label: string }[] = [
  { value: -2, label: "Easiest (−600)" },
  { value: -1, label: "Easier (−300)" },
  { value: 0, label: "Normal" },
  { value: 1, label: "Harder (+300)" },
  { value: 2, label: "Hardest (+600)" },
];