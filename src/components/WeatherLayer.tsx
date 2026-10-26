import { useEffect, useRef } from "react";
import type { Theme, Weather } from "../theme/themes.ts";

type System = {
  update: (dt: number, t: number) => void;
  draw: (ctx: CanvasRenderingContext2D) => void;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function countFor(w: number, h: number, pixelsPer: number, max: number) {
  return Math.min(max, Math.round((w * h) / pixelsPer));
}

function rain(w: number, h: number, heavy: boolean): System {
  const wind = heavy ? 0.28 : 0.16;
  const n = countFor(w, h, heavy ? 5200 : 8500, heavy ? 420 : 260);

  const drops = Array.from({ length: n }, () => ({
    x: rand(-h * wind, w),
    y: rand(-h, h),
    len: rand(12, heavy ? 30 : 22),
    speed: rand(800, 1250) * (heavy ? 1.25 : 1),
    alpha: rand(0.16, heavy ? 0.42 : 0.34),
  }));

  return {
    update(dt) {
      for (const d of drops) {
        d.y += d.speed * dt;
        d.x += d.speed * wind * dt;
        if (d.y - d.len > h) {
          d.y = rand(-80, -10);
          d.x = rand(-h * wind, w);
        }
      }
    },
    draw(ctx) {
      ctx.lineWidth = 1.1;
      ctx.lineCap = "round";
      for (const d of drops) {
        ctx.strokeStyle = `rgba(178, 198, 224, ${d.alpha})`;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * wind, d.y - d.len);
        ctx.stroke();
      }
    },
  };
}

function storm(w: number, h: number): System {
  const base = rain(w, h, true);

  let next = rand(2.5, 5);
  let flashAt = -10;
  let bolt: { x: number; y: number }[][] = [];

  function makeBolt() {
    const trunk: { x: number; y: number }[] = [];
    let x = rand(w * 0.12, w * 0.88);
    let y = 0;
    const end = rand(h * 0.35, h * 0.62);
    trunk.push({ x, y });
    while (y < end) {
      y += rand(16, 34);
      x += rand(-24, 24);
      trunk.push({ x, y });
    }
    const branches = [trunk];
    for (let b = 0; b < 2; b++) {
      const from = trunk[Math.floor(rand(2, trunk.length - 2))];
      if (!from) continue;
      const branch = [{ ...from }];
      let bx = from.x;
      let by = from.y;
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 5; i++) {
        by += rand(12, 24);
        bx += dir * rand(6, 22);
        branch.push({ x: bx, y: by });
      }
      branches.push(branch);
    }
    return branches;
  }

  function brightness(age: number) {
    if (age < 0) return 0;
    if (age < 0.07) return 1;
    if (age < 0.15) return 0.25;
    if (age < 0.24) return 0.9;
    return Math.max(0, 1 - (age - 0.24) / 0.4);
  }

  let now = 0;

  return {
    update(dt, t) {
      now = t;
      base.update(dt, t);
      if (t >= next) {
        flashAt = t;
        bolt = makeBolt();
        next = t + rand(6, 13);
      }
    },
    draw(ctx) {
      base.draw(ctx);
      const a = brightness(now - flashAt);
      if (a <= 0) return;

      ctx.fillStyle = `rgba(190, 200, 255, ${a * 0.16})`;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.strokeStyle = `rgba(232, 236, 255, ${a})`;
      ctx.shadowColor = "rgba(170, 185, 255, 0.9)";
      ctx.shadowBlur = 18;
      bolt.forEach((line, i) => {
        ctx.lineWidth = i === 0 ? 2.2 : 1.2;
        ctx.beginPath();
        line.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      });
      ctx.restore();
    },
  };
}

function snow(w: number, h: number): System {
  const n = countFor(w, h, 9000, 260);
  const flakes = Array.from({ length: n }, () => {
    const depth = Math.random();
    return {
      x: rand(0, w),
      y: rand(-h, h),
      r: 0.8 + depth * 2.4,
      speed: 18 + depth * 52,
      phase: rand(0, Math.PI * 2),
      sway: rand(0.4, 1.1),
      alpha: 0.35 + depth * 0.55,
    };
  });

  return {
    update(dt) {
      for (const f of flakes) {
        f.y += f.speed * dt;
        f.phase += f.sway * dt;
        f.x += Math.sin(f.phase) * 14 * dt + 6 * dt;
        if (f.y - f.r > h) {
          f.y = rand(-40, -6);
          f.x = rand(0, w);
        }
        if (f.x > w + 10) f.x = -10;
      }
    },
    draw(ctx) {
      ctx.fillStyle = "#F3F7FA";
      for (const f of flakes) {
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}

const LEAF_COLORS = ["#C2652A", "#D9922E", "#9A3F1F", "#B5822F", "#7E4A22"];

function leaves(w: number, h: number): System {
  const n = countFor(w, h, 16000, 110);
  const list = Array.from({ length: n }, () => ({
    x: rand(0, w),
    y: rand(-h * 0.3, h),
    size: rand(6, 12),
    fall: rand(38, 80),
    sway: rand(0, Math.PI * 2),
    swaySpeed: rand(0.8, 1.6),
    rot: rand(0, Math.PI * 2),
    rotSpeed: rand(-1.4, 1.4),
    flip: rand(0, Math.PI * 2),
    flipSpeed: rand(1.5, 3.5),
    color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
  }));

  return {
    update(dt) {
      for (const l of list) {
        l.y += l.fall * dt;
        l.sway += l.swaySpeed * dt;
        l.x += Math.sin(l.sway) * 42 * dt + 14 * dt;
        l.rot += l.rotSpeed * dt;
        l.flip += l.flipSpeed * dt;
        if (l.y - l.size > h) {
          l.y = rand(-60, -12);
          l.x = rand(-40, w);
        }
        if (l.x > w + 20) l.x = -20;
      }
    },
    draw(ctx) {
      ctx.globalAlpha = 0.82;
      for (const l of list) {
        const s = l.size;
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(l.rot);
        ctx.scale(Math.max(0.18, Math.abs(Math.cos(l.flip))), 1);
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(s * 0.75, -s * 0.15, 0, s);
        ctx.quadraticCurveTo(-s * 0.75, -s * 0.15, 0, -s);
        ctx.fill();
        ctx.strokeStyle = "rgba(40, 20, 8, 0.45)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.85);
        ctx.lineTo(0, s * 1.25);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  };
}

function motes(w: number, h: number): System {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 32;
  const sc = sprite.getContext("2d")!;
  const g = sc.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255, 222, 160, 1)");
  g.addColorStop(0.35, "rgba(250, 190, 110, 0.45)");
  g.addColorStop(1, "rgba(240, 160, 80, 0)");
  sc.fillStyle = g;
  sc.fillRect(0, 0, 32, 32);

  const n = countFor(w, h, 22000, 90);
  const list = Array.from({ length: n }, () => ({
    x: rand(0, w),
    y: rand(0, h),
    size: rand(5, 14),
    rise: rand(6, 20),
    sway: rand(0, Math.PI * 2),
    twinkle: rand(0.6, 1.6),
    phase: rand(0, Math.PI * 2),
  }));

  let now = 0;

  return {
    update(dt, t) {
      now = t;
      for (const m of list) {
        m.y -= m.rise * dt;
        m.sway += 0.5 * dt;
        m.x += Math.sin(m.sway) * 8 * dt;
        if (m.y + m.size < 0) {
          m.y = h + rand(5, 40);
          m.x = rand(0, w);
        }
      }
    },
    draw(ctx) {
      for (const m of list) {
        ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(now * m.twinkle + m.phase));
        ctx.drawImage(sprite, m.x - m.size / 2, m.y - m.size / 2, m.size, m.size);
      }
      ctx.globalAlpha = 1;
    },
  };
}

function build(kind: Weather, w: number, h: number): System | null {
  switch (kind) {
    case "rain":
      return rain(w, h, false);
    case "storm":
      return storm(w, h);
    case "snow":
      return snow(w, h);
    case "leaves":
      return leaves(w, h);
    case "motes":
      return motes(w, h);
    default:
      return null;
  }
}

export default function WeatherLayer({ theme }: { theme: Theme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || theme.weather === "none") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let system: System | null = null;
    let w = 0;
    let h = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      system = build(theme.weather, w, h);
      if (still) paint();
    }

    function paint() {
      ctx!.clearRect(0, 0, w, h);
      system?.draw(ctx!);
    }

    resize();
    window.addEventListener("resize", resize);

    if (still) {
      return () => window.removeEventListener("resize", resize);
    }

    let raf = 0;
    let last = performance.now();
    const start = last;

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      system?.update(dt, t);
      paint();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [theme.weather]);

  if (theme.id === "classic") return null;

  return (
    <div className="weather" aria-hidden="true">
      <div className="weather-sky" key={theme.id} style={{ background: theme.sky }} />
      {theme.weather !== "none" && (
        <canvas className="weather-canvas" key={theme.weather} ref={canvasRef} />
      )}
    </div>
  );
}