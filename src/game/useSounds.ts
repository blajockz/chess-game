import { useCallback, useEffect, useRef } from "react";

export type SoundName = "select" | "move" | "capture" | "castle" | "check" | "end" | "start";

type FilterSpec = {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  gain?: number;
};

type Layer = {
  amp: number;
  attack: number;
  decay: number;
  filters: FilterSpec[];
};

type HitSpec = {
  layers: Layer[];
  modes: [number, number, number][];
  sub: { freq: number; amp: number; decay: number } | null;
};

const D = (t30ms: number) => t30ms / 1000 / 0.375;

const CLIFF_MOVE: FilterSpec[] = [
  { type: "lowpass", freq: 1800 },
  { type: "lowpass", freq: 1800 },
  { type: "lowpass", freq: 1800 },
];

const CLIFF_CAPTURE: FilterSpec[] = [
  { type: "lowpass", freq: 1500 },
  { type: "lowpass", freq: 1500 },
  { type: "lowpass", freq: 1500 },
];

const BRIGHT: HitSpec = {
  layers: [
    {
      amp: 0.3,
      attack: 0.0006,
      decay: 0.009,
      filters: [{ type: "bandpass", freq: 1100, q: 0.8 }, ...CLIFF_MOVE],
    },
    {
      amp: 1.0,
      attack: 0.0012,
      decay: D(22),
      filters: [{ type: "bandpass", freq: 950, q: 0.6 }, ...CLIFF_MOVE],
    },
    {
      amp: 0.95,
      attack: 0.0012,
      decay: D(24),
      filters: [{ type: "bandpass", freq: 1280, q: 0.9 }, ...CLIFF_MOVE],
    },
    {
      amp: 0.26,
      attack: 0.0014,
      decay: D(28),
      filters: [
        { type: "bandpass", freq: 380, q: 0.8 },
        { type: "highpass", freq: 190, q: 0.7 },
      ],
    },
  ],
  modes: [
    [196, 0.003, D(93)],
    [340, 0.0045, D(83)],
    [448, 0.0095, D(73)],
    [601, 0.006, D(68)],
    [697, 0.008, D(63)],
    [932, 0.01, D(48)],
    [1093, 0.006, D(38)],
  ],
  sub: null,
};

const DARK: HitSpec = {
  layers: [
    {
      amp: 0.32,
      attack: 0.0006,
      decay: 0.011,
      filters: [{ type: "bandpass", freq: 900, q: 0.8 }, ...CLIFF_CAPTURE],
    },
    {
      amp: 1.0,
      attack: 0.0014,
      decay: D(34),
      filters: [{ type: "bandpass", freq: 720, q: 0.6 }, ...CLIFF_CAPTURE],
    },
    {
      amp: 0.85,
      attack: 0.0014,
      decay: D(36),
      filters: [{ type: "bandpass", freq: 1020, q: 0.9 }, ...CLIFF_CAPTURE],
    },
    {
      amp: 0.44,
      attack: 0.0016,
      decay: D(44),
      filters: [
        { type: "bandpass", freq: 290, q: 0.8 },
        { type: "highpass", freq: 130, q: 0.7 },
      ],
    },
  ],
  modes: [
    [168, 0.0045, D(130)],
    [292, 0.0065, D(118)],
    [384, 0.013, D(104)],
    [515, 0.0085, D(96)],
    [598, 0.011, D(90)],
    [800, 0.014, D(70)],
    [938, 0.008, D(55)],
  ],
  sub: { freq: 52.7, amp: 0.02, decay: 0.2 },
};

const BED_FILTERS: FilterSpec[] = [
  { type: "highpass", freq: 105, q: 0.7 },
  { type: "highpass", freq: 105, q: 0.7 },
  { type: "peaking", freq: 185, q: 1.0, gain: 6 },
  { type: "lowpass", freq: 400, q: 0.5 },
  { type: "lowpass", freq: 1500 },
  { type: "lowpass", freq: 1500 },
  { type: "lowpass", freq: 1500 },
];

const BED_LEVEL = 0;

export const SOUND_VERSION = "cc-2";

const REVERB_SECONDS = 0.25;
const REVERB_DAMP = 2400;
const REVERB_WET = 0.12;

const OUTPUT_GAIN = 2.4;

const START_URL = "";
const START_LEVEL = 0.85;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function loopNoiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const xf = Math.floor(ctx.sampleRate * 0.4);
  const raw = new Float32Array(n + xf);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.random() * 2 - 1;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = raw[i];
  for (let i = 0; i < xf; i++) {
    const w = i / xf;
    d[i] = raw[i] * w + raw[n + i] * (1 - w);
  }
  return buf;
}

function chain(ctx: BaseAudioContext, specs: FilterSpec[]) {
  const nodes = specs.map((s) => {
    const f = ctx.createBiquadFilter();
    f.type = s.type;
    f.frequency.value = s.freq;
    if (s.q !== undefined) f.Q.value = s.q;
    if (s.gain !== undefined) f.gain.value = s.gain;
    return f;
  });
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return { head: nodes[0], tail: nodes[nodes.length - 1] };
}

function makeReverb(ctx: BaseAudioContext, dest: AudioNode) {
  const n = Math.floor(ctx.sampleRate * REVERB_SECONDS);
  const imp = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = imp.getChannelData(c);
    for (let i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = imp;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = REVERB_DAMP;
  const wet = ctx.createGain();
  wet.gain.value = REVERB_WET;
  const send = ctx.createGain();
  send.gain.value = 1;
  send.connect(lp).connect(conv).connect(wet).connect(dest);
  return send;
}

function renderHit(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  spec: HitSpec,
  level: number,
  rate: number,
  send?: AudioNode | null
) {
  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(dest);
  if (send) out.connect(send);

  for (const layer of spec.layers) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, layer.decay + 0.02);

    const filters = chain(
      ctx,
      layer.filters.map((f) => ({ ...f, freq: f.freq * rate }))
    );

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(layer.amp, at + layer.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + layer.decay);

    src.connect(filters.head);
    filters.tail.connect(g).connect(out);
    src.start(at);
    src.stop(at + layer.decay + 0.03);
  }

  for (const [freq, amp, decay] of spec.modes) {
    const detune = 1 + (Math.random() * 2 - 1) * 0.025;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * rate * detune, at);
    osc.frequency.exponentialRampToValueAtTime(freq * rate * detune * 0.93, at + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp * (0.8 + Math.random() * 0.4), at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.03);
  }

  if (spec.sub) {
    const s = spec.sub;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(s.freq, at);
    osc.frequency.exponentialRampToValueAtTime(s.freq * 0.82, at + s.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(s.amp, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + s.decay);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + s.decay + 0.03);
  }

  return out;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bedSource: AudioBufferSourceNode | null = null;
  private startBuffer: AudioBuffer | null = null;
  private startError: string | null = null;
  private startPlayed = false;
  private reverb: AudioNode | null = null;
  private bedGain: GainNode | null = null;
  private enabled = true;
  private volume = 0.9;

  init() {
    if (this.ctx) return;

    const ctx = new AudioContext();

    const output = ctx.createGain();
    output.gain.value = OUTPUT_GAIN;
    output.connect(ctx.destination);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 4;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;
    limiter.connect(output);

    const master = ctx.createGain();
    master.gain.value = this.enabled ? this.volume : 0;
    master.connect(limiter);

    this.reverb = makeReverb(ctx, master);

    this.ctx = ctx;
    this.master = master;

    void this.loadStart();
  }

  private async loadStart() {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const res = await fetch(START_URL);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      this.startBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      this.startError = String(err);
      console.warn(`[sound] could not load ${START_URL}`, err);
    }
  }

  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 1);
    if (this.master && this.enabled) this.master.gain.value = this.volume;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? this.volume : 0;
    if (!enabled) this.stopBed();
    else if (this.ctx?.state === "running") this.startBed();
  }

  unlock() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== "running") {
      void ctx.resume().then(() => {
        if (!this.enabled) return;
        this.startBed();
        this.playStartOnce();
      });
    } else if (this.enabled) {
      this.startBed();
      this.playStartOnce();
    }
  }

  playStartOnce() {
    if (this.startPlayed) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.startBuffer) return;
    this.startPlayed = true;
    this.play("start");
  }

  resetStart() {
    this.startPlayed = false;
  }

  debug() {
    return {
      version: SOUND_VERSION,
      context: this.ctx?.state ?? "not created",
      enabled: this.enabled,
      volume: this.volume,
      masterGain: this.master?.gain.value ?? null,
      bedPlaying: this.bedSource !== null,
      startLoaded: this.startBuffer !== null,
      startError: this.startError,
      startPlayed: this.startPlayed,
    };
  }

  private startBed() {
    if (BED_LEVEL <= 0) return;
    const ctx = this.ctx;
    if (!ctx || !this.master || this.bedSource) return;

    const src = ctx.createBufferSource();
    src.buffer = loopNoiseBuffer(ctx, 4);
    src.loop = true;

    const filters = chain(ctx, BED_FILTERS);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(BED_LEVEL, ctx.currentTime + 1.5);

    src.connect(filters.head);
    filters.tail.connect(g).connect(this.master);
    src.start();

    this.bedSource = src;
    this.bedGain = g;
  }

  private stopBed() {
    const ctx = this.ctx;
    if (!ctx || !this.bedSource || !this.bedGain) return;

    const src = this.bedSource;
    this.bedGain.gain.cancelScheduledValues(ctx.currentTime);
    this.bedGain.gain.setValueAtTime(this.bedGain.gain.value, ctx.currentTime);
    this.bedGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    src.stop(ctx.currentTime + 0.35);

    this.bedSource = null;
    this.bedGain = null;
  }

  play(name: SoundName, options: { pan?: number } = {}) {
    if (!this.enabled) return;

    const ctx = this.ctx;
    if (!ctx) return;

    if (ctx.state !== "running") {
      void ctx.resume().then(() => {
        if (!this.enabled) return;
        this.startBed();
        this.fire(name, options);
      });
      return;
    }

    this.fire(name, options);
  }

  private fire(name: SoundName, options: { pan?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(options.pan ?? 0, -1, 1);
    panner.connect(this.master);

    const now = ctx.currentTime + 0.005;
    const rate = 1 + (Math.random() * 2 - 1) * 0.03;

    if (name === "start") {
      if (!this.startBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = this.startBuffer;
      const g = ctx.createGain();
      g.gain.value = START_LEVEL;
      src.connect(g).connect(this.master);
      src.start(now);
      return;
    }

    /*if (name === "select") {
      const out = renderHit(ctx, panner, now, BRIGHT, 0.3, rate * 1.12, null);
      out.gain.setValueAtTime(0.3, now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      return;
    }*/

    if (name === "move") {
      renderHit(ctx, panner, now, BRIGHT, 0.95, rate, this.reverb);
      return;
    }

    if (name === "capture") {
      renderHit(ctx, panner, now, DARK, 1.0, rate, this.reverb);
      return;
    }

    if (name === "castle") {
      const left = ctx.createStereoPanner();
      left.pan.value = clamp((options.pan ?? 0) - 0.16, -1, 1);
      left.connect(this.master);
      const right = ctx.createStereoPanner();
      right.pan.value = clamp((options.pan ?? 0) + 0.16, -1, 1);
      right.connect(this.master);
      renderHit(ctx, left, now, BRIGHT, 0.8, rate, this.reverb);
      renderHit(ctx, right, now + 0.095, BRIGHT, 0.95, rate * 0.97, this.reverb);
      return;
    }

    if (name === "check") {
      renderHit(ctx, panner, now, BRIGHT, 0.95, rate, this.reverb);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 1175;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.09, now + 0.052);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);
      osc.connect(g).connect(panner);
      osc.start(now + 0.04);
      osc.stop(now + 0.44);
      return;
    }

    if (name === "end") {
      renderHit(ctx, panner, now, DARK, 1.0, 1, this.reverb);
      renderHit(ctx, panner, now + 0.26, DARK, 0.7, 0.84, this.reverb);
      return;
    }
  }
}

export function useSounds(enabled: boolean, volume = 0.9) {
  const engineRef = useRef<SoundEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SoundEngine();
  const engine = engineRef.current;

  useEffect(() => {
    engine.init();
    (window as unknown as { chessSound?: SoundEngine }).chessSound = engine;
  }, [engine]);

  useEffect(() => {
    const unlock = () => engine.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [engine]);

  useEffect(() => {
    engine.setEnabled(enabled);
  }, [engine, enabled]);

  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);

  return useCallback(
    (name: SoundName, options: { pan?: number } = {}) => {
      engine.play(name, options);
    },
    [engine]
  );
}