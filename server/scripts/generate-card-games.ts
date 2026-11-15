import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UciEngine, START_FEN } from "../../src/bot/uci";
import { chooseCard, chooseMove } from "../../src/bot/brain";
import { thinkTime } from "../../src/bot/strength";
import { CARDS, categoryOf, dealHand, type CardId } from "../../shared/cards";
import { CardReferee, replayCardGame, type Control } from "../../shared/cardGame";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = { w: "White", b: "Black" } as const;
type Side = "w" | "b";
const other = (s: Side): Side => (s === "w" ? "b" : "w");

function option(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

const GAMES = Math.max(1, Number(option("games", "100")));
const JOBS = Math.max(1, Math.min(16, Number(option("jobs", "2"))));
const OUT = resolve(option("out", "generated-card-games.jsonl")!);
const UPLOAD = option("upload") === "true";
const THINK = Math.max(50, Number(option("think", "300")));
const SEED = Number(option("seed", String(Date.now() % 1_000_000_000)));
const ENGINE = resolve(option("engine", join(HERE, "..", "..", "public", "engine", "stockfish-19-lite-single.js"))!);

const CONTROLS: Control[] = [
  { initial: 180, increment: 2 },
  { initial: 300, increment: 0 },
  { initial: 300, increment: 3 },
  { initial: 600, increment: 0 },
  { initial: 600, increment: 5 },
  { initial: 900, increment: 10 },
  { initial: 1800, increment: 0 },
];

function loadEnv() {
  const file = join(HERE, "..", ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let runnable: string | null = null;
function runnableEngine() {
  if (runnable) return runnable;
  if (!existsSync(ENGINE)) throw new Error(`Stockfish not found: ${ENGINE} (use --engine <file>)`);
  const name = basename(ENGINE, extname(ENGINE));
  const wasm = join(dirname(ENGINE), name + ".wasm");
  if (!existsSync(wasm)) throw new Error(`Stockfish's .wasm file not found: ${wasm}`);
  const dir = join(tmpdir(), "tempo-engine");
  mkdirSync(dir, { recursive: true });
  copyFileSync(ENGINE, join(dir, name + ".cjs"));
  copyFileSync(wasm, join(dir, name + ".wasm"));
  runnable = join(dir, name + ".cjs");
  return runnable;
}

async function startEngine(): Promise<{ engine: UciEngine; proc: ChildProcess }> {
  const proc = spawn(process.execPath, [runnableEngine()], { stdio: ["pipe", "pipe", "pipe"] });
  let errors = "";
  proc.stderr!.on("data", (data) => {
    errors = (errors + data).slice(-2000);
  });
  let buffer = "";
  const engine = new UciEngine({
    post: (command) => proc.stdin!.write(command + "\n"),
    listen: (onLine) => {
      proc.stdout!.on("data", (data) => {
        buffer += data;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) onLine(line.trim());
      });
    },
  });
  const died = new Promise<never>((_, reject) => {
    proc.once("error", (err) => reject(new Error(`The chess engine couldn't be launched: ${err.message}`)));
    proc.once("exit", (code) =>
      reject(new Error(`The chess engine stopped (exit code ${code}).${errors ? "\n" + errors.trim() : ""}`)),
    );
  });
  died.catch(() => {});
  try {
    await Promise.race([engine.init(60_000), died]);
  } catch (err) {
    proc.kill();
    const detail = errors.trim();
    if (err instanceof Error && detail && !err.message.includes(detail)) err.message += "\n" + detail;
    throw err;
  }
  return { engine, proc };
}

type Generated = {
  kind: "bot";
  source: "generated";
  white_id: null;
  black_id: null;
  white_name: string;
  black_name: string;
  bot_elo: null;
  control: Control;
  cards: true;
  steps: CardReferee["steps"];
  hand: CardId[];
  card_log: { ply: number; side: Side; card: CardId; picks: string[]; squares: string[] }[];
  clocks: number[];
  result: string;
  winner: Side | "draw";
  plies: number;
  meta: { white_elo: number; black_elo: number; seed: number; generator: 1; think: number; seconds: number };
};

function humanThink(myMs: number, incMs: number, ply: number, random: () => number) {
  const movesLeft = Math.max(15, 40 - ply / 4);
  let budget = myMs / movesLeft + incMs * 0.8;
  if (ply < 12) budget *= 0.3;
  else if (ply < 24) budget *= 0.8;
  const u = Math.max(1e-9, random());
  const spread = Math.exp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()) * 0.55);
  let ms = budget * spread;
  if (random() < 0.04 && myMs > 120_000) ms *= 3;
  if (myMs < 30_000) ms = Math.min(ms, 1500 + random() * 1500);
  return Math.round(Math.max(400, Math.min(ms, myMs * 0.3)));
}

function level(random: () => number) {
  const r = (random() + random() + random()) / 3;
  return Math.round((800 + r * 1800) / 50) * 50;
}

async function playGame(engine: UciEngine, seed: number): Promise<Generated> {
  const random = seeded(seed);
  const started = Date.now();
  const control = CONTROLS[Math.floor(random() * CONTROLS.length)];
  const category = categoryOf(control);
  const elo = { w: level(random), b: level(random) };
  const hand = dealHand((n) => Math.floor(random() * n));
  const ref = new CardReferee(control, hand, true);
  engine.newGame();

  let base = START_FEN;
  let since: string[] = [];
  const losing = { w: 0, b: 0 };
  let quiet = 0;
  let result: string | null = null;

  while (!result) {
    const side = ref.turn;
    const clock = ref.clock!;
    const fast = ref.mods[side].rate > 1 && ref.mods[side].extra > 0 ? 2 : 1;
    const time = thinkTime(clock[side] / fast, control.increment * 1000, ref.ply, random);

    let forced: string | undefined;
    const playable = ref.playable(side);
    if (playable.length) {
      const choice = await chooseCard({
        engine,
        elo: elo[side],
        side,
        fen: ref.chess.fen(),
        ply: ref.ply,
        cards: ref.cards,
        playable,
        category,
        mine: clock[side],
        theirs: clock[other(side)],
        shielded: ref.shieldedSquare(),
        random,
      });
      if (choice) {
        try {
          ref.playCard(side, choice.card, choice.picks);
          forced = choice.move;
          if (CARDS[choice.card].kind === "board" && choice.card !== "shield") {
            base = ref.chess.fen();
            since = [];
          }
        } catch {
        }
      }
    }

    const legal = ref.legalMoves();
    let move = forced && legal.includes(forced) ? forced : null;
    let score: number | null = null;
    if (!move) {
      const choice = await chooseMove({
        engine,
        elo: elo[side],
        fen: base,
        moves: since,
        legal,
        movetime: Math.min(time.search, THINK),
        random,
        threats: { cards: ref.cards, plyAfter: ref.ply + 1 },
      });
      move = choice?.move ?? legal[0];
      score = choice?.score ?? null;
    }

    if (ref.spend(side, humanThink(clock[side] / fast, control.increment * 1000, ref.ply, random))) {
      result = `${NAME[other(side)]} wins on time`;
      break;
    }
    ref.move(move);
    since.push(move);
    result = ref.boardResult();
    if (result) break;

    if (score !== null) {
      losing[side] = score <= -700 ? losing[side] + 1 : 0;
      quiet = Math.abs(score) < 40 ? quiet + 1 : 0;
    }
    if (losing[side] >= 3 && ref.ply > 30) result = `${NAME[other(side)]} wins by resignation`;
    else if (quiet >= 16 && ref.ply >= 80) result = "Draw by agreement";
    else if (ref.ply >= 400) result = "Draw by agreement";
  }

  const winner: Side | "draw" = result.startsWith("White") ? "w" : result.startsWith("Black") ? "b" : "draw";
  return {
    kind: "bot",
    source: "generated",
    white_id: null,
    black_id: null,
    white_name: `Shatranj Bot · ${elo.w}`,
    black_name: `Shatranj Bot · ${elo.b}`,
    bot_elo: null,
    control,
    cards: true,
    steps: ref.steps,
    hand,
    card_log: ref.cards.log.map((c) => ({ ply: c.ply, side: c.side, card: c.card, picks: c.picks ?? [], squares: c.squares })),
    clocks: ref.trail,
    result,
    winner,
    plies: ref.ply,
    meta: { white_elo: elo.w, black_elo: elo.b, seed, generator: 1, think: THINK, seconds: Math.round((Date.now() - started) / 1000) },
  };
}

function check(game: Generated): string | null {
  if (game.plies < 2) return "too short";
  return replayCardGame(game.control, game.hand, game.card_log, game.steps);
}

async function upload(rows: Generated[]) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are needed in server/.env to upload.");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/games`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

async function uploadFile(file: string) {
  const rows = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Generated);
  let bad = 0;
  const good = rows.filter((g) => (check(g) ? (bad++, false) : true));
  for (let i = 0; i < good.length; i += 50) {
    await upload(good.slice(i, i + 50));
    process.stdout.write(`\rUploaded ${Math.min(i + 50, good.length)} / ${good.length}`);
  }
  console.log(`\nDone. ${good.length} games uploaded${bad ? `, ${bad} skipped (didn't replay)` : ""}.`);
}

async function main() {
  loadEnv();
  const only = option("upload-file");
  if (only && only !== "true") {
    await uploadFile(resolve(only));
    return;
  }
  console.log(`Generating ${GAMES} card games with ${JOBS} engine(s), seeds from ${SEED}.`);
  console.log(`Writing to ${OUT}${UPLOAD ? " and uploading to Supabase" : ""}.`);
  let next = 0;
  let done = 0;
  let failed = 0;
  const began = Date.now();
  const pending: Generated[] = [];

  async function flush(force = false) {
    if (!UPLOAD || (!force && pending.length < 20) || !pending.length) return;
    const batch = pending.splice(0, pending.length);
    await upload(batch);
  }

  async function worker() {
    const { engine, proc } = await startEngine();
    try {
      while (next < GAMES) {
        const n = next++;
        const seed = SEED + n;
        try {
          const game = await playGame(engine, seed);
          const wrong = check(game);
          if (wrong) {
            failed++;
            console.log(`  game ${n + 1}: skipped, it doesn't replay (${wrong})`);
            continue;
          }
          appendFileSync(OUT, JSON.stringify(game) + "\n");
          pending.push(game);
          await flush();
          done++;
          const left = ((Date.now() - began) / done) * (GAMES - done - failed);
          console.log(
            `[${done}/${GAMES}] ${game.meta.white_elo} vs ${game.meta.black_elo}, ${control(game.control)}: ${game.result}` +
              ` (${Math.ceil(game.plies / 2)} moves, ${game.card_log.length} cards, ${game.meta.seconds} s)` +
              `  ~${Math.round(left / 60000)} min left`
          );
        } catch (err) {
          failed++;
          console.log(`  game ${n + 1}: failed (${(err as Error).message})`);
        }
      }
    } finally {
      proc.kill();
    }
  }

  await Promise.all(Array.from({ length: JOBS }, worker));
  await flush(true);
  console.log(`\nDone: ${done} games in ${Math.round((Date.now() - began) / 60000)} min${failed ? `, ${failed} skipped` : ""}. File: ${OUT}`);
}

function control(c: Control) {
  return `${c.initial / 60}+${c.increment}`;
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});