
export const MIN_ELO = 400;
export const MAX_ELO = 3000;
export const ELO_STEP = 50;
export const DEFAULT_ELO = 1200;
export const ENGINE_MIN_ELO = 1320;

export const ELO_PRESETS: { elo: number; name: string }[] = [
  { elo: 600, name: "Beginner" },
  { elo: 1000, name: "Casual" },
  { elo: 1500, name: "Club" },
  { elo: 2000, name: "Expert" },
  { elo: 2500, name: "Master" },
  { elo: 3000, name: "Max" },
];

export function clampElo(elo: number) {
  if (!Number.isFinite(elo)) return DEFAULT_ELO;
  return Math.min(MAX_ELO, Math.max(MIN_ELO, Math.round(elo / ELO_STEP) * ELO_STEP));
}

export function levelName(elo: number) {
  let name = ELO_PRESETS[0].name;
  for (const p of ELO_PRESETS) if (elo >= p.elo - 200) name = p.name;
  return name;
}

export type Plan =
  | { mode: "engine"; elo: number }
  | { mode: "weak"; depth: number; candidates: number; temperature: number; blunder: number };

const WEAK_TABLE: { elo: number; depth: number; temperature: number; blunder: number }[] = [
  { elo: 400, depth: 2, temperature: 185, blunder: 0.22 },
  { elo: 600, depth: 3, temperature: 145, blunder: 0.14 },
  { elo: 800, depth: 4, temperature: 110, blunder: 0.09 },
  { elo: 1050, depth: 5, temperature: 85, blunder: 0.06 },
  { elo: 1320, depth: 6, temperature: 65, blunder: 0.035 },
];

export function planFor(rawElo: number): Plan {
  const elo = clampElo(rawElo);
  if (elo >= ENGINE_MIN_ELO) return { mode: "engine", elo };
  let i = 0;
  while (i < WEAK_TABLE.length - 2 && elo > WEAK_TABLE[i + 1].elo) i++;
  const a = WEAK_TABLE[i];
  const b = WEAK_TABLE[i + 1];
  const f = Math.min(1, Math.max(0, (elo - a.elo) / (b.elo - a.elo)));
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    mode: "weak",
    depth: Math.round(mix(a.depth, b.depth)),
    candidates: 12,
    temperature: Math.round(mix(a.temperature, b.temperature)),
    blunder: Math.round(mix(a.blunder, b.blunder) * 1000) / 1000,
  };
}

export function pickWeak(
  lines: { move: string; score: number }[],
  legal: string[],
  plan: Extract<Plan, { mode: "weak" }>,
  random: () => number = Math.random
): string | null {
  if (!legal.length) return null;
  const known = lines.filter((l) => legal.includes(l.move));
  if (!known.length || random() < plan.blunder) return legal[Math.floor(random() * legal.length)];
  const best = known[0].score;
  const clamp = (s: number) => Math.max(-3000, Math.min(3000, s));
  const weights = known.map((l) => Math.exp(-(clamp(best) - clamp(l.score)) / plan.temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < known.length; i++) {
    r -= weights[i];
    if (r <= 0) return known[i].move;
  }
  return known[0].move;
}

export function thinkTime(myMs: number, incMs: number, ply: number, random: () => number = Math.random) {
  if (myMs < 10_000) return { search: 60, total: 0 };
  const movesLeft = Math.max(20, 40 - Math.floor(ply / 2) / 2);
  const budget = myMs / movesLeft + incMs * 0.7;
  const search = Math.round(Math.min(2500, Math.max(80, budget * 0.5)));
  const opening = ply < 8 ? 0.5 : 1;
  const total = myMs < 20_000 ? search : Math.round(Math.min(4000, Math.max(350, budget)) * opening * (0.7 + 0.6 * random()));
  return { search, total: Math.max(search, total) };
}
