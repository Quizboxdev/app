"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLive, POLL_MS, type Live, type SectionName } from "@/lib/admin/live";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Keeps one section of the dashboard current:
//   - the last good figures show at once (kept for this browser tab, per signed-in person) while new ones are fetched
//   - it asks again on a timer while the page is visible, and at once when the person comes back or the connection returns
//   - after a failure the figures stay on screen and the next try waits longer each time, up to five minutes
const memory = new Map<string, unknown>();
const MAX_WAIT = 5 * 60_000;

async function cacheKey(section: SectionName, days: number): Promise<string | null> {
  try {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    return data.session ? `qb-admin-live:${data.session.user.id}:${section}${section === "people" ? `:${days}` : ""}` : null;
  } catch { return null; }
}
function readCache<S extends SectionName>(key: string): Live<S> | null {
  if (memory.has(key)) return memory.get(key) as Live<S>;
  try { const raw = window.sessionStorage.getItem(key); return raw ? (JSON.parse(raw) as Live<S>) : null; } catch { return null; }
}
function writeCache(key: string, value: unknown) {
  memory.set(key, value);
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private window or full storage: the memory copy is enough */ }
}

export function useLiveSection<S extends SectionName>(section: S, days: number) {
  const [state, setState] = useState<{ days: number; value: Live<S> | null; error: string }>({ days, value: null, error: "" });
  const [busy, setBusy] = useState(true);
  const run = useRef<(maxAge?: number) => void>(() => {});

  useEffect(() => {
    let alive = true, running = false, failures = 0, timer: number | undefined, last = 0;
    const wait = (basic?: boolean) => failures ? Math.min(POLL_MS[section] * 2 ** (failures - 1), MAX_WAIT) : basic ? MAX_WAIT : POLL_MS[section];
    const schedule = (ms: number) => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (document.visibilityState === "visible") void load(); }, ms); };
    async function load(maxAge?: number) {
      if (!alive || running) return;
      running = true; setBusy(true); window.clearTimeout(timer);
      let basic: boolean | undefined;
      try {
        const value = await fetchLive(section, days, maxAge);
        if (!alive) return;
        failures = 0; basic = value.basic;
        setState({ days, value, error: "" });
        const key = await cacheKey(section, days);
        if (key) writeCache(key, value);
      } catch (e) {
        if (!alive) return;
        failures += 1;
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : "These figures could not be loaded." }));
      } finally {
        running = false; last = Date.now();
        if (alive) { setBusy(false); schedule(wait(basic)); }
      }
    }
    // Figures from the last visit fill the screen until the new ones arrive.
    setState((s) => ({ days, value: section === "people" && s.days !== days ? null : s.value, error: "" }));
    void cacheKey(section, days).then((key) => {
      const cached = key ? readCache<S>(key) : null;
      if (alive && cached) setState((s) => (s.value ? s : { ...s, days, value: { ...cached, stale: true } }));
    });
    const resume = () => { if (document.visibilityState === "visible" && Date.now() - last >= POLL_MS[section]) void load(); };
    const online = () => { failures = 0; void load(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", online);
    run.current = (maxAge) => void load(maxAge);
    void load();
    return () => { alive = false; window.clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", online); };
  }, [section, days]);

  const refresh = useCallback(() => run.current(5), []);
  // Figures for another period are never shown under the newly chosen one.
  const value = section === "people" && state.days !== days ? null : state.value;
  return { value, data: value?.data ?? null, error: state.error, busy, refresh };
}
