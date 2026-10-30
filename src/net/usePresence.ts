import { useEffect } from "react";
import { CLOSE_BANNED, CLOSE_UNAUTHORIZED } from "../../shared/protocol";
import { AUTH_OFF, accessToken, tokenRejected, wsProtocols } from "../auth/supabase";
import { serverUrl } from "./useOnline";

function presenceUrl() {
  return serverUrl().replace(/\/ws$/, "/presence");
}

export function usePresence(userId: string | null) {
  useEffect(() => {
    if (!userId || AUTH_OFF) return;
    let ws: WebSocket | null = null;
    let opening = false;
    let stopped = false;
    let attempt = 0;
    let timer: number | undefined;

    async function open() {
      if (stopped || ws || opening) return;
      opening = true;
      const token = await accessToken();
      opening = false;
      if (stopped || ws || !token) return;
      const socket = new WebSocket(presenceUrl(), wsProtocols(token));
      ws = socket;
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onclose = (e) => {
        if (ws === socket) ws = null;
        if (stopped) return;
        if (e.code === 1008) return;
        if (e.code === CLOSE_BANNED) {
          window.location.reload();
          return;
        }
        if (e.code === CLOSE_UNAUTHORIZED) {
          void tokenRejected().then((ok) => ok && void open());
          return;
        }
        attempt += 1;
        const wait = Math.min(30_000, 1000 * 2 ** attempt) * (0.7 + Math.random() * 0.6);
        timer = window.setTimeout(() => void open(), wait);
      };
    }

    const back = () => {
      if (document.visibilityState !== "visible" || ws) return;
      window.clearTimeout(timer);
      void open();
    };
    void open();
    window.addEventListener("online", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", back);
      document.removeEventListener("visibilitychange", back);
      ws?.close(1000, "Signed out");
    };
  }, [userId]);
}