import { useEffect, useRef, useState } from "react";

export type TimeControl = {
  initial: number;
  increment: number;
  blackInitial?: number;
};

export type Category = "Bullet" | "Blitz" | "Rapid" | "Classical";

export const BULLET_MAX = 179;

function estimate(seconds: number, increment: number) {
  return seconds + 40 * increment;
}

export function categoryOf({ initial, increment, blackInitial }: TimeControl): Category {
  const shortest = Math.min(initial, blackInitial ?? initial);
  const e = estimate(shortest, increment);
  if (e <= BULLET_MAX) return "Bullet";
  if (e < 600) return "Blitz";
  if (e < 1800) return "Rapid";
  return "Classical";
}

export function isBullet(tc: TimeControl) {
  return categoryOf(tc) === "Bullet";
}

function minutesLabel(seconds: number) {
  const m = seconds / 60;
  return Number.isInteger(m) ? `${m}` : `${seconds}s`;
}

export function controlLabel(seconds: number, increment: number) {
  return `${minutesLabel(seconds)}+${increment}`;
}

export function describeControl(tc: TimeControl) {
  const white = controlLabel(tc.initial, tc.increment);
  const handicap = tc.blackInitial !== undefined && tc.blackInitial !== tc.initial;
  const both = handicap
    ? `${white} vs ${controlLabel(tc.blackInitial!, tc.increment)}`
    : white;
  return `${both} ${categoryOf(tc)}`;
}

export function formatClock(ms: number) {
  const total = Math.max(0, ms);
  const seconds = total / 1000;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const pad = String(s).padStart(2, "0");

  if (seconds < 20) {
    const tenths = Math.floor((total % 1000) / 100);
    return `${m}:${pad}.${tenths}`;
  }
  return `${m}:${pad}`;
}

type Options = {
  control: TimeControl;
  turn: "w" | "b";
  ply: number;
  paused?: boolean;
  sync?: ClockSync | null;
};

export type ClockSync = {
  key: number;
  w: number;
  b: number;
  running: boolean;
  turn: "w" | "b";
  at: number;
};

export const CLOCK_FLOOR_MS = 10_000;

type Side = "w" | "b";

type Mods = {
  rate: number;
  extra: number;
  free: number;
};

const NO_MODS: Mods = { rate: 1, extra: 0, free: 0 };

export function useClocks({ control, turn, ply, paused = false, sync = null }: Options) {
  const ref = useRef({
    w: control.initial * 1000,
    b: (control.blackInitial ?? control.initial) * 1000,
    side: null as Side | null,
    at: 0,
    mods: { w: { ...NO_MODS }, b: { ...NO_MODS } },
  });

  const [flagged, setFlagged] = useState<Side | null>(null);
  const [, force] = useState(0);
  const prevPly = useRef(ply);
  const prevControl = useRef(control);

  const running = ply > 0 && !paused && flagged === null;

  function cost(side: Side, elapsed: number) {
    const r = ref.current;
    const m = r.mods[side];
    const freeUsed = Math.min(m.free, elapsed);
    const counted = elapsed - freeUsed;
    const extra =
      m.rate > 1
        ? Math.max(
            0,
            Math.min((m.rate - 1) * counted, m.extra, r[side] - counted - CLOCK_FLOOR_MS)
          )
        : 0;
    return { total: counted + extra, freeUsed, extra };
  }

  function settle() {
    const r = ref.current;
    if (!r.side) return;
    const side = r.side;
    const c = cost(side, performance.now() - r.at);
    r[side] = Math.max(0, r[side] - c.total);
    r.mods[side].free -= c.freeUsed;
    r.mods[side].extra -= c.extra;
    r.side = null;
  }

  function startSide(side: Side) {
    const r = ref.current;
    r.side = side;
    r.at = performance.now();
  }

  function rebase(change: () => void) {
    const was = ref.current.side;
    settle();
    change();
    if (was) startSide(was);
    force((n) => n + 1);
  }

  function adjust(side: Side, ms: number) {
    rebase(() => {
      ref.current[side] = Math.max(0, ref.current[side] + ms);
    });
  }

  function setMods(side: Side, mods: Partial<Mods>) {
    rebase(() => {
      ref.current.mods[side] = { ...ref.current.mods[side], ...mods };
    });
  }

  useEffect(() => {
    if (prevControl.current === control) return;
    prevControl.current = control;
    ref.current = {
      w: control.initial * 1000,
      b: (control.blackInitial ?? control.initial) * 1000,
      side: null,
      at: 0,
      mods: { w: { ...NO_MODS }, b: { ...NO_MODS } },
    };
    prevPly.current = ply;
    setFlagged(null);
    force((n) => n + 1);
  }, [control]);

  useEffect(() => {
    if (ply === prevPly.current) return;
    prevPly.current = ply;

    const mover = turn === "w" ? "b" : "w";
    settle();
    ref.current[mover] += control.increment * 1000;
    ref.current.mods[mover] = { ...NO_MODS };

    if (running) startSide(turn);
    force((n) => n + 1);
  }, [ply]);

  useEffect(() => {
    if (!sync) return;
    const r = ref.current;
    r.w = sync.w;
    r.b = sync.b;
    r.mods = { w: { ...NO_MODS }, b: { ...NO_MODS } };
    if (sync.running && running) {
      r.side = sync.turn;
      r.at = sync.at;
    } else {
      r.side = null;
    }
    force((n) => n + 1);
  }, [sync?.key]);

  useEffect(() => {
    if (running) {
      if (!ref.current.side) startSide(turn);
    } else {
      settle();
    }
    force((n) => n + 1);
  }, [running, turn]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [running]);

  const r = ref.current;
  const now = performance.now();
  const live = (side: Side) =>
    r.side === side ? Math.max(0, r[side] - cost(side, now - r.at).total) : r[side];

  const white = live("w");
  const black = live("b");

  if (flagged === null) {
    if (white <= 0) {
      settle();
      queueMicrotask(() => setFlagged("w"));
    } else if (black <= 0) {
      settle();
      queueMicrotask(() => setFlagged("b"));
    }
  }

  const modsOf = (side: Side) => r.mods[side];

  return {
    white,
    black,
    flagged,
    running,
    whiteLabel: formatClock(white),
    blackLabel: formatClock(black),
    whiteLow: white < 30000,
    blackLow: black < 30000,
    adjust,
    setMods,
    fast: (side: Side) => modsOf(side).rate > 1 && modsOf(side).extra > 0,
    frozenByCard: (side: Side) =>
      modsOf(side).free > 0 && (r.side !== side || now - r.at < modsOf(side).free),
  };
}