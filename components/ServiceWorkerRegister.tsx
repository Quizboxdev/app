"use client";

import { useEffect } from "react";

// Registers the service worker (public/sw.js) in production only, so development never serves a cached file. Failures are ignored: the site works without it.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined); };
    if (document.readyState === "complete") register(); else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
