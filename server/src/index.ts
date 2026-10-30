import "./env.js";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CLOSE_BANNED,
  CLOSE_UNAUTHORIZED,
  DEFAULT_PORT,
  FIRST_MOVE_MS,
  IDLE_QUIET_MS,
  IDLE_WARNING_MS,
  IDLE_WINDOW_MS,
  INVITE_TTL_MS,
  type ClientMsg,
  type ServerMsg,
  type Side,
} from "../../shared/protocol.js";
import { GameError, Rooms, type Room } from "./rooms.js";
import { IP_WINDOW, IpGuard, LIMITS, RateLimiter } from "./limits.js";
import { STATIC_DIR, hasBuild, plain, serveStatic } from "./static.js";
import { clientIp, ipHeaders, originAllowed, readMessage, securityHeaders } from "./security.js";
import { ProofOfWork, type Challenge } from "./challenges.js";
import { sendBanPage, sendBlockPage, wantsPage } from "./banpage.js";
import { blockReason, ipFilterStatus } from "./ipfilter.js";
import { AUTH_DISABLED, WS_PROTOCOL, bearer, verifyToken, wsToken, type Player } from "./auth.js";
import { LOGS_ON, banEnd, logEvent, logPresence, origin, profileOf, touch } from "./logs.js";
import { handleAdmin, setAdminHooks } from "./admin.js";

const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const ROOM_IDLE_MS = 10 * 60 * 1000;
const INVITE_TTL = Number(process.env.INVITE_TTL_MS) || INVITE_TTL_MS;
const IP_DEBUG = process.env.IP_DEBUG === "1";

const rooms = new Rooms(undefined, INVITE_TTL, {
  firstMove: Number(process.env.FIRST_MOVE_MS) || FIRST_MOVE_MS,
  quiet: Number(process.env.IDLE_QUIET_MS) || IDLE_QUIET_MS,
  warning: Number(process.env.IDLE_WARNING_MS) || IDLE_WARNING_MS,
  window: Number(process.env.IDLE_WINDOW_MS) || IDLE_WINDOW_MS,
});

const creates = new RateLimiter(LIMITS.creates.capacity, LIMITS.creates.perSecond);
const joins = new RateLimiter(LIMITS.joins.capacity, LIMITS.joins.perSecond);
const upgrades = new RateLimiter(LIMITS.upgrades.capacity, LIMITS.upgrades.perSecond);
const requests = new RateLimiter(LIMITS.http.capacity, LIMITS.http.perSecond);
const requestWindow = new IpGuard(IP_WINDOW.maxRequests, IP_WINDOW.windowMs, IP_WINDOW.banMs);
const messageWindow = new IpGuard(IP_WINDOW.maxMessages, IP_WINDOW.windowMs, IP_WINDOW.banMs);

function bannedFor(ip: string) {
  return Math.max(requestWindow.bannedFor(ip), messageWindow.bannedFor(ip));
}

function banned(ip: string, why: string) {
  console.warn(`Banned ${ip} for ${Math.round(IP_WINDOW.banMs / 60_000)} min: ${why}`);
  logEvent("banned", null, { ip, detail: { why, minutes: Math.round(IP_WINDOW.banMs / 60_000) } });
  for (const [ws, conn] of conns) if (conn.ip === ip) ws.close(1008, "Banned for too many requests");
}
const pow = new ProofOfWork();
const connectionsPerIp = new Map<string, number>();

type Conn = {
  ip: string;
  messages: RateLimiter;
  strikes: number;
  challenge: Challenge | null;
  player: Player | null;
  req: IncomingMessage;
  openedAt: number;
};
const alive = new WeakMap<WebSocket, boolean>();
const rtts = new WeakMap<WebSocket, number[]>();
const LAG_PING_MS = Number(process.env.LAG_PING_MS) || 3000;

function rttOf(ws: WebSocket): number | null {
  const list = rtts.get(ws);
  if (!list?.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

function measured(ws: WebSocket, data: Buffer) {
  const sent = Number(data.toString());
  if (!Number.isFinite(sent) || sent <= 0) return;
  const rtt = Date.now() - sent;
  if (rtt < 0 || rtt > 30_000) return;
  const list = [...(rtts.get(ws) ?? []), rtt].slice(-5);
  rtts.set(ws, list);
  const seat = where.get(ws);
  if (!seat) return;
  const before = seat.room.lag[seat.side];
  const now = rttOf(ws);
  seat.room.lag[seat.side] = now;
  const last = lagSentAt.get(seat.room) ?? 0;
  const changed = before === null || (now !== null && Math.abs(now - before) > 40);
  if (changed && (before === null || Date.now() - last > 5000)) {
    lagSentAt.set(seat.room, Date.now());
    broadcast(seat.room);
  }
}

const lagSentAt = new WeakMap<Room, number>();
const conns = new Map<WebSocket, Conn>();

const where = new Map<WebSocket, { room: Room; side: Side }>();

function send(ws: WebSocket | null | undefined, msg: ServerMsg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, last?: { from: string; to: string; san: string }) {
  const state = rooms.state(room);
  for (const side of ["w", "b"] as Side[]) {
    send(room.seats[side]?.peer as WebSocket | null, { t: "state", state, last });
  }
}

function safely(fn: () => void) {
  return () => {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  };
}

function armFlag(room: Room) {
  if (room.flagTimer) clearTimeout(room.flagTimer);
  room.flagTimer = null;
  const wait = rooms.flagIn(room);
  if (wait === null) return;
  const turn = room.chess.turn();
  const ply = rooms.ply(room);
  room.flagTimer = setTimeout(
    safely(() => {
      if (room.status !== "playing" || rooms.ply(room) !== ply) return;
      if (rooms.liveClock(room)[turn] > 0) {
        armFlag(room);
        return;
      }
      rooms.finish(room, `${turn === "w" ? "Black" : "White"} wins on time`);
      broadcast(room);
    }),
    wait + 50
  );
}

function armDeadline(room: Room) {
  if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
  room.deadlineTimer = null;
  const d = rooms.deadline(room);
  if (!d) return;
  room.deadlineTimer = setTimeout(
    safely(() => {
      room.deadlineTimer = null;
      if (rooms.missDeadline(room)) broadcast(room);
      else armDeadline(room);
    }),
    Math.max(0, d.at - Date.now()) + 20
  );
}

function seatMessage(room: Room, side: Side, token: string): ServerMsg {
  return { t: "seat", side, token, state: rooms.state(room), invite: rooms.inviteFor(room) };
}

function seatUser(conn: Conn) {
  return conn.player ? { id: conn.player.id, name: conn.player.name, admin: conn.player.admin === true } : null;
}

function slowDown(): never {
  throw new GameError("rate_limited", "Too many attempts. Wait a moment and try again.");
}

function newChallenge(ws: WebSocket, conn: Conn) {
  conn.challenge = pow.issue(conn.ip);
  send(ws, { t: "challenge", id: conn.challenge.id, bits: conn.challenge.bits });
}

function requireWork(ws: WebSocket, conn: Conn, answer: string | undefined) {
  const ok = pow.check(conn.challenge, answer, conn.ip);
  newChallenge(ws, conn);
  if (!ok) throw new GameError("bad_pow", "Security check failed. Trying again…");
}

function handle(ws: WebSocket, conn: Conn, msg: ClientMsg) {
  if (msg.t === "ping") {
    send(ws, { t: "pong", n: msg.n });
    return;
  }

  if (msg.t === "create") {
    if (!creates.take(conn.ip)) slowDown();
    requireWork(ws, conn, msg.pow);
    leaveCurrent(ws);
    const { room, side, token } = rooms.create(
      msg.control,
      msg.side,
      ws,
      conn.player?.id ?? conn.ip,
      msg.cards === true,
      seatUser(conn)
    );
    where.set(ws, { room, side });
    logEvent("game_create", conn.req, { userId: conn.player?.id, detail: { room: room.id, side, cards: msg.cards === true } });
    send(ws, seatMessage(room, side, token));
    return;
  }

  if (msg.t === "join") {
    if (!joins.take(conn.ip)) slowDown();
    requireWork(ws, conn, msg.pow);
    leaveCurrent(ws);
    const { room, side, token, replaced } = rooms.join(msg.room, msg.token, ws, msg.reclaim === true, msg.invite, seatUser(conn));
    logEvent("game_join", conn.req, { userId: conn.player?.id, detail: { room: room.id, side } });
    if (replaced) {
      const old = replaced as WebSocket;
      where.delete(old);
      send(old, { t: "error", code: "replaced", message: "This game was opened in another tab." });
    }
    where.set(ws, { room, side });
    room.lag[side] = rttOf(ws);
    if (!room.deadlineTimer) armDeadline(room);
    send(ws, seatMessage(room, side, token));
    broadcast(room);
    return;
  }

  const seat = where.get(ws);
  if (!seat) throw new GameError("not_in_room", "Join a game first.");
  const { room, side } = seat;

  if (msg.t === "move") {
    const travel = (rttOf(ws) ?? 0) / 2;
    const last = rooms.move(room, side, msg.from, msg.to, msg.promotion, msg.ply, travel);
    armFlag(room);
    armDeadline(room);
    broadcast(room, last ?? undefined);
    return;
  }

  if (msg.t === "card") {
    rooms.playCard(room, side, msg.card, msg.picks, msg.ply);
    armFlag(room);
    broadcast(room);
    return;
  }

  if (msg.t === "resign") {
    rooms.resign(room, side);
    broadcast(room);
    return;
  }

  if (msg.t === "draw") {
    if (msg.action === "offer") rooms.offerDraw(room, side);
    else if (msg.action === "accept") rooms.answerDraw(room, side, true);
    else rooms.answerDraw(room, side, false);
    broadcast(room);
    return;
  }
}

function leaveCurrent(ws: WebSocket) {
  const seat = where.get(ws);
  if (!seat) return;
  rooms.leave(seat.room, ws);
  seat.room.lag[seat.side] = null;
  where.delete(ws);
  broadcast(seat.room);
}

function strike(ws: WebSocket, conn: Conn, why: string) {
  conn.strikes += 1;
  if (conn.strikes > LIMITS.strikesBeforeKick) {
    console.warn(`Closed a connection from ${conn.ip}: ${why}`);
    logEvent("kicked", conn.req, { userId: conn.player?.id, detail: { why, strikes: conn.strikes } });
    ws.close(1008, why);
    return true;
  }
  return false;
}

const SERVE_GAME = hasBuild();

const http = createServer(
  { headersTimeout: 10_000, requestTimeout: 15_000, keepAliveTimeout: 5_000, connectionsCheckingInterval: 2000 },
  (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/health") res.on("finish", () => logRequest(req, res.statusCode));
    if (path === "/health") {
      res.writeHead(200, { ...securityHeaders(req), "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(IP_DEBUG ? { ok: true, ...ipHeaders(req), ipFilter: ipFilterStatus() } : { ok: true }));
      return;
    }
    const blocked = blockReason(req);
    if (blocked) {
      blockedRequests.add(req);
      logEvent("blocked", req, { status: 403, detail: { reason: blocked } });
      if (wantsPage(req)) sendBlockPage(req, res, blocked);
      else plain(req, res, 403, "Connections through Tor, VPNs, proxies or hosting networks aren't allowed.");
      return;
    }
    const ip = clientIp(req);
    const left = requestWindow.hit(ip);
    if (left < 0 || bannedFor(ip) > 0) {
      if (left === -2) banned(ip, "too many requests");
      const msLeft = bannedFor(ip);
      if (wantsPage(req)) {
        sendBanPage(req, res, msLeft, Math.round(IP_WINDOW.banMs / 60_000));
        return;
      }
      const wait = Math.ceil(msLeft / 1000);
      plain(req, res, 429, `Too many requests. Try again in ${Math.ceil(wait / 60)} min.`, { "retry-after": String(wait) });
      return;
    }
    if (!requests.take(ip)) {
      plain(req, res, 429, "Too many requests", { "retry-after": "10" });
      return;
    }
    res.setHeader("ratelimit-limit", String(IP_WINDOW.maxRequests));
    res.setHeader("ratelimit-remaining", String(left));
    if (path.startsWith("/api/") && req.headers.origin && originAllowed(req)) {
      res.setHeader("access-control-allow-origin", String(req.headers.origin));
      res.setHeader("vary", "origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-methods": "GET, POST",
          "access-control-allow-headers": "authorization, content-type, x-admin-session",
          "access-control-max-age": "600",
        });
        res.end();
        return;
      }
    }
    if (path.startsWith("/api/admin/")) {
      void handleAdmin(req, res, path);
      return;
    }
    if (path.startsWith("/api/")) {
      void api(req, res, path);
      return;
    }
    if (SERVE_GAME) {
      serveStatic(req, res);
      return;
    }
    plain(req, res, 200, "Tempo game server. Connect with a WebSocket on /ws.");
  }
);

const blockedRequests = new WeakSet<IncomingMessage>();

const apiUser = new WeakMap<IncomingMessage, string>();

function logRequest(req: IncomingMessage, status: number) {
  const url = req.url ?? "";
  const path = url.split("?")[0];
  const method = req.method ?? "";
  if (blockedRequests.has(req) || req.method === "OPTIONS") return;
  const userId = apiUser.get(req) ?? null;
  const query = status >= 400 && url.includes("?") ? { query: url.slice(url.indexOf("?") + 1, url.indexOf("?") + 301) } : undefined;
  if (status === 429) return logEvent("rate_limited", req, { status });
  if (path.startsWith("/api/")) return logEvent(status === 401 ? "auth_failed" : "api", req, { status, userId, detail: query });
  if (status === 404) return logEvent("not_found", req, { status, detail: query });
  if (status >= 400) return logEvent("error", req, { status, detail: query });
  if (method !== "GET" && method !== "HEAD") return logEvent("request", req, { status });
  const isPage = path === "/" || path === "/index.html" || !/\.[a-z0-9]{1,8}$/i.test(path);
  if (isPage) logEvent("page", req, { status });
}

function json(req: IncomingMessage, res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...securityHeaders(req), "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function api(req: IncomingMessage, res: import("node:http").ServerResponse, path: string) {
  try {
    if (path !== "/api/me") return json(req, res, 404, { error: "not_found" });
    if (req.method !== "GET") return json(req, res, 405, { error: "method_not_allowed" });
    const player = await verifyToken(bearer(req));
    if (!player) return json(req, res, 401, { error: "unauthorized" });
    apiUser.set(req, player.id);
    const profile = await profileOf(player.id);
    const until = banEnd(profile);
    json(req, res, 200, {
      id: player.id,
      email: player.email,
      name: profile.name ?? player.name,
      role: profile.role,
      banned: until ? { until: new Date(until).toISOString(), reason: profile.banReason } : null,
    });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(req, res, 500, { error: "server_error" });
  }
}

http.maxHeadersCount = 60;
http.maxRequestsPerSocket = 200;
http.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  else socket.destroy();
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 4 * 1024,
  perMessageDeflate: false,
  handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
});
wss.on("error", (err) => console.error("WebSocket server error:", err.message));

function refuse(socket: Duplex, status: number, text: string, req?: IncomingMessage, why?: string) {
  if (req) logEvent(status === 429 ? "rate_limited" : "refused", req, { status, detail: why ? { why } : undefined });
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

const players = new WeakMap<IncomingMessage, Player | null>();

http.on("upgrade", async (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/ws" && path !== "/presence") return refuse(socket, 404, "Not Found", req, "unknown path");
  const blocked = blockReason(req);
  if (blocked) {
    logEvent("blocked", req, { status: 403, detail: { reason: blocked, where: path } });
    return refuse(socket, 403, "Forbidden");
  }
  if (!originAllowed(req)) return refuse(socket, 403, "Forbidden", req, "origin not allowed: " + String(req.headers.origin ?? "none").slice(0, 100));
  const ip = clientIp(req);
  const left = requestWindow.hit(ip);
  if (left === -2) banned(ip, "too many connections");
  if (left < 0 || bannedFor(ip) > 0) return refuse(socket, 429, "Too Many Requests", req, "banned");
  if (!upgrades.take(ip)) return refuse(socket, 429, "Too Many Requests", req, "too many connections");
  if (wss.clients.size >= LIMITS.maxConnections) return refuse(socket, 503, "Service Unavailable", req, "server full");
  if (!String(req.headers["sec-websocket-protocol"] ?? "").includes(WS_PROTOCOL)) {
    return refuse(socket, 400, "Bad Request", req, "missing protocol");
  }

  const player = AUTH_DISABLED ? null : await verifyToken(wsToken(req));
  let bannedUntil: number | null = null;
  if (player) {
    const profile = await profileOf(player.id);
    if (profile.name) player.name = profile.name;
    player.admin = profile.role === "admin";
    bannedUntil = banEnd(profile);
  }
  if (socket.destroyed) return;
  players.set(req, player);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!AUTH_DISABLED && !player) {
      logEvent("auth_failed", req, { detail: { where: path } });
      ws.close(CLOSE_UNAUTHORIZED, "Sign in again");
      return;
    }
    if (bannedUntil) {
      logEvent("refused", req, { userId: player?.id, detail: { why: "account banned", where: path } });
      ws.close(CLOSE_BANNED, "Account suspended");
      return;
    }
    if (path === "/presence") presenceConnection(ws, req, player);
    else wss.emit("connection", ws, req);
  });
});

function opened(ws: WebSocket, ip: string) {
  const open = (connectionsPerIp.get(ip) ?? 0) + 1;
  if (open > LIMITS.connectionsPerIp) {
    send(ws, { t: "error", code: "rate_limited", message: "Too many open connections." });
    ws.close(1013, "Too many connections");
    return false;
  }
  connectionsPerIp.set(ip, open);
  ws.once("close", () => {
    const left = (connectionsPerIp.get(ip) ?? 1) - 1;
    if (left > 0) connectionsPerIp.set(ip, left);
    else connectionsPerIp.delete(ip);
  });
  alive.set(ws, true);
  ws.on("pong", () => alive.set(ws, true));
  return true;
}

const present = new Map<WebSocket, { userId: string | null; name: string | null; ip: string; country: string | null; userAgent: string | null; since: number }>();

setAdminHooks({
  online: () => {
    const rooms = new Map<string, string>();
    for (const [ws, seat] of where) {
      const id = conns.get(ws)?.player?.id;
      if (id) rooms.set(id, seat.room.id);
    }
    return [...present.values()].map((p) => ({
      ...p,
      since: new Date(p.since).toISOString(),
      room: p.userId ? rooms.get(p.userId) ?? null : null,
    }));
  },
  kickUser: (userId, code, reason) => {
    let n = 0;
    for (const [ws, p] of present) if (p.userId === userId) (ws.close(code, reason), n++);
    for (const [ws, c] of conns) if (c.player?.id === userId) (ws.close(code, reason), n++);
    return n;
  },
});

function presenceConnection(ws: WebSocket, req: IncomingMessage, player: Player | null) {
  ws.on("error", () => ws.terminate());
  if (!opened(ws, clientIp(req))) return;
  const sessionId = randomUUID();
  const started = Date.now();
  const o = origin(req);
  present.set(ws, { userId: player?.id ?? null, name: player?.name ?? null, ip: o.ip, country: o.country, userAgent: o.user_agent, since: started });
  ws.once("close", () => present.delete(ws));
  logPresence({ event: "enter", sessionId, userId: player?.id ?? null, req });
  if (player) touch(player.id);
  ws.on("message", () => {
    logEvent("bad_message", req, { userId: player?.id, detail: { where: "presence" } });
    ws.close(1008, "Unexpected message");
  });
  ws.on("close", (code) => {
    logPresence({ event: "leave", sessionId, userId: player?.id ?? null, req, durationMs: Date.now() - started, reason: String(code) });
    if (player) touch(player.id);
  });
}

wss.on("connection", (ws: WebSocket, req) => {
  ws.on("error", () => ws.terminate());

  const ip = clientIp(req);
  if (!opened(ws, ip)) return;
  ws.on("pong", (data) => measured(ws, data));

  const conn: Conn = {
    ip,
    messages: new RateLimiter(LIMITS.messages.capacity, LIMITS.messages.perSecond),
    strikes: 0,
    challenge: null,
    player: players.get(req) ?? null,
    req,
    openedAt: Date.now(),
  };
  logEvent("game_connect", req, { userId: conn.player?.id });
  if (conn.player) touch(conn.player.id);
  conns.set(ws, conn);
  newChallenge(ws, conn);

  ws.on("message", (raw, isBinary) => {
    const left = messageWindow.hit(conn.ip);
    if (left < 0) {
      if (left === -2) banned(conn.ip, "too many game messages");
      ws.close(1008, "Banned for too many requests");
      return;
    }
    if (!conn.messages.take("all")) {
      logEvent("rate_limited", conn.req, { userId: conn.player?.id, detail: { where: "game messages" } });
      if (!strike(ws, conn, "Flooding")) send(ws, { t: "error", code: "rate_limited", message: "Slow down." });
      return;
    }

    const msg = readMessage(raw as Buffer, isBinary);
    if (!msg) {
      logEvent("bad_message", conn.req, {
        userId: conn.player?.id,
        detail: { sample: isBinary ? "(binary)" : String(raw).slice(0, 200) },
      });
      if (!strike(ws, conn, "Bad messages")) {
        send(ws, { t: "error", code: "bad_message", message: "Couldn't read that message." });
      }
      return;
    }
    try {
      handle(ws, conn, msg);
    } catch (err) {
      if (err instanceof GameError) {
        if (["bad_pow", "bad_invite", "no_room", "invite_used", "invite_expired", "rate_limited"].includes(err.code)) {
          logEvent(err.code === "bad_pow" ? "bad_pow" : "game_refused", conn.req, {
            userId: conn.player?.id,
            detail: { code: err.code, room: msg.t === "join" ? msg.room : undefined },
          });
        }
        if (err.code === "bad_pow" && strike(ws, conn, "Failed security checks")) return;
        const seat = where.get(ws);
        send(ws, {
          t: "error",
          code: err.code,
          message: err.message,
          state: seat ? rooms.state(seat.room) : undefined,
        });
      } else {
        console.error(err);
        send(ws, { t: "error", code: "bad_message", message: "Something went wrong." });
      }
    }
  });

  ws.on("close", (code) => {
    const seat = where.get(ws);
    logEvent("game_disconnect", conn.req, {
      userId: conn.player?.id,
      detail: { code, seconds: Math.round((Date.now() - conn.openedAt) / 1000), room: seat?.room.id },
    });
    leaveCurrent(ws);
    conns.delete(ws);
  });
});

setInterval(
  safely(() => {
    for (const room of rooms.expireInvites()) {
      for (const side of ["w", "b"] as Side[]) {
        const peer = room.seats[side]?.peer as WebSocket | null | undefined;
        if (!peer) continue;
        where.delete(peer);
        send(peer, {
          t: "error",
          code: "invite_expired",
          message: "Nobody joined within 10 minutes, so the link has expired.",
        });
      }
    }
  }),
  2000
).unref();

setInterval(
  safely(() => {
    for (const ws of where.keys()) {
      if (ws.readyState === ws.OPEN) ws.ping(Buffer.from(String(Date.now())));
    }
  }),
  LAG_PING_MS
).unref();

setInterval(
  safely(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }),
  30_000
).unref();

setInterval(
  safely(() => {
    rooms.sweep(ROOM_IDLE_MS);
    creates.sweep();
    joins.sweep();
    upgrades.sweep();
    requests.sweep();
    requestWindow.sweep();
    messageWindow.sweep();
    pow.sweep();
  }),
  60 * 1000
).unref();

http.listen(PORT, () => {
  console.log(`Tempo server running on http://localhost:${PORT} (WebSocket: ws://localhost:${PORT}/ws)`);
  console.log(SERVE_GAME ? `Serving the game from ${STATIC_DIR}` : "No build found: run npm run build to serve the game too.");
  console.log(AUTH_DISABLED ? "Accounts: OFF (test mode)" : "Accounts: on (Supabase)");
  console.log(LOGS_ON ? "Security logs: saved to Supabase" : "Security logs: off (SUPABASE_SECRET_KEY not set)");
});