import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PORT,
  type ClientMsg,
  type Control,
  type GameState,
  type ServerMsg,
  type Side,
} from "../../shared/protocol";
import { solvePow } from "../../shared/pow";
import type { CardId } from "../../shared/cards";

export type Connection = "off" | "connecting" | "open" | "reconnecting";

function serverUrl() {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  if (import.meta.env.DEV) return `${proto}://${location.hostname}:${DEFAULT_PORT}/ws`;
  return `${proto}://${location.host}/ws`;
}

const tokenKey = (room: string) => `tempo.seat.${room}`;

function saveToken(room: string, token: string) {
  try {
    sessionStorage.setItem(tokenKey(room), token);
  } catch {
  }
  try {
    localStorage.setItem(tokenKey(room), token);
  } catch {
  }
}

function loadToken(room: string): { token?: string; reclaim: boolean } {
  try {
    const own = sessionStorage.getItem(tokenKey(room));
    if (own) return { token: own, reclaim: true };
  } catch {
  }
  try {
    const shared = localStorage.getItem(tokenKey(room));
    if (shared) return { token: shared, reclaim: false };
  } catch {
  }
  return { reclaim: false };
}

export function linkFromUrl(): { room: string; invite: string | null } | null {
  const params = new URLSearchParams(location.search);
  const code = params.get("game");
  return code ? { room: code.toUpperCase(), invite: params.get("k") } : null;
}

function setUrlRoom(room: string | null) {
  const url = new URL(location.href);
  if (room) url.searchParams.set("game", room);
  else url.searchParams.delete("game");
  url.searchParams.delete("k");
  history.replaceState(null, "", url);
}

export function inviteLink(room: string, key: string) {
  return `${location.origin}${location.pathname}?game=${room}&k=${key}`;
}

const FATAL = new Set([
  "no_room",
  "room_full",
  "replaced",
  "invite_expired",
  "invite_used",
  "bad_invite",
  "server_busy",
]);

const FATAL_BEFORE_SEAT = new Set(["rate_limited", "bad_message", "bad_pow"]);

function yieldToPage() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

type Puzzle = { id: string; bits: number };

const PING_EVERY_MS = 4000;
const SILENCE_MS = 12000;

export function retryDelay(attempt: number, random = Math.random) {
  const base = Math.min(10_000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

function median(list: number[]) {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
const MAX_POW_RETRIES = 3;

export type Update = {
  key: number;
  state: GameState;
  last?: { from: string; to: string; san: string };
  at: number;
};

export function useOnline() {
  const [connection, setConnection] = useState<Connection>("off");
  const [room, setRoom] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [active, setActive] = useState(false);
  const [invite, setInvite] = useState<{ key: string; expiresAt: number } | null>(null);
  const [rtt, setRtt] = useState<number | null>(null);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; at: number } | null>(null);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [recovered, setRecovered] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const hello = useRef<ClientMsg | null>(null);
  const roomRef = useRef<string | null>(null);
  const keyRef = useRef(0);
  const wantOpen = useRef(false);
  const retry = useRef<number | undefined>(undefined);
  const puzzle = useRef<Puzzle | null>(null);
  const pending = useRef<ClientMsg | null>(null);
  const lastSent = useRef<ClientMsg | null>(null);
  const powRetries = useRef(0);
  const attempt = useRef(0);
  const dropped = useRef(false);
  const rttRef = useRef<number | null>(null);
  const samples = useRef<number[]>([]);
  const pingsOut = useRef(new Map<number, number>());
  const pingN = useRef(0);
  const lastHeard = useRef(0);

  function push(state: GameState, last?: Update["last"]) {
    keyRef.current += 1;
    const travel = (rttRef.current ?? 0) / 2;
    setUpdate({ key: keyRef.current, state, last, at: performance.now() - travel });
  }

  function retryNow() {
    if (!wantOpen.current || wsRef.current) return;
    connect();
  }

  async function sendWithWork(ws: WebSocket, msg: ClientMsg) {
    const p = puzzle.current;
    if (!p) {
      pending.current = msg;
      return;
    }
    puzzle.current = null;
    const nonce = await solvePow(p.id, p.bits, yieldToPage);
    if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
    lastSent.current = msg;
    ws.send(JSON.stringify({ ...msg, pow: nonce }));
  }

  function onMessage(ws: WebSocket, msg: ServerMsg) {
    if (msg.t === "pong") {
      const sent = pingsOut.current.get(msg.n);
      pingsOut.current.delete(msg.n);
      if (sent !== undefined) {
        samples.current = [...samples.current, performance.now() - sent].slice(-5);
        rttRef.current = Math.round(median(samples.current));
        setRtt(rttRef.current);
      }
      return;
    }
    if (msg.t === "challenge") {
      puzzle.current = { id: msg.id, bits: msg.bits };
      const waiting = pending.current;
      pending.current = null;
      if (waiting) void sendWithWork(ws, waiting);
      return;
    }
    if (msg.t === "error" && msg.code === "bad_pow" && lastSent.current && powRetries.current < MAX_POW_RETRIES) {
      powRetries.current += 1;
      void sendWithWork(ws, lastSent.current);
      return;
    }
    if (msg.t === "seat") {
      powRetries.current = 0;
      if (dropped.current) {
        dropped.current = false;
        setRecovered((n) => n + 1);
      }
      roomRef.current = msg.state.room;
      setRoom(msg.state.room);
      setSide(msg.side);
      setError(null);
      saveToken(msg.state.room, msg.token);
      setUrlRoom(msg.state.room);
      setInvite(
        msg.invite
          ? { key: msg.invite.key, expiresAt: performance.now() + msg.invite.expiresIn }
          : null
      );
      push(msg.state);
      return;
    }
    if (msg.t === "state") {
      if (msg.state.status !== "waiting") setInvite(null);
      push(msg.state, msg.last);
      return;
    }
    if (msg.t === "error") {
      setError({ code: msg.code, message: msg.message });
      if (msg.state) push(msg.state);
      const stop = FATAL.has(msg.code) || (FATAL_BEFORE_SEAT.has(msg.code) && !roomRef.current);
      if (stop) {
        setInvite(null);
        wantOpen.current = false;
        setActive(false);
        roomRef.current = null;
        setRoom(null);
        setSide(null);
        setUrlRoom(null);
        wsRef.current?.close();
      }
    }
  }

  function connect() {
    window.clearTimeout(retry.current);
    const ws = new WebSocket(serverUrl());
    wsRef.current = ws;
    puzzle.current = null;
    pending.current = null;
    setConnection((c) => (c === "open" || c === "reconnecting" ? "reconnecting" : "connecting"));

    ws.onopen = () => {
      setConnection("open");
      attempt.current = 0;
      setRetryInfo(null);
      lastHeard.current = performance.now();
      const msg: ClientMsg | null = roomRef.current
        ? { t: "join", room: roomRef.current, ...loadToken(roomRef.current), reclaim: true }
        : hello.current;
      if (msg) void sendWithWork(ws, msg);
    };
    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      lastHeard.current = performance.now();
      try {
        onMessage(ws, JSON.parse(String(e.data)) as ServerMsg);
      } catch {
      }
    };
    ws.onclose = (e) => {
      if (e.code === 1008 && /Banned/i.test(e.reason)) {
        wantOpen.current = false;
        window.location.reload();
        return;
      }
      lost(ws);
    };
    ws.onerror = () => {
      if (!roomRef.current && !wantOpen.current) return;
      setError({ code: "offline", message: "Can't reach the game server." });
    };
  }

  function lost(ws: WebSocket) {
    if (wsRef.current !== ws) return;
    wsRef.current = null;
    ws.onclose = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
    }
    if (!wantOpen.current) {
      setConnection("off");
      return;
    }
    setConnection("reconnecting");
    if (roomRef.current) dropped.current = true;
    pingsOut.current.clear();
    attempt.current += 1;
    const wait = retryDelay(attempt.current);
    setRetryInfo({ attempt: attempt.current, at: performance.now() + wait });
    retry.current = window.setTimeout(connect, wait);
  }

  function start(first: ClientMsg) {
    leave();
    hello.current = first;
    powRetries.current = 0;
    wantOpen.current = true;
    setActive(true);
    setError(null);
    connect();
  }

  function create(control: Control, mySide: Side, cards = false) {
    start({ t: "create", control, side: mySide, cards });
  }

  function join(code: string, inviteKey?: string | null) {
    const r = code.toUpperCase();
    start({ t: "join", room: r, ...loadToken(r), invite: inviteKey ?? undefined });
  }

  function send(msg: ClientMsg) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function leave() {
    wantOpen.current = false;
    attempt.current = 0;
    dropped.current = false;
    setRetryInfo(null);
    setActive(false);
    window.clearTimeout(retry.current);
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    roomRef.current = null;
    hello.current = null;
    setRoom(null);
    setSide(null);
    setUpdate(null);
    setInvite(null);
    setConnection("off");
    setUrlRoom(null);
  }

  useEffect(() => () => {
    wantOpen.current = false;
    wsRef.current?.close();
  }, []);

  useEffect(() => {
    if (connection !== "open") return;
    const id = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (performance.now() - lastHeard.current > SILENCE_MS) {
        lost(ws);
        return;
      }
      pingN.current += 1;
      pingsOut.current.set(pingN.current, performance.now());
      ws.send(JSON.stringify({ t: "ping", n: pingN.current }));
    }, PING_EVERY_MS);
    return () => window.clearInterval(id);
  }, [connection]);

  useEffect(() => {
    const goOnline = () => {
      setOffline(false);
      window.clearTimeout(retry.current);
      retryNow();
    };
    const goOffline = () => {
      setOffline(true);
      const ws = wsRef.current;
      if (ws && wantOpen.current) lost(ws);
    };
    const visible = () => {
      if (document.visibilityState === "visible" && !wsRef.current && wantOpen.current) {
        window.clearTimeout(retry.current);
        retryNow();
      }
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  return {
    active,
    invite,
    connection,
    room,
    side,
    update,
    state: update?.state ?? null,
    error,
    clearError: () => setError(null),
    rtt,
    retryInfo,
    offline,
    recovered,
    retryNow: () => {
      window.clearTimeout(retry.current);
      retryNow();
    },
    create,
    join,
    leave,
    move: (from: string, to: string, promotion: string | undefined, ply: number) =>
      send({ t: "move", from, to, promotion, ply }),
    resign: () => send({ t: "resign" }),
    playCard: (card: CardId, picks: string[], ply: number) => send({ t: "card", card, picks, ply }),
    offerDraw: () => send({ t: "draw", action: "offer" }),
    answerDraw: (accept: boolean) => send({ t: "draw", action: accept ? "accept" : "decline" }),
  };
}