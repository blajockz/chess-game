import { useEffect, useRef, useState } from "react";

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const CAPTCHA_ON = SITE_KEY !== "";

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  const w = window as unknown as { turnstile?: Turnstile };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error("Turnstile didn't start")));
      s.onerror = () => {
        loading = null;
        reject(new Error("Turnstile couldn't load"));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

type Props = {
  onToken: (token: string | null) => void;
  round: number;
  action: "signin" | "signup" | "reset" | "resend" | "admin";
};

export default function Captcha({ onToken, round, action }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tell = useRef(onToken);
  tell.current = onToken;
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!CAPTCHA_ON) return;
    let alive = true;
    loadTurnstile()
      .then((t) => {
        if (!alive || !box.current) return;
        widget.current = t.render(box.current, {
          sitekey: SITE_KEY,
          action,
          theme: "dark",
          size: "flexible",
          callback: (token: string) => {
            setProblem("");
            tell.current(token);
          },
          "expired-callback": () => tell.current(null),
          "timeout-callback": () => tell.current(null),
          "error-callback": () => {
            tell.current(null);
            setProblem("The security check couldn't run. Reload the page, or turn off a blocker for challenges.cloudflare.com.");
            return true;
          },
        });
      })
      .catch(() => {
        if (alive) setProblem("The security check couldn't load. Check your connection and reload the page.");
      });
    return () => {
      alive = false;
      const t = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (t && widget.current) t.remove(widget.current);
      widget.current = null;
    };
  }, [action]);

  useEffect(() => {
    if (!CAPTCHA_ON || round === 0) return;
    tell.current(null);
    const t = (window as unknown as { turnstile?: Turnstile }).turnstile;
    if (t && widget.current) t.reset(widget.current);
  }, [round]);

  if (!CAPTCHA_ON) return null;
  return (
    <div className="captcha">
      <div ref={box} className={"captcha-box" + (problem ? " is-off" : "")} />
      {problem && (
        <p className="auth-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
