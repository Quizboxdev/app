"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { installState, type InstallState } from "@/lib/pwa/install";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const KEY = "qb-install-dismissed";
const read = (): number | null => { try { const v = Number(localStorage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };

// A small card offering to add QuizBox to the home screen. Chrome and Edge give us a real install button; Safari on iPhone only has Share, then Add to Home Screen, so we explain that.
// Hidden once installed, and for 30 days after the learner dismisses it. Storage can be blocked, so every access is guarded.
export default function InstallPrompt() {
  const [event, setEvent] = useState<PromptEvent | null>(null), [state, setState] = useState<InstallState>("hidden");
  const evaluate = (e: PromptEvent | null) => setState(installState({
    standalone: window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    userAgent: navigator.userAgent, hasPrompt: !!e, dismissedAt: read(), now: Date.now(),
  }));
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); const pe = e as PromptEvent; setEvent(pe); evaluate(pe); };
    const onInstalled = () => { setEvent(null); setState("installed"); };
    window.addEventListener("beforeinstallprompt", onPrompt); window.addEventListener("appinstalled", onInstalled); evaluate(null);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setState("hidden"); };
  async function install() { if (!event) return; await event.prompt(); const choice = await event.userChoice.catch(() => null); setEvent(null); if (choice?.outcome === "accepted") setState("installed"); else dismiss(); }

  if (state === "hidden" || state === "installed") return null;
  return (
    <section className="qb-card" aria-label="Install QuizBox" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 220px" }}>
        <strong>Install QuizBox on your phone</strong>
        <p className="qb-muted qb-small" style={{ margin: "4px 0 0" }}>
          {state === "ios" ? <>Tap <Share size={14} aria-label="Share" style={{ verticalAlign: "text-bottom" }} /> Share, then &quot;Add to Home Screen&quot;. It opens full screen like an app.</> : "Open it from your home screen, full screen, like an app."}
        </p>
      </div>
      {state === "prompt" && <button className="qb-btn" onClick={() => void install()}><Download size={16} aria-hidden="true" /> Install</button>}
      <button className="qb-link-btn" onClick={dismiss} aria-label="Hide this message"><X size={16} aria-hidden="true" /></button>
    </section>
  );
}
