"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { captchaEnabled, TURNSTILE_SCRIPT_SRC } from "@/lib/auth/captcha";

// Shows the Cloudflare Turnstile box and hands back its one-use token. With no site key nothing is shown and `enabled` is false, so forms behave exactly as before.
// A token works once: call reset() after every attempt, success or failure, to get a fresh one.
type TurnstileApi = { render: (el: HTMLElement, options: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id?: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window !== "undefined" && window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC; script.async = true; script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => { scriptPromise = null; reject(new Error("TURNSTILE_SCRIPT_FAILED")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function useTurnstile(): { enabled: boolean; token: string | null; failed: boolean; reset: () => void; widget: ReactNode } {
  const enabled = captchaEnabled(SITE_KEY);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !holder.current) return;
    let gone = false;
    loadScript().then(() => {
      if (gone || !holder.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(holder.current, {
        sitekey: SITE_KEY,
        theme: "auto",
        callback: (t: string) => { setToken(t); setFailed(false); },
        "expired-callback": () => setToken(null),
        "error-callback": () => { setToken(null); setFailed(true); },
      });
    }).catch(() => { if (!gone) setFailed(true); });
    return () => { gone = true; if (widgetId.current) { try { window.turnstile?.remove(widgetId.current); } catch { /* already gone */ } widgetId.current = null; } };
  }, [enabled]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) { try { window.turnstile?.reset(widgetId.current); } catch { /* the widget will fetch a new token on its own */ } }
  }, []);

  return { enabled, token, failed, reset, widget: enabled ? <div ref={holder} className="qb-turnstile" /> : null };
}
