import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
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
  for (const [ws, conn] of conns) if (conn.ip === ip) ws.close(1008, "Banned for too many requests");
}
const pow = new ProofOfWork();
const connectionsPerIp = new Map<string, number>();

type Conn = { ip: string; messages: RateLimiter; strikes: number; challenge: Challenge | null };
const alive = new WeakMap<WebSocket, boolean>();
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
  if (room.status !== "playing" || room.turnStartedAt === null) return;
  const turn = room.chess.turn();
  const ply = room.chess.history().length;
  room.flagTimer = setTimeout(
    safely(() => {
      if (room.status !== "playing" || room.chess.history().length !== ply) return;
      rooms.finish(room, `${turn === "w" ? "Black" : "White"} wins on time`);
      broadcast(room);
    }),
    room.clock[turn] + 50
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
  if (msg.t === "create") {
    if (!creates.take(conn.ip)) slowDown();
    requireWork(ws, conn, msg.pow);
    leaveCurrent(ws);
    const { room, side, token } = rooms.create(msg.control, msg.side, ws, conn.ip);
    where.set(ws, { room, side });
    send(ws, seatMessage(room, side, token));
    return;
  }

  if (msg.t === "join") {
    if (!joins.take(conn.ip)) slowDown();
    requireWork(ws, conn, msg.pow);
    leaveCurrent(ws);
    const { room, side, token, replaced } = rooms.join(msg.room, msg.token, ws, msg.reclaim === true, msg.invite);
    if (replaced) {
      const old = replaced as WebSocket;
      where.delete(old);
      send(old, { t: "error", code: "replaced", message: "This game was opened in another tab." });
    }
    where.set(ws, { room, side });
    if (!room.deadlineTimer) armDeadline(room);
    send(ws, seatMessage(room, side, token));
    broadcast(room);
    return;
  }

  const seat = where.get(ws);
  if (!seat) throw new GameError("not_in_room", "Join a game first.");
  const { room, side } = seat;

  if (msg.t === "move") {
    const last = rooms.move(room, side, msg.from, msg.to, msg.promotion, msg.ply);
    armFlag(room);
    armDeadline(room);
    broadcast(room, last ?? undefined);
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
  where.delete(ws);
  broadcast(seat.room);
}

function strike(ws: WebSocket, conn: Conn, why: string) {
  conn.strikes += 1;
  if (conn.strikes > LIMITS.strikesBeforeKick) {
    console.warn(`Closed a connection from ${conn.ip}: ${why}`);
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
    if (path === "/health") {
      res.writeHead(200, { ...securityHeaders(req), "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(IP_DEBUG ? { ok: true, ...ipHeaders(req) } : { ok: true }));
      return;
    }
    const ip = clientIp(req);
    const left = requestWindow.hit(ip);
    if (left < 0 || bannedFor(ip) > 0) {
      if (left === -2) banned(ip, "too many requests");
      const wait = Math.ceil(bannedFor(ip) / 1000);
      plain(req, res, 429, `Too many requests. Try again in ${Math.ceil(wait / 60)} min.`, { "retry-after": String(wait) });
      return;
    }
    if (!requests.take(ip)) {
      plain(req, res, 429, "Too many requests", { "retry-after": "10" });
      return;
    }
    res.setHeader("ratelimit-limit", String(IP_WINDOW.maxRequests));
    res.setHeader("ratelimit-remaining", String(left));
    if (SERVE_GAME) {
      serveStatic(req, res);
      return;
    }
    plain(req, res, 200, "Tempo game server. Connect with a WebSocket on /ws.");
  }
);

http.maxHeadersCount = 60;
http.maxRequestsPerSocket = 200;
http.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  else socket.destroy();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024, perMessageDeflate: false });
wss.on("error", (err) => console.error("WebSocket server error:", err.message));

function refuse(socket: Duplex, status: number, text: string) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

http.on("upgrade", (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/ws") return refuse(socket, 404, "Not Found");
  if (!originAllowed(req)) return refuse(socket, 403, "Forbidden");
  const ip = clientIp(req);
  const left = requestWindow.hit(ip);
  if (left === -2) banned(ip, "too many connections");
  if (left < 0 || bannedFor(ip) > 0) return refuse(socket, 429, "Too Many Requests");
  if (!upgrades.take(ip)) return refuse(socket, 429, "Too Many Requests");
  if (wss.clients.size >= LIMITS.maxConnections) return refuse(socket, 503, "Service Unavailable");
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws: WebSocket, req) => {
  ws.on("error", () => ws.terminate());

  const ip = clientIp(req);
  const open = (connectionsPerIp.get(ip) ?? 0) + 1;
  if (open > LIMITS.connectionsPerIp) {
    send(ws, { t: "error", code: "rate_limited", message: "Too many open connections." });
    ws.close(1013, "Too many connections");
    return;
  }
  connectionsPerIp.set(ip, open);

  alive.set(ws, true);
  ws.on("pong", () => alive.set(ws, true));

  const conn: Conn = {
    ip,
    messages: new RateLimiter(LIMITS.messages.capacity, LIMITS.messages.perSecond),
    strikes: 0,
    challenge: null,
  };
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
      if (!strike(ws, conn, "Flooding")) send(ws, { t: "error", code: "rate_limited", message: "Slow down." });
      return;
    }

    const msg = readMessage(raw as Buffer, isBinary);
    if (!msg) {
      if (!strike(ws, conn, "Bad messages")) {
        send(ws, { t: "error", code: "bad_message", message: "Couldn't read that message." });
      }
      return;
    }
    try {
      handle(ws, conn, msg);
    } catch (err) {
      if (err instanceof GameError) {
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

  ws.on("close", () => {
    leaveCurrent(ws);
    conns.delete(ws);
    const left = (connectionsPerIp.get(ip) ?? 1) - 1;
    if (left > 0) connectionsPerIp.set(ip, left);
    else connectionsPerIp.delete(ip);
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
});