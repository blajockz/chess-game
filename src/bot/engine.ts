import { UciEngine } from "./uci";

export const ENGINE_URL = "/engine/stockfish-19-lite-single.js";

let loading: Promise<UciEngine> | null = null;

export function loadEngine(): Promise<UciEngine> {
  if (loading) return loading;
  loading = new Promise<UciEngine>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(ENGINE_URL);
    } catch (err) {
      reject(err);
      return;
    }
    const engine = new UciEngine({
      post: (command) => worker.postMessage(command),
      listen: (onLine) => {
        worker.onmessage = (e: MessageEvent) => {
          for (const line of String(e.data).split("\n")) if (line) onLine(line.trim());
        };
      },
    });
    worker.onerror = (e) => {
      e.preventDefault();
      reject(new Error("The chess engine couldn't load."));
    };
    engine.init().then(() => resolve(engine), reject);
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
