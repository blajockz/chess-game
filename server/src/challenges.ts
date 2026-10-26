import { createHash, randomBytes } from "node:crypto";
import { leadingZeroBits, powInput } from "../../shared/pow.js";

const BASE_BITS = Number(process.env.POW_BITS ?? 16);
const MAX_EXTRA = 5;
const TTL_MS = 2 * 60 * 1000;
const FREE_REQUESTS = 20;
const DECAY_MS = 10 * 1000;

export type Challenge = { id: string; bits: number; issuedAt: number };

export class ProofOfWork {
  private recent = new Map<string, { count: number; last: number }>();

  constructor(private now: () => number = () => Date.now()) {}

  private load(ip: string) {
    const r = this.recent.get(ip);
    if (!r) return 0;
    const t = this.now();
    const count = Math.max(0, r.count - (t - r.last) / DECAY_MS);
    r.count = count;
    r.last = t;
    return count;
  }

  bits(ip: string) {
    if (BASE_BITS <= 0) return 0;
    const extra = Math.max(0, Math.floor(this.load(ip)) - FREE_REQUESTS + 1);
    return BASE_BITS + Math.min(MAX_EXTRA, extra);
  }

  issue(ip: string): Challenge {
    return { id: randomBytes(16).toString("hex"), bits: this.bits(ip), issuedAt: this.now() };
  }

  check(challenge: Challenge | null, nonce: string | undefined, ip: string) {
    if (!challenge || nonce === undefined) return false;
    if (this.now() - challenge.issuedAt > TTL_MS) return false;
    const hash = createHash("sha256").update(powInput(challenge.id, nonce)).digest();
    const words = [hash.readUInt32BE(0), hash.readUInt32BE(4), hash.readUInt32BE(8), hash.readUInt32BE(12)];
    if (leadingZeroBits(words) < challenge.bits) return false;
    const r = this.recent.get(ip);
    this.load(ip);
    this.recent.set(ip, { count: (r?.count ?? 0) + 1, last: this.now() });
    return true;
  }

  sweep() {
    for (const ip of [...this.recent.keys()]) if (this.load(ip) <= 0) this.recent.delete(ip);
  }
}
