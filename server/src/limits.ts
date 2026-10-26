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

export class IpGuard {
  private counts = new Map<string, { start: number; current: number; previous: number }>();
  private bans = new Map<string, number>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    readonly banMs: number,
    private now: () => number = () => Date.now()
  ) {}

  bannedFor(ip: string) {
    const until = this.bans.get(ip);
    if (!until) return 0;
    const left = until - this.now();
    if (left <= 0) {
      this.bans.delete(ip);
      return 0;
    }
    return left;
  }

  hit(ip: string): number {
    if (this.bannedFor(ip) > 0) return -1;
    const t = this.now();
    let c = this.counts.get(ip);
    if (!c) {
      if (this.counts.size > 100_000) this.sweep();
      c = { start: t, current: 0, previous: 0 };
      this.counts.set(ip, c);
    }
    const passed = Math.floor((t - c.start) / this.windowMs);
    if (passed >= 1) {
      c.previous = passed === 1 ? c.current : 0;
      c.current = 0;
      c.start += passed * this.windowMs;
    }
    c.current += 1;
    const weight = 1 - (t - c.start) / this.windowMs;
    const used = c.previous * weight + c.current;
    if (used > this.max) {
      this.bans.set(ip, t + this.banMs);
      this.counts.delete(ip);
      return -2;
    }
    return Math.max(0, Math.floor(this.max - used));
  }

  sweep() {
    const t = this.now();
    for (const [ip, c] of this.counts) if (t - c.start > 2 * this.windowMs) this.counts.delete(ip);
    for (const [ip, until] of this.bans) if (until <= t) this.bans.delete(ip);
  }

  get banned() {
    return this.bans.size;
  }
}

export const IP_WINDOW = {
  windowMs: Number(process.env.RATE_WINDOW_MS) || 60_000,
  maxRequests: Number(process.env.RATE_MAX) || 600,
  maxMessages: Number(process.env.MSG_RATE_MAX) || 3000,
  banMs: Number(process.env.BAN_MS) || 10 * 60_000,
};