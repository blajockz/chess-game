import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { securityHeaders } from "./security.js";

const here = fileURLToPath(new URL(".", import.meta.url));
export const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(here, "..", "..", "dist"));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

export function hasBuild() {
  return existsSync(join(STATIC_DIR, "index.html"));
}

function plain(req: IncomingMessage, res: ServerResponse, status: number, text: string, extra = {}) {
  res.writeHead(status, {
    ...securityHeaders(req),
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...extra,
  });
  res.end(req.method === "HEAD" ? undefined : text);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    plain(req, res, 405, "Method not allowed", { allow: "GET, HEAD" });
    return;
  }
  if ((req.url ?? "").length > 2048) {
    plain(req, res, 414, "Address too long");
    return;
  }

  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    plain(req, res, 400, "Bad request");
    return;
  }
  if (path.includes("\0")) {
    plain(req, res, 400, "Bad request");
    return;
  }

  const file = normalize(join(STATIC_DIR, path));
  const inside = file.startsWith(STATIC_DIR + sep);
  const hidden = path.split("/").some((part) => part.startsWith("."));

  if (hidden) {
    plain(req, res, 404, "Not found");
    return;
  }

  let target = join(STATIC_DIR, "index.html");
  if (inside && existsSync(file) && statSync(file).isFile()) {
    target = file;
  } else if (extname(path)) {
    plain(req, res, 404, "Not found");
    return;
  }

  const isIndex = target === join(STATIC_DIR, "index.html");
  const stream = createReadStream(target);
  stream.on("error", () => {
    if (!res.headersSent) plain(req, res, 500, "Server error");
    else res.destroy();
  });
  stream.on("open", () => {
    res.writeHead(200, {
      ...securityHeaders(req),
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": isIndex ? "no-cache" : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") {
      stream.destroy();
      res.end();
      return;
    }
    stream.pipe(res);
  });
}

export { plain };
