import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { clientAddress } from "./security.js";

export type BlockReason = "tor" | "vpn" | "datacenter" | "unknown";

const BLOCK = new Set(
  (process.env.IP_BLOCK ?? "tor,vpn,datacenter,unknown")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const HOUR = 60 * 60 * 1000;

type Source = { url: string; every: number; csv?: boolean };
const SOURCES: Record<"tor" | "vpn" | "datacenter" | "relay", Source> = {
  tor: { url: process.env.TOR_LIST_URL || "https://check.torproject.org/torbulkexitlist", every: 6 * HOUR },
  vpn: {
    url: process.env.VPN_LIST_URL || "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt",
    every: 24 * HOUR,
  },
  datacenter: {
    url: process.env.DATACENTER_LIST_URL || "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt",
    every: 24 * HOUR,
  },
  relay: { url: process.env.RELAY_LIST_URL || "https://mask-api.icloud.com/egress-ip-ranges.csv", every: 24 * HOUR, csv: true },
};

const V4_BASE = 0xffff00000000n;

function v4ToBig(ip: string) {
  const p = ip.split(".").map(Number);
  return V4_BASE + BigInt(((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]);
}

function v6ToBig(ip: string) {
  let text = ip.toLowerCase();
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ToBig(v4[1]) - V4_BASE;
    text = text.slice(0, -v4[1].length) + (n >> 16n).toString(16) + ":" + (n & 0xffffn).toString(16);
  }
  const [head, tail = ""] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = text.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
}

export function toBig(ip: string): bigint | null {
  const kind = isIP(ip);
  if (kind === 4) return v4ToBig(ip);
  if (kind === 6) return v6ToBig(ip);
  return null;
}

function rangeOf(entry: string): [bigint, bigint] | null {
  const [addr, bitsText] = entry.split("/");
  const start = toBig(addr);
  if (start === null) return null;
  const v4 = isIP(addr) === 4;
  const total = v4 ? 32 : 128;
  const bits = bitsText === undefined ? total : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > total) return null;
  const size = 1n << BigInt(total - bits);
  const first = start - (v4 ? (start - V4_BASE) % size : start % size);
  return [first, first + size - 1n];
}

export class RangeSet {
  private starts: bigint[] = [];
  private ends: bigint[] = [];
  entries = 0;

  static parse(text: string, csv = false) {
    const ranges: [bigint, bigint][] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = (csv ? raw.split(",")[0] : raw.split(/[\s#]/)[0]).trim();
      if (!line) continue;
      const r = rangeOf(line);
      if (r) ranges.push(r);
    }
    ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const set = new RangeSet();
    set.entries = ranges.length;
    for (const [s, e] of ranges) {
      const last = set.ends.length - 1;
      if (last >= 0 && s <= set.ends[last] + 1n) {
        if (e > set.ends[last]) set.ends[last] = e;
      } else {
        set.starts.push(s);
        set.ends.push(e);
      }
    }
    return set;
  }

  get size() {
    return this.starts.length;
  }

  has(n: bigint) {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (n < this.starts[mid]) hi = mid - 1;
      else if (n > this.ends[mid]) lo = mid + 1;
      else return true;
    }
    return false;
  }
}

type Loaded = { set: RangeSet; at: number } | null;
const lists: Record<keyof typeof SOURCES, Loaded> = { tor: null, vpn: null, datacenter: null, relay: null };

const ALLOWED = RangeSet.parse((process.env.ALLOW_IPS ?? "").split(",").join("\n"));

async function download(src: Source) {
  if (src.url.startsWith("/")) return readFile(src.url, "utf8");
  const res = await fetch(src.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 60 * 1024 * 1024) throw new Error("list too large");
  return text;
}

async function refresh(name: keyof typeof SOURCES) {
  const src = SOURCES[name];
  try {
    const set = RangeSet.parse(await download(src), src.csv);
    if (set.entries < 10 && name !== "relay") throw new Error(`only ${set.entries} entries`);
    lists[name] = { set, at: Date.now() };
    console.log(`IP list "${name}": ${set.entries} entries (${set.size} ranges)`);
  } catch (err) {
    console.warn(`Couldn't update the "${name}" IP list (${(err as Error).message}). ${lists[name] ? "Keeping the previous one." : "Not blocking this kind until it loads."}`);
  }
}

const needed = (["tor", "vpn", "datacenter"] as const).filter((k) => BLOCK.has(k));
if (needed.length) {
  const all = [...needed, ...(needed.includes("datacenter") ? (["relay"] as const) : [])];
  for (const name of all) {
    void refresh(name);
    setInterval(() => void refresh(name), SOURCES[name].every).unref();
  }
}

const recent = { since: Date.now(), known: 0, unknown: 0 };
let warnedAt = 0;

function unknownLooksLikeSetupProblem() {
  if (Date.now() - recent.since > 5 * 60_000) {
    recent.since = Date.now();
    recent.known = 0;
    recent.unknown = 0;
  }
  const total = recent.known + recent.unknown;
  const broken = total >= 30 && recent.unknown / total > 0.5;
  if (broken && Date.now() - warnedAt > 10 * 60_000) {
    warnedAt = Date.now();
    console.error(
      "Most visitors' addresses can't be read: the proxy header looks misconfigured. " +
        "Unknown addresses are NOT blocked until this is fixed (check /health with IP_DEBUG=1)."
    );
  }
  return broken;
}

export function blockReason(req: IncomingMessage): BlockReason | null {
  const address = clientAddress(req);
  if (address === "unknown") {
    recent.unknown++;
    if (!BLOCK.has("unknown") || unknownLooksLikeSetupProblem()) return null;
    return "unknown";
  }
  recent.known++;
  const n = toBig(address);
  if (n === null || ALLOWED.has(n)) return null;
  if (BLOCK.has("tor") && lists.tor?.set.has(n)) return "tor";
  if (BLOCK.has("vpn") && lists.vpn?.set.has(n)) return "vpn";
  if (BLOCK.has("datacenter") && lists.datacenter?.set.has(n) && !lists.relay?.set.has(n)) return "datacenter";
  return null;
}

export function ipFilterStatus() {
  const info: Record<string, unknown> = { blocking: [...BLOCK] };
  for (const [name, l] of Object.entries(lists)) info[name] = l ? { ranges: l.set.size, updated: new Date(l.at).toISOString() } : null;
  return info;
}
