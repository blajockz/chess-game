import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BATCH = 1000;
const PARALLEL = 3;

function loadEnv() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}

const ID = /^[A-Za-z0-9]{3,12}$/;
const FEN = /^[pnbrqkPNBRQK1-8/]+ [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d+ \d+$/;
const MOVES = /^[a-h][1-8][a-h][1-8][qrbn]?( [a-h][1-8][a-h][1-8][qrbn]?)+$/;

function toRow(f, col) {
  const get = (name) => f[col[name]] ?? "";
  const row = {
    id: get("id"),
    fen: get("fen").trim(),
    moves: get("moves").trim(),
    rating: Number(get("rating")),
    rating_dev: Number(get("rating_dev")) || 80,
    popularity: Number(get("popularity")) || 0,
    plays: Number(get("plays")) || 0,
    themes: get("themes").split(/\s+/).filter((t) => /^[A-Za-z0-9]{2,40}$/.test(t)),
    opening: get("opening").slice(0, 200),
    game_url: /^https:\/\/lichess\.org\/[A-Za-z0-9/#_-]+$/.test(get("game_url")) ? get("game_url") : "",
    mode: "chess",
  };
  if (!ID.test(row.id) || !FEN.test(row.fen) || !MOVES.test(row.moves)) return null;
  if (!Number.isInteger(row.rating) || row.rating < 100 || row.rating > 4000) return null;
  return row;
}

async function send(url, key, rows) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${url}/rest/v1/puzzles?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: key,
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (res.ok) return;
      const text = await res.text();
      if (res.status < 500 || attempt >= 4) throw new Error(`${res.status} ${text.slice(0, 300)}`);
    } catch (err) {
      if (attempt >= 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function main() {
  loadEnv();
  const file = process.argv[2];
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!file || !existsSync(file)) {
    console.error("Usage: node scripts/import-puzzles.mjs <path to tempo_puzzles_200k.csv.gz>");
    process.exit(1);
  }
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are missing (server/.env).");
    process.exit(1);
  }

  const input = createReadStream(file);
  const lines = createInterface({ input: file.endsWith(".gz") ? input.pipe(createGunzip()) : input, crlfDelay: Infinity });
  let col = null;
  let batch = [];
  const running = new Set();
  let sent = 0;
  let skipped = 0;
  const started = Date.now();

  const flush = async () => {
    if (!batch.length) return;
    const rows = batch;
    batch = [];
    const job = send(url, key, rows).then(() => {
      sent += rows.length;
      process.stdout.write(`\rImported ${sent.toLocaleString("en")} puzzles…`);
    });
    running.add(job);
    job.then(
      () => running.delete(job),
      () => running.delete(job)
    );
    if (running.size >= PARALLEL) await Promise.race(running);
  };

  for await (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!col) {
      col = Object.fromEntries(fields.map((name, i) => [name.trim(), i]));
      for (const need of ["id", "fen", "moves", "rating"]) {
        if (!(need in col)) {
          console.error(`The file has no "${need}" column. Is it the cleaned file from the notebook?`);
          process.exit(1);
        }
      }
      continue;
    }
    const row = toRow(fields, col);
    if (!row) {
      skipped++;
      continue;
    }
    batch.push(row);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  await Promise.all(running);
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`\nDone: ${sent.toLocaleString("en")} puzzles imported in ${secs} s, ${skipped} lines skipped.`);
}

main().catch((err) => {
  console.error("\nImport failed:", err.message);
  process.exit(1);
});
