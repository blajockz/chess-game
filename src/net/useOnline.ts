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

  function push(state: GameState, last?: Update["last"]) {
    keyRef.current += 1;
    setUpdate({ key: keyRef.current, state, last, at: performance.now() });
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
      const msg: ClientMsg | null = roomRef.current
        ? { t: "join", room: roomRef.current, ...loadToken(roomRef.current), reclaim: true }
        : hello.current;
      if (msg) void sendWithWork(ws, msg);
    };
    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      try {
        onMessage(ws, JSON.parse(String(e.data)) as ServerMsg);
      } catch {
      }
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!wantOpen.current) {
        setConnection("off");
        return;
      }
      setConnection("reconnecting");
      retry.current = window.setTimeout(connect, 1500);
    };
    ws.onerror = () => {
      if (!roomRef.current && !wantOpen.current) return;
      setError({ code: "offline", message: "Can't reach the game server." });
    };
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

  function create(control: Control, mySide: Side) {
    start({ t: "create", control, side: mySide });
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
    create,
    join,
    leave,
    move: (from: string, to: string, promotion: string | undefined, ply: number) =>
      send({ t: "move", from, to, promotion, ply }),
    resign: () => send({ t: "resign" }),
    offerDraw: () => send({ t: "draw", action: "offer" }),
    answerDraw: (accept: boolean) => send({ t: "draw", action: accept ? "accept" : "decline" }),
  };
}