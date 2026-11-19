// Browser storage for answers that have not reached the server yet (December gate MB-D1). One entry per attempt, kept only while answers are waiting:
// the entry is removed the moment the queue is empty, and an entry older than 12 hours is ignored (the attempt clock ended long before).
// Nothing but the attempt id, question ids and the chosen answers is stored. Storage that is blocked or full is tolerated: the answers stay in memory.

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const keyFor = (attemptId: string) => `qb-unsaved-answers:${attemptId}`;

type Backing = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function unsavedAnswersStore<T>(attemptId: string, backing?: Backing | null, now: () => number = Date.now) {
  const store = (): Backing | null => {
    if (backing !== undefined) return backing;
    try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
  };
  return {
    read(): Array<[string, T]> {
      try {
        const text = store()?.getItem(keyFor(attemptId));
        if (!text) return [];
        const parsed = JSON.parse(text) as { savedAt?: unknown; entries?: unknown };
        if (typeof parsed.savedAt !== "number" || now() - parsed.savedAt > MAX_AGE_MS || !Array.isArray(parsed.entries)) { store()?.removeItem(keyFor(attemptId)); return []; }
        return parsed.entries.filter((e): e is [string, T] => Array.isArray(e) && e.length === 2 && typeof e[0] === "string");
      } catch { return []; }
    },
    write(entries: Array<[string, T]>) {
      const s = store();
      if (!s) return;
      if (entries.length === 0) s.removeItem(keyFor(attemptId));
      else s.setItem(keyFor(attemptId), JSON.stringify({ savedAt: now(), entries }));
    },
  };
}
