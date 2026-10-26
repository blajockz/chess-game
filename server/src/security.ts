import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { ClientMsg, Control, Side } from "../../shared/protocol.js";

export const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const IP_HEADER = (process.env.IP_HEADER ?? "x-forwarded-for").toLowerCase();

const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function ipKey(raw: string) {
  let ip = raw.trim();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (isIP(ip) === 6) {
    const [head, tail = ""] = ip.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
    return full.slice(0, 4).map((p) => p.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
  }
  return isIP(ip) ? ip : "unknown";
}

export function clientIp(req: IncomingMessage) {
  if (TRUST_PROXY) {
    const value = req.headers[IP_HEADER];
    const first = String(Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();
    if (isIP(first)) return ipKey(first);
  }
  return ipKey(req.socket.remoteAddress ?? "");
}

export function isHttps(req: IncomingMessage) {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  return TRUST_PROXY && String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
}

function safeHost(req: IncomingMessage) {
  const host = String(req.headers.host ?? "");
  return /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(host) ? host.toLowerCase() : null;
}

export function originAllowed(req: IncomingMessage) {
  const origin = String(req.headers.origin ?? "").toLowerCase();
  if (!origin) return false;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = safeHost(req);
  if (!host) return false;
  return url.hostname === host.replace(/:\d+$/, "");
}

export function securityHeaders(req: IncomingMessage): Record<string, string> {
  const https = isHttps(req);
  const host = safeHost(req);
  const socket = host ? ` ${https ? "wss" : "ws"}://${host}` : "";
  const extra = EXTRA_ORIGINS.map((o) => " " + o.replace(/^http/, "ws")).join("");
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self'${socket}${extra}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers: Record<string, string> = {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "x-permitted-cross-domain-policies": "none",
  };
  if (https) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

const SQUARE = /^[a-h][1-8]$/;
const NONCE = /^\d{1,16}$/;
const ROOM = /^[A-Za-z0-9]{1,16}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const optional = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
const shortText = (v: unknown) => typeof v === "string" && v.length <= 128;
const nonce = (v: unknown) => typeof v === "string" && NONCE.test(v);
const seconds = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000;

export function readMessage(raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): ClientMsg | null {
  if (isBinary) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
  } catch {
    return null;
  }
  if (!isObj(msg)) return null;

  switch (msg.t) {
    case "create": {
      const c = msg.control;
      if (!isObj(c) || !seconds(c.initial) || !seconds(c.increment)) return null;
      if (!optional(c.blackInitial, seconds)) return null;
      if (msg.side !== "w" && msg.side !== "b" && msg.side !== "random") return null;
      if (!optional(msg.pow, nonce)) return null;
      const control: Control = { initial: c.initial as number, increment: c.increment as number };
      if (c.blackInitial !== undefined) control.blackInitial = c.blackInitial as number;
      return { t: "create", control, side: msg.side as Side | "random", pow: msg.pow as string | undefined };
    }
    case "join": {
      if (typeof msg.room !== "string" || !ROOM.test(msg.room)) return null;
      if (!optional(msg.token, shortText) || !optional(msg.invite, shortText) || !optional(msg.pow, nonce)) return null;
      if (!optional(msg.reclaim, (v) => typeof v === "boolean")) return null;
      return {
        t: "join",
        room: msg.room.toUpperCase(),
        token: msg.token as string | undefined,
        invite: msg.invite as string | undefined,
        reclaim: msg.reclaim === true,
        pow: msg.pow as string | undefined,
      };
    }
    case "move": {
      if (typeof msg.from !== "string" || !SQUARE.test(msg.from)) return null;
      if (typeof msg.to !== "string" || !SQUARE.test(msg.to)) return null;
      if (!optional(msg.promotion, (v) => v === "q" || v === "r" || v === "b" || v === "n")) return null;
      if (!Number.isInteger(msg.ply) || (msg.ply as number) < 0 || (msg.ply as number) > 2000) return null;
      return { t: "move", from: msg.from, to: msg.to, promotion: msg.promotion as string | undefined, ply: msg.ply as number };
    }
    case "resign":
      return { t: "resign" };
    case "draw":
      if (msg.action !== "offer" && msg.action !== "accept" && msg.action !== "decline") return null;
      return { t: "draw", action: msg.action };
    default:
      return null;
  }
}
