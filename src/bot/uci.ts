export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const MATE = 100_000;

export type Line = { move: string; score: number; depth: number; pv: string[] };
export type SearchResult = { best: string | null; lines: Line[] };

export type SearchOptions = {
  fen: string;
  moves?: string[];
  depth?: number;
  movetime?: number;
  multipv?: number;
  searchmoves?: string[];
  elo?: number | null;
};

export interface Analyser {
  search(options: SearchOptions): Promise<SearchResult>;
  newGame(): void;
  cancel(): void;
}

export type Port = {
  post(command: string): void;
  listen(onLine: (line: string) => void): void;
};

export function toScore(kind: string, value: number) {
  if (kind === "mate") return value > 0 ? MATE - value : -MATE - value;
  return value;
}

export function parseInfo(line: string) {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return null;
  const words = line.split(" ");
  let depth = 0;
  let multipv = 1;
  let score: number | null = null;
  let pv: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === "depth") depth = Number(words[++i]);
    else if (w === "multipv") multipv = Number(words[++i]);
    else if (w === "score") {
      const kind = words[++i];
      score = toScore(kind, Number(words[++i]));
      if (words[i + 1] === "lowerbound" || words[i + 1] === "upperbound") return null;
    } else if (w === "pv") {
      pv = words.slice(i + 1);
      break;
    }
  }
  if (score === null || !pv.length) return null;
  return { depth, multipv, score, pv };
}

const ENGINE_ELO_MIN = 1320;
const ENGINE_ELO_MAX = 3190;

export class UciEngine implements Analyser {
  private chain: Promise<unknown> = Promise.resolve();
  private onLine: ((line: string) => void) | null = null;
  private generation = 0;
  private busy = false;
  private set = { multipv: 1, limit: false, elo: ENGINE_ELO_MIN };

  private port: Port;

  constructor(port: Port) {
    this.port = port;
    port.listen((line) => this.onLine?.(line));
  }

  init(timeoutMs = 20_000) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The chess engine didn't start.")), timeoutMs);
      this.onLine = (line) => {
        if (line === "uciok") {
          this.port.post("setoption name Hash value 16");
          this.port.post("isready");
        } else if (line === "readyok") {
          clearTimeout(timer);
          this.onLine = null;
          resolve();
        }
      };
      this.port.post("uci");
    });
  }

  newGame() {
    this.chain = this.chain.then(() => {
      this.port.post("ucinewgame");
    });
  }

  cancel() {
    this.generation++;
    if (this.busy) this.port.post("stop");
  }

  search(options: SearchOptions): Promise<SearchResult> {
    const generation = this.generation;
    const run = this.chain.then(() =>
      generation === this.generation ? this.run(options) : { best: null, lines: [] }
    );
    this.chain = run.catch(() => undefined);
    return run;
  }

  private option(name: string, value: string | number | boolean) {
    this.port.post(`setoption name ${name} value ${value}`);
  }

  private run(o: SearchOptions): Promise<SearchResult> {
    const multipv = Math.max(1, Math.min(64, Math.round(o.multipv ?? 1)));
    if (multipv !== this.set.multipv) {
      this.option("MultiPV", multipv);
      this.set.multipv = multipv;
    }
    const limit = o.elo !== undefined && o.elo !== null;
    if (limit !== this.set.limit) {
      this.option("UCI_LimitStrength", limit);
      this.set.limit = limit;
    }
    if (limit) {
      const elo = Math.max(ENGINE_ELO_MIN, Math.min(ENGINE_ELO_MAX, Math.round(o.elo!)));
      if (elo !== this.set.elo) {
        this.option("UCI_Elo", elo);
        this.set.elo = elo;
      }
    }
    const moves = o.moves?.length ? ` moves ${o.moves.join(" ")}` : "";
    this.port.post(`position fen ${o.fen}${moves}`);

    let go = "go";
    if (o.depth) go += ` depth ${Math.max(1, Math.round(o.depth))}`;
    if (o.movetime) go += ` movetime ${Math.max(10, Math.round(o.movetime))}`;
    if (!o.depth && !o.movetime) go += " depth 10";
    if (o.searchmoves?.length) go += ` searchmoves ${o.searchmoves.join(" ")}`;

    return new Promise((resolve) => {
      const byRank = new Map<number, Line>();
      const guard = setTimeout(() => this.port.post("stop"), (o.movetime ?? 4000) + 6000);
      this.busy = true;
      this.onLine = (line) => {
        const info = parseInfo(line);
        if (info) {
          const known = byRank.get(info.multipv);
          if (!known || info.depth >= known.depth) {
            byRank.set(info.multipv, { move: info.pv[0], score: info.score, depth: info.depth, pv: info.pv });
          }
          return;
        }
        if (line.startsWith("bestmove")) {
          clearTimeout(guard);
          this.busy = false;
          this.onLine = null;
          const best = line.split(" ")[1];
          const lines = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
          resolve({ best: best && best !== "(none)" ? best : null, lines });
        }
      };
      this.port.post(go);
    });
  }
}