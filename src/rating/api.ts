import { t, translateMessage } from "../i18n";
import { accessToken } from "../auth/supabase";
import { apiBase } from "../auth/guest";

export type Level = "beginner" | "intermediate" | "advanced";
export const LEVELS: { id: Level; name: string; rating: number; text: string }[] = [
  { id: "beginner", name: t("Beginner"), rating: 800, text: t("I know how the pieces move and I'm learning to win games.") },
  { id: "intermediate", name: t("Intermediate"), rating: 1200, text: t("I play regularly and I know the common tactics.") },
  { id: "advanced", name: t("Advanced"), rating: 1600, text: t("I play in a club or online a lot, and I study the game.") },
];
export const ratingOfLevel = (level: Level) => LEVELS.find((l) => l.id === level)!.rating;

export type Rating = { rating: number; provisional: boolean; played: number; wins: number; losses: number; draws: number };
export type Ratings = { level: Level | null; chess: Rating | null; cards: Rating | null };
export type Change = { before: number; after: number; delta: number };

const KEY = "tempo.level";

export function localLevel(): Level | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "beginner" || v === "intermediate" || v === "advanced" ? v : null;
  } catch {
    return null;
  }
}

export function rememberLevel(level: Level) {
  try {
    localStorage.setItem(KEY, level);
  } catch {
  }
}

async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${apiBase()}/api/rating${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(data.message ? translateMessage(data.message) : t("Something went wrong."));
  return data as T;
}

export const ratingApi = {
  get: () => call<Ratings>(""),
  setLevel: (level: Level) => call<Ratings>("/level", { level }),
  start: (botElo: number, cards: boolean) => call<{ ticket: string; rating: Rating; abandoned: Change | null }>("/start", { botElo, cards }),
  leave: (ticket: string) => call<{ left: Change | null }>("/leave", { ticket }),
};