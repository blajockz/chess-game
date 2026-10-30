import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
export const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";

if (!SUPABASE_URL && !AUTH_DISABLED) {
  console.error("SUPABASE_URL is missing: set it (see .env.example), or AUTH_DISABLED=1 for local tests only.");
  process.exit(1);
}
if (AUTH_DISABLED) console.warn("AUTH_DISABLED=1: anyone can play without signing in. Never use this in production.");

const ISSUER = SUPABASE_URL + "/auth/v1";
const JWKS_URL = process.env.SUPABASE_JWKS_URL || ISSUER + "/.well-known/jwks.json";

const keys = SUPABASE_URL ? createRemoteJWKSet(new URL(JWKS_URL), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 }) : null;

export type AuthMethod = { method: string; timestamp: number };

export type Player = {
  id: string;
  email: string | null;
  name: string;
  aal: string;
  amr: AuthMethod[];
  iat: number;
  admin?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

function nameFrom(payload: JWTPayload, email: string | null) {
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  for (const key of ["display_name", "full_name", "name"]) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return clean(v);
  }
  return clean(email?.split("@")[0] || "Player");
}

function clean(name: string) {
  const text = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim();
  return [...text].slice(0, 24).join("").trim() || "Player";
}

export async function verifyToken(token: string | null | undefined): Promise<Player | null> {
  if (!token || token.length > 4096 || !JWT.test(token) || !keys) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: ISSUER,
      audience: "authenticated",
      algorithms: ["ES256", "RS256", "EdDSA"],
      clockTolerance: 30,
    });
    if (payload.role !== "authenticated" || typeof payload.sub !== "string" || !UUID.test(payload.sub)) return null;
    const email = typeof payload.email === "string" ? payload.email : null;
    const amr = Array.isArray(payload.amr)
      ? (payload.amr as unknown[]).flatMap((m) =>
          m && typeof m === "object" && typeof (m as AuthMethod).method === "string" && typeof (m as AuthMethod).timestamp === "number"
            ? [{ method: (m as AuthMethod).method, timestamp: (m as AuthMethod).timestamp }]
            : []
        )
      : [];
    return {
      id: payload.sub,
      email,
      name: nameFrom(payload, email),
      aal: typeof payload.aal === "string" ? payload.aal : "aal1",
      amr,
      iat: typeof payload.iat === "number" ? payload.iat : 0,
    };
  } catch {
    return null;
  }
}

export function secondsSince(player: Player, method: string) {
  const times = player.amr.filter((m) => m.method === method).map((m) => m.timestamp);
  return times.length ? Date.now() / 1000 - Math.max(...times) : Infinity;
}

export function bearer(req: IncomingMessage) {
  const h = String(req.headers.authorization ?? "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}

export const WS_PROTOCOL = "tempo";
const TOKEN_PREFIX = "jwt.";

export function wsToken(req: IncomingMessage) {
  const list = String(req.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((s) => s.trim());
  if (!list.includes(WS_PROTOCOL)) return null;
  const item = list.find((s) => s.startsWith(TOKEN_PREFIX));
  return item ? item.slice(TOKEN_PREFIX.length) : null;
}