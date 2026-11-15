import { t, translateMessage } from "../i18n";
import { accessToken } from "../auth/supabase";
import { apiBase } from "../auth/guest";
import type { GameRecord, GameSummaryRow, RatingChange } from "./record";

const LOCAL_KEY = "tempo.games";
const LOCAL_MAX = 50;

export class HistoryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function localGames(): GameRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as GameRecord[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function keepLocally(record: GameRecord) {
  try {
    const list = localGames().filter((g) => g.id !== record.id);
    list.unshift(record);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, LOCAL_MAX)));
    return true;
  } catch {
    return false;
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/games${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new HistoryError(0, t("Can't reach the Shatranj server."));
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new HistoryError(res.status, data.message ? translateMessage(data.message) : t("Something went wrong."));
  return data as T;
}

export type Saved = { text: string; rating: RatingChange | null };

export async function saveGame(record: GameRecord, guest: boolean, ticket: string | null = null): Promise<Saved> {
  const plain = (text: string): Saved => ({ text, rating: null });
  if (guest) {
    return plain(
      keepLocally(record) ? t("Saved on this device. Sign in to keep your games everywhere.") : t("This browser doesn't allow saving games.")
    );
  }
  if (record.kind === "online") return plain(t("Saved to your history."));
  try {
    const saved = await call<{ id: string; rating?: RatingChange | null }>("", {
      method: "POST",
      body: {
        kind: "bot",
        you: record.you,
        botElo: record.botElo,
        control: record.control,
        cards: record.cards,
        steps: record.steps,
        hand: record.hand,
        cardLog: record.cardLog,
        clocks: record.clocks,
        result: record.result,
        ...(ticket ? { rated: true, ticket } : {}),
      },
    });
    return { text: t("Saved to your history."), rating: saved.rating ?? null };
  } catch (err) {
    const refused = err instanceof HistoryError && err.status >= 400 && err.status < 500;
    if (!keepLocally(record)) return plain(t("This game couldn't be saved."));
    return plain(refused ? t("Saved on this device only (the server didn't accept it).") : t("Saved on this device (the server couldn't be reached)."));
  }
}

export type HistoryPage = { games: GameSummaryRow[]; more: boolean };

export async function listGames(guest: boolean, before?: string): Promise<HistoryPage> {
  const local = localGames()
    .filter((g) => !before || g.endedAt < before)
    .map(({ steps: _steps, ...row }) => row);
  if (guest) return { games: local.slice(0, 20), more: local.length > 20 };
  const page = await call<HistoryPage>(before ? `?before=${encodeURIComponent(before)}` : "");
  const merged = [...page.games, ...local].sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1));
  return { games: merged.slice(0, Math.max(20, page.games.length)), more: page.more };
}

export async function loadGame(id: string): Promise<GameRecord> {
  if (id.startsWith("local:")) {
    const found = localGames().find((g) => g.id === id);
    if (!found) throw new HistoryError(404, t("This game isn't on this device anymore."));
    return found;
  }
  const { game } = await call<{ game: GameRecord }>(`/${encodeURIComponent(id)}`);
  return game;
}