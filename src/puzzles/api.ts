import { t, translateMessage } from "../i18n";
import { accessToken } from "../auth/supabase";
import { apiBase } from "../auth/guest";
import { localLevel } from "../rating/api";
import type { CardId } from "../../shared/cards";

export type MyRating = {
  rating: number;
  provisional: boolean;
  played: number;
  solved: number;
  streak: number;
  bestStreak: number;
};

export type PuzzleKind = "chess" | "cards";

export type PuzzleStart = {
  session: string;
  puzzle: { id: string; fen: string; setup: string; color: "w" | "b"; cards?: { hand: CardId[] } };
  me: MyRating | null;
};

export type PuzzleEnd = {
  done: true;
  solved: boolean;
  solution: string[];
  puzzle: { id: string; rating: number; themes: string[]; opening: string };
  rating: { before: number; after: number; delta: number; me: MyRating } | null;
};

export type MoveAnswer = ({ ok: true; reply?: string; done: false } | ({ ok: boolean; reply?: string } & PuzzleEnd));

export class PuzzleApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/puzzles/${action}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new PuzzleApiError(0, "offline", t("Can't reach the Shatranj server. Check your connection and try again."));
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    throw new PuzzleApiError(res.status, data.error ?? "failed", data.message ? translateMessage(data.message) : t("Something went wrong. Try again."));
  }
  return data as T;
}

export const puzzleApi = {
  me: () => call<{ me: MyRating | null }>("me"),
  next: (kind: PuzzleKind, difficulty: number, theme: string | null) =>
    call<PuzzleStart>("next", { difficulty, theme, mode: kind, level: localLevel() }),
  move: (session: string, move: string) => call<MoveAnswer>("move", { session, move }),
  giveUp: (session: string) => call<PuzzleEnd>("giveup", { session }),
};