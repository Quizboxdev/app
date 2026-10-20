"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteDraft, getDraft, saveDraft, type DraftInfo } from "@/lib/api/drafts";
import type { DraftKind } from "./format";

// Keeps an unfinished form safe. On first load it restores a saved draft for this kind and scope (if there is one) through `apply`; after that it saves what the person has
// typed about a second after they stop, so leaving the page by mistake loses nothing. A draft is deleted when the work is finished (`finish`) or discarded, and by the server
// 24 hours after the last change. Nothing here ever throws into the form: if the holder is unavailable the form simply works as it did before.
export function useDraft<T extends object>(o: { kind: DraftKind; scope?: string; title: string; path: string; value: T; apply: (restored: T) => void; empty: boolean; ready?: boolean }) {
  const scope = o.scope ?? "new", ready = o.ready ?? true, key = `${o.kind}:${scope}`;
  const [restored, setRestored] = useState<DraftInfo | null>(null), [expiresAt, setExpiresAt] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null), finished = useRef(false), finishedAt = useRef(""), applyRef = useRef(o.apply);
  applyRef.current = o.apply;

  // Restore once per scope.
  useEffect(() => {
    if (!ready || loadedFor.current === key) return;
    loadedFor.current = key; finished.current = false; setRestored(null); setExpiresAt(null);
    let alive = true;
    getDraft(o.kind, scope).then((d) => { if (alive && d) { applyRef.current(d.payload as T); setRestored(d); setExpiresAt(d.expires_at); } }).catch(() => undefined);
    return () => { alive = false; };
  }, [ready, scope, o.kind, key]);

  // Save shortly after the last change (never an empty form, never after the work is finished).
  const latest = useRef(o);
  latest.current = o;
  useEffect(() => {
    if (!ready || loadedFor.current !== key || o.empty) return;
    // After the work is finished or discarded nothing more is saved, until the person changes something again.
    if (finished.current) { if (JSON.stringify(o.value) === finishedAt.current) return; finished.current = false; }
    const t = setTimeout(() => {
      const c = latest.current;
      if (finished.current || c.empty) return;
      saveDraft(c.kind, scope, c.title, c.value, c.path).then((r) => setExpiresAt(r.expires_at)).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, o.empty, JSON.stringify(o.value), o.title]);

  const finish = useCallback(async () => { finished.current = true; finishedAt.current = JSON.stringify(latest.current.value); setRestored(null); setExpiresAt(null); try { await deleteDraft(o.kind, scope); } catch { /* the server removes it anyway */ } }, [o.kind, scope]);
  return { restored, expiresAt, finish, dismissNotice: () => setRestored(null) };
}
