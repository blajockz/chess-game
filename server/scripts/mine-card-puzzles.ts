import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { MATE, UciEngine } from "../../src/bot/uci";
import { optionsFor, shieldPlans, turnsOf, type Turn } from "../../src/review/cardTurns";
import { CARDS, type CardId } from "../../shared/cards";
import { cardStepText, puzzleProblem } from "../../shared/cardPuzzle";

const HERE = dirname(fileURLToPath(import.meta.url));
type Side = "w" | "b";

function option(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

const IN = resolve(option("in", "generated-card-games.jsonl")!);
const OUT = resolve(option("out", "card-puzzles.jsonl")!);
const JOBS = Math.max(1, Math.min(16, Number(option("jobs", "2"))));
const LIMIT = Number(option("limit", "0")) || Infinity;
const UPLOAD = option("upload") === "true";
const ENGINE = resolve(option("engine", join(HERE, "..", "..", "public", "engine", "stockfish-19-lite-single.js"))!);

const LOOK = 12;
const SCREEN = 8;
const DEEP = 16;
const LINE = 14;
const ALREADY_WINNING = 75;
const GAIN = 25;
const REACH = 62;
const GAP = 15;
const MAX_SOLVER_MOVES = 3;

function loadEnv() {
  const file = join(HERE, "..", ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

let runnable: string | null = null;
function runnableEngine() {
  if (runnable) return runnable;
  if (!existsSync(ENGINE)) throw new Error(`The chess engine was not found: ${ENGINE} (use --engine <file>)`);
  const name = basename(ENGINE, extname(ENGINE));
  const wasm = join(dirname(ENGINE), name + ".wasm");
  if (!existsSync(wasm)) throw new Error(`The engine's .wasm file was not found: ${wasm}`);
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
    proc.once("exit", (code) => reject(new Error(`The chess engine stopped (exit code ${code}).${errors ? "\n" + errors.trim() : ""}`)));
  });
  died.catch(() => {});
  await Promise.race([engine.init(60_000), died]);
  return { engine, proc };
}

function chance(score: number) {
  const cp = Math.abs(score) > MATE - 1000 ? Math.sign(score) * 1500 : Math.max(-1500, Math.min(1500, score));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
const isMate = (score: number) => Math.abs(score) > MATE - 1000;

type Game = {
  control: { initial: number; increment: number; blackInitial?: number };
  steps: ({ t: "move"; san: string } | { t: "card"; fen: string })[];
  hand: CardId[];
  card_log: { ply: number; side: Side; card: CardId; picks: string[] }[];
};

type Puzzle = {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  rating_dev: number;
  popularity: number;
  plays: number;
  themes: string[];
  opening: string;
  game_url: string;
  mode: "cards";
  cards: { hand: CardId[] };
};

type Candidate = {
  step: string;
  card: CardId;
  fen: string;
  restricted: string[] | null;
  solverToMove: boolean;
  move: string | null;
  win: number;
};

function idOf(fen: string, moves: string) {
  const text = fen + "|" + moves;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return ("c" + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}

function estimate(solverMoves: number, hand: number, choices: number, quiet: boolean, card: CardId, mate: boolean) {
  let rating = 1050 + (solverMoves - 1) * 220 + (hand - 1) * 60 + Math.min(160, choices * 9);
  if (quiet) rating += 160;
  if (card === "shield") rating += 60;
  if (card === "swap" || card === "retreat") rating += 80;
  if (mate && solverMoves === 1) rating -= 120;
  return Math.max(700, Math.min(2300, Math.round(rating / 5) * 5));
}

async function minePosition(engine: UciEngine, turn: Turn, setup: { fen: string; uci: string }, hand: CardId[]): Promise<Puzzle | null> {
  const side = turn.side;
  const fen = turn.startFen;
  const ask = async (at: string, depth: number, multipv: number, restricted: string[] | null) =>
    (await engine.search({ fen: at, depth, multipv, searchmoves: restricted ?? undefined })).lines;

  const first = (await ask(fen, LOOK, 1, null))[0];
  if (!first) return null;
  if (chance(first.score) > ALREADY_WINNING) return null;

  const candidates: Candidate[] = [];
  const boardCards = turn.playable.filter((c) => c === "leap" || c === "swap" || c === "retreat");
  for (const o of optionsFor(boardCards, fen, side, null)) {
    candidates.push({ step: cardStepText(o.card, o.picks), card: o.card, fen: o.fen, restricted: null, solverToMove: true, move: null, win: 0 });
  }
  if (turn.playable.includes("shield")) {
    for (const p of shieldPlans(fen, side, [], null)) {
      if (p.from !== p.square) continue;
      candidates.push({ step: cardStepText("shield", [p.square]), card: "shield", fen: p.fen, restricted: p.restricted, solverToMove: false, move: p.move, win: 0 });
    }
  }
  if (!candidates.length) return null;

  const winOf = (c: Candidate, score: number) => (c.solverToMove ? chance(score) : 100 - chance(score));
  for (const c of candidates) {
    const line = (await ask(c.fen, SCREEN, 1, c.restricted))[0];
    c.win = line ? winOf(c, line.score) : 0;
  }
  candidates.sort((a, b) => b.win - a.win);
  if (candidates[0].win < chance(first.score) + GAIN - 5) return null;

  const base = (await ask(fen, DEEP, 1, null))[0];
  if (!base || chance(base.score) > ALREADY_WINNING) return null;
  const baseWin = chance(base.score);
  const deep: { c: Candidate; win: number; score: number; pv: string[]; secondWin: number | null }[] = [];
  for (const c of candidates.slice(0, 3)) {
    const lines = await ask(c.fen, DEEP, c.solverToMove ? 2 : 1, c.restricted);
    if (!lines[0]) continue;
    deep.push({
      c,
      win: winOf(c, lines[0].score),
      score: c.solverToMove ? lines[0].score : -lines[0].score,
      pv: lines[0].pv,
      secondWin: c.solverToMove && lines[1] ? chance(lines[1].score) : null,
    });
  }
  deep.sort((a, b) => b.win - a.win);
  const best = deep[0];
  if (!best) return null;
  const others = Math.max(baseWin, deep[1]?.win ?? 0, candidates[3]?.win ?? 0);
  if (best.win < REACH || best.win - baseWin < GAIN || best.win - others < GAP) return null;
  if (best.c.solverToMove && best.secondWin !== null && best.win - best.secondWin < GAP) return null;

  const steps = [setup.uci, best.c.step];
  let chess: Chess;
  let restricted: string[] | null;
  if (best.c.solverToMove) {
    chess = new Chess(best.c.fen);
    const m = best.pv[0];
    if (!m) return null;
    chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    steps.push(m);
    restricted = null;
  } else {
    chess = new Chess(best.c.fen);
    steps.push(best.c.move!);
    restricted = best.c.restricted;
  }
  const firstMove = steps[2];
  let solverMoves = 1;
  let lastScore = best.score;
  while (solverMoves < MAX_SOLVER_MOVES && !chess.isGameOver()) {
    const reply = (await ask(chess.fen(), LINE, 1, restricted))[0];
    restricted = null;
    if (!reply) break;
    const after = new Chess(chess.fen());
    after.move({ from: reply.move.slice(0, 2), to: reply.move.slice(2, 4), promotion: reply.move[4] });
    if (after.isGameOver()) break;
    const next = await ask(after.fen(), LINE, 2, null);
    if (!next[0]) break;
    const forced = !next[1] || chance(next[0].score) - chance(next[1].score) >= GAP;
    if (!forced || chance(next[0].score) < REACH) break;
    steps.push(reply.move, next[0].move);
    chess = after;
    chess.move({ from: next[0].move.slice(0, 2), to: next[0].move.slice(2, 4), promotion: next[0].move[4] });
    lastScore = next[0].score;
    solverMoves++;
  }

  if (puzzleProblem(setup.fen, steps)) return null;
  const mate = chess.isCheckmate() || (isMate(lastScore) && lastScore > 0);
  const firstSan = (() => {
    const c = best.c.solverToMove ? new Chess(best.c.fen) : new Chess(fen);
    try {
      return c.move({ from: firstMove.slice(0, 2), to: firstMove.slice(2, 4), promotion: firstMove[4] }).san;
    } catch {
      return "";
    }
  })();
  const quiet = !/[x+#]/.test(firstSan);
  const themes = [best.c.card, mate ? "mate" : best.win >= 90 ? "crushing" : "advantage", solverMoves === 1 ? "oneMove" : solverMoves === 2 ? "short" : "long"];
  if (baseWin < 30) themes.push("defensiveMove");
  const shown = hand.filter((c) => turn.playable.includes(c) && CARDS[c].kind === "board");
  const moves = steps.join(" ");
  return {
    id: idOf(setup.fen, moves),
    fen: setup.fen,
    moves,
    rating: estimate(solverMoves, shown.length, candidates.length, quiet, best.c.card, mate),
    rating_dev: 150,
    popularity: 0,
    plays: 0,
    themes,
    opening: "",
    game_url: "",
    mode: "cards",
    cards: { hand: shown },
  };
}

async function mineGame(engine: UciEngine, game: Game): Promise<Puzzle[]> {
  const cardGame = turnsOf({ steps: game.steps, control: game.control, cards: true, hand: game.hand, cardLog: game.card_log } as never);
  if (!cardGame.known) return [];
  engine.newGame();
  const found: Puzzle[] = [];
  const lastCard: Partial<Record<Side, { at: number; card: CardId }>> = {};
  for (let i = 1; i < cardGame.turns.length; i++) {
    const turn = cardGame.turns[i];
    if (!turn.playable.some((c) => CARDS[c].kind === "board") || turn.shielded) continue;
    if (cardGame.turns[i - 1].card?.card === "shield" || cardGame.turns[i - 1].shielded) continue;
    const prev = cardGame.plies[i - 1];
    const puzzle = await minePosition(engine, turn, { fen: prev.before, uci: prev.uci }, game.hand);
    if (!puzzle) continue;
    const card = puzzle.themes[0] as CardId;
    const before = lastCard[turn.side];
    lastCard[turn.side] = { at: i, card };
    if (before && before.card === card && i - before.at <= 2) continue;
    found.push(puzzle);
  }
  return found;
}

async function upload(rows: Puzzle[]) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are needed in server/.env to upload.");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/puzzles?on_conflict=id`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Upload failed (${res.status}): ${text}${/cards/.test(text) ? "\nRun supabase/010_card_puzzles.sql first." : ""}`);
  }
}

async function uploadAll(rows: Puzzle[]) {
  const good = rows.filter((p) => !puzzleProblem(p.fen, p.moves.split(" ")));
  for (let i = 0; i < good.length; i += 100) {
    await upload(good.slice(i, i + 100));
    process.stdout.write(`\rUploaded ${Math.min(i + 100, good.length)} / ${good.length}`);
  }
  console.log(`\nDone. ${good.length} puzzles uploaded${good.length < rows.length ? `, ${rows.length - good.length} skipped (broken)` : ""}.`);
}

const readLines = <T>(file: string) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);

async function main() {
  loadEnv();
  const only = option("upload-file");
  if (only && only !== "true") {
    await uploadAll(readLines<Puzzle>(resolve(only)));
    return;
  }
  if (!existsSync(IN)) throw new Error(`Games file not found: ${IN} (use --in <file>)`);
  const games = readLines<Game>(IN).slice(0, LIMIT);
  console.log(`Looking for card puzzles in ${games.length} games with ${JOBS} engine(s).`);
  console.log(`Writing to ${OUT}${UPLOAD ? ", then uploading to Supabase" : ""}.`);
  writeFileSync(OUT, "");
  const seen = new Set<string>();
  const all: Puzzle[] = [];
  let next = 0;
  let done = 0;
  let failed = 0;
  const started = Date.now();

  async function worker() {
    const { engine, proc } = await startEngine();
    try {
      while (next < games.length) {
        const game = games[next++];
        try {
          for (const puzzle of await mineGame(engine, game)) {
            if (seen.has(puzzle.id)) continue;
            seen.add(puzzle.id);
            all.push(puzzle);
            appendFileSync(OUT, JSON.stringify(puzzle) + "\n");
          }
        } catch (err) {
          failed++;
          if (failed <= 3) console.warn(`\nA game was skipped: ${(err as Error).message}`);
        }
        done++;
        const rate = (Date.now() - started) / 1000 / done;
        const left = Math.round(((games.length - done) * rate) / 60);
        process.stdout.write(`\r${done} / ${games.length} games · ${all.length} puzzles · about ${left} min left   `);
      }
    } finally {
      proc.kill();
    }
  }

  await Promise.all(Array.from({ length: Math.min(JOBS, games.length) }, worker));
  const byCard: Record<string, number> = {};
  for (const p of all) byCard[p.themes[0]] = (byCard[p.themes[0]] ?? 0) + 1;
  console.log(`\n${all.length} puzzles from ${games.length} games${failed ? ` (${failed} games skipped)` : ""}.`);
  console.log(
    Object.entries(byCard)
      .map(([card, n]) => `${CARDS[card as CardId].name}: ${n}`)
      .join(" · ")
  );
  if (UPLOAD && all.length) await uploadAll(all);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("\n" + (err instanceof Error ? err.message : err));
    process.exit(1);
  }
);
