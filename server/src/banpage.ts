import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { securityHeaders } from "./security.js";

export function wantsPage(req: IncomingMessage) {
  return (req.method === "GET" || req.method === "HEAD") && String(req.headers.accept ?? "").includes("text/html");
}

export function sendBanPage(req: IncomingMessage, res: ServerResponse, msLeft: number, banMinutes: number) {
  const seconds = Math.max(1, Math.ceil(msLeft / 1000));
  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="${seconds + 2}">
<title>Suspended · Tempo</title>
<style nonce="${nonce}">
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #edeae1; background: radial-gradient(ellipse at top, #1d1b16 0%, #121210 60%);
  }
  .card {
    width: min(460px, 100%); padding: 32px 28px 26px; text-align: center;
    border-radius: 18px; background: #191916; border: 1px solid #2c2b26;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  }
  .icon {
    width: 64px; height: 64px; margin: 0 auto 16px; display: grid; place-items: center;
    border-radius: 50%; color: #ff7a5c; background: rgba(201, 69, 47, 0.14);
    border: 1px solid rgba(201, 69, 47, 0.35);
  }
  h1 { margin: 0 0 10px; font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 30px; }
  p { margin: 0 0 18px; line-height: 1.55; font-size: 15px; color: #c9c5b9; }
  .timer {
    display: inline-flex; flex-direction: column; gap: 2px; padding: 12px 22px; margin-bottom: 18px;
    border-radius: 12px; background: #211f1b; border: 1px solid #2c2b26;
  }
  .timer span { font-size: 12px; color: #8e8a7e; }
  .timer strong { font-size: 32px; font-variant-numeric: tabular-nums; color: #b8914f; letter-spacing: 0.02em; }
  small { display: block; font-size: 12.5px; line-height: 1.5; color: #8e8a7e; }
  .brand { margin-top: 22px; font-family: "Instrument Serif", Georgia, serif; font-size: 18px; color: #8e8a7e; }
</style>
</head>
<body>
<main class="card" role="alert">
  <div class="icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="30" height="30">
      <path d="M12 3l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M12 10v4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
      <circle cx="12" cy="16.9" r="1.1" fill="currentColor"/>
    </svg>
  </div>
  <h1>Access suspended</h1>
  <p>You've been suspended for ${banMinutes} minutes due to a very high number of requests coming from your IP address.</p>
  <div class="timer" aria-live="polite">
    <span>Access returns in</span>
    <strong id="left" data-seconds="${seconds}">${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}</strong>
  </div>
  <small>This page will reload by itself when the suspension ends.<br>
  If you share a network (school or office Wi-Fi), someone else on it may have caused this.</small>
  <div class="brand">Tempo</div>
</main>
<script nonce="${nonce}">
  (function () {
    var el = document.getElementById("left");
    var end = Date.now() + Number(el.getAttribute("data-seconds")) * 1000;
    function tick() {
      var s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      if (s === 0) { setTimeout(function () { location.reload(); }, 1500); return; }
      setTimeout(tick, 1000);
    }
    tick();
  })();
</script>
</body>
</html>`;

  res.writeHead(429, {
    ...securityHeaders(req),
    "content-security-policy": csp,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(seconds),
  });
  res.end(req.method === "HEAD" ? undefined : html);
}

const BLOCK_TEXT: Record<string, { title: string; text: string }> = {
  tor: {
    title: "Tor isn't allowed",
    text: "Tempo can't be played through the Tor network. Open it in a normal browser to play.",
  },
  vpn: {
    title: "VPN detected",
    text: "Tempo can't be played through a VPN or proxy. Turn your VPN off, then reload this page.",
  },
  datacenter: {
    title: "Connection not allowed",
    text: "Your connection comes from a server or hosting network (often a VPN, proxy or bot). Turn off any VPN or proxy, then reload this page.",
  },
  unknown: {
    title: "We couldn't verify your connection",
    text: "Your connection's address couldn't be read, so Tempo can't protect the game for you. Try again later, or from another network.",
  },
};

export function sendBlockPage(req: IncomingMessage, res: ServerResponse, reason: string) {
  const { title, text } = BLOCK_TEXT[reason] ?? BLOCK_TEXT.unknown;
  const nonce = randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Tempo</title>
<style nonce="${nonce}">
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #edeae1; background: radial-gradient(ellipse at top, #1d1b16 0%, #121210 60%);
  }
  .card {
    width: min(460px, 100%); padding: 32px 28px 26px; text-align: center;
    border-radius: 18px; background: #191916; border: 1px solid #2c2b26;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  }
  .icon {
    width: 64px; height: 64px; margin: 0 auto 16px; display: grid; place-items: center;
    border-radius: 50%; color: #b8914f; background: rgba(184, 145, 79, 0.14);
    border: 1px solid rgba(184, 145, 79, 0.4);
  }
  h1 { margin: 0 0 10px; font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 30px; }
  p { margin: 0 0 14px; line-height: 1.55; font-size: 15px; color: #c9c5b9; }
  small { display: block; font-size: 12.5px; line-height: 1.5; color: #8e8a7e; }
  .brand { margin-top: 22px; font-family: "Instrument Serif", Georgia, serif; font-size: 18px; color: #8e8a7e; }
</style>
</head>
<body>
<main class="card" role="alert">
  <div class="icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="30" height="30">
      <rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
    </svg>
  </div>
  <h1>${title}</h1>
  <p>${text}</p>
  <small>To keep games fair, every player must connect from their real address, so spam and cheating can be stopped.</small>
  <div class="brand">Tempo</div>
</main>
</body>
</html>`;
  res.writeHead(403, {
    ...securityHeaders(req),
    "content-security-policy": csp,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : html);
}