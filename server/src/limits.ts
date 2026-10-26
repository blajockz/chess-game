type Bucket = { tokens: number; last: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private capacity: number,
    private perSecond: number,
    private now: () => number = () => Date.now()
  ) {}

  take(key: string): boolean {
    if (this.buckets.size > 50_000) this.sweep();
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.last) / 1000) * this.perSecond);
    b.last = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }

  sweep() {
    const t = this.now();
    for (const [key, b] of this.buckets) {
      const tokens = b.tokens + ((t - b.last) / 1000) * this.perSecond;
      if (tokens >= this.capacity) this.buckets.delete(key);
    }
  }

  get size() {
    return this.buckets.size;
  }
}

export const LIMITS = {
  connectionsPerIp: 60,
  messages: { capacity: 20, perSecond: 10 },
  creates: { capacity: 20, perSecond: 1 / 3 },
  joins: { capacity: 30, perSecond: 1 / 2 },
  strikesBeforeKick: 30,
  upgrades: { capacity: 60, perSecond: 2 },
  http: { capacity: 300, perSecond: 50 },
  maxConnections: 2000,
  maxRooms: 3000,
  waitingPerIp: 20,
} as const;