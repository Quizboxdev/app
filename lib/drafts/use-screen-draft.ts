"use client";

import { usePathname } from "next/navigation";
import { useDraft } from "./use-draft";
import { draftTitle, fitsDraft, sameData, scrub, screenScope } from "./screen";

// Keeps an admin screen's unfinished form as a draft in "Unfinished work": restored when the person comes back, saved a moment after each change, removed by `finish()`
// when the work is done. One draft per screen. Secrets are stripped before saving (see ./screen.ts), an unchanged form is never saved, and a form too large for the holder
// is simply not saved (the screen keeps working). `baseline` is how the form looked when it was opened, so opening a record does not create a draft by itself.
export function useScreenDraft<T extends object>(o: { screen: string; label: string; detail?: string; value: T | null; baseline: T | null; apply: (restored: T) => void; omit?: readonly string[]; ready?: boolean }) {
  const path = usePathname() || "/admin";
  const clean = (o.value ? scrub(o.value, o.omit) : {}) as object;
  const changed = o.value !== null && !sameData(o.value, o.baseline ?? {}, o.omit) && fitsDraft(clean);
  return useDraft<object>({ kind: "other", scope: screenScope(o.screen), title: draftTitle(o.label, o.detail), path, value: clean, apply: (r) => o.apply(r as T), empty: !changed, ready: o.ready });
}
