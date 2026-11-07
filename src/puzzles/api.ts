import { accessToken } from "../auth/supabase";
import { apiBase } from "../auth/guest";

export type MyRating = {
  rating: number;
  provisional: boolean;
  played: number;
  solved: number;
  streak: number;
  bestStreak: number;
};

export type PuzzleStart = {
  session: string;
  puzzle: { id: string; fen: string; setup: string; color: "w" | "b" };
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
    throw new PuzzleApiError(0, "offline", "Can't reach the Tempo server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    throw new PuzzleApiError(res.status, data.error ?? "failed", data.message ?? "Something went wrong. Try again.");
  }
  return data as T;
}

export const puzzleApi = {
  me: () => call<{ me: MyRating | null }>("me"),
  next: (difficulty: number, theme: string | null) => call<PuzzleStart>("next", { difficulty, theme, mode: "chess" }),
  move: (session: string, move: string) => call<MoveAnswer>("move", { session, move }),
  giveUp: (session: string) => call<PuzzleEnd>("giveup", { session }),
};