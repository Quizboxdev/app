// Keeps quiz answers from being lost on a weak connection (audit UX-011). Each answer is queued under its question id, saved one at a time,
// and a failed save stays queued and is retried with a growing delay, on demand, and when the browser reports it is back online.
// The newest answer for a question always wins, even when an older save for that question is still in flight.

export type SaveQueueState = { saving: boolean; pending: ReadonlySet<string>; failed: ReadonlySet<string> };

export function createSaveQueue<T>(options: {
  save: (key: string, value: T) => Promise<void>;
  onChange?: (state: SaveQueueState) => void;
  retryDelaysMs?: number[];
  // A save the server refused (for example the attempt is already closed) will never succeed: it is dropped and reported, not retried forever.
  isRetryable?: (error: unknown) => boolean;
  onReject?: (key: string, error: unknown) => void;
  // Where unsaved answers are kept so they survive a page reload or a browser that closes the tab on a weak phone (December gate MB-D1).
  // Answers found here when the queue is created are queued again; every change to the waiting answers is written back.
  storage?: { read(): Array<[string, T]>; write(entries: Array<[string, T]>): void };
}) {
  const delays = options.retryDelaysMs ?? [1000, 2000, 5000, 10000];
  const pending = new Map<string, T>();
  try { for (const [key, value] of options.storage?.read() ?? []) pending.set(key, value); } catch { /* storage unavailable: carry on in memory */ }
  let lastWritten = "";
  const persist = () => {
    if (!options.storage) return;
    const entries = [...pending.entries()];
    const text = JSON.stringify(entries);
    if (text === lastWritten) return;
    lastWritten = text;
    try { options.storage.write(entries); } catch { /* storage full or blocked: memory still holds the answers */ }
  };
  const failed = new Set<string>();
  let saving = false, attempt = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<boolean> | null = null;

  const emit = () => { persist(); options.onChange?.({ saving, pending: new Set(pending.keys()), failed: new Set(failed) }); };
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  async function drain(): Promise<boolean> {
    clearTimer();
    saving = true; emit();
    let ok = true;
    while (pending.size && !disposed) {
      const [key, value] = pending.entries().next().value as [string, T];
      try {
        await options.save(key, value);
        if (pending.get(key) === value) pending.delete(key);   // a newer answer for the same question stays queued
        failed.delete(key); attempt = 0;
      } catch (error) {
        if (options.isRetryable && !options.isRetryable(error)) {
          if (pending.get(key) === value) pending.delete(key);
          failed.delete(key); options.onReject?.(key, error); emit(); continue;
        }
        failed.add(key); ok = false; break;
      }
      emit();
    }
    saving = false;
    if (!ok && !disposed) { timer = setTimeout(() => { void flush(); }, delays[Math.min(attempt, delays.length - 1)]); attempt += 1; }
    emit();
    return ok && pending.size === 0;
  }

  // Saves everything queued. Resolves true only when nothing is left unsaved. Calls made while a run is active share that run.
  function flush(): Promise<boolean> {
    if (!running) {
      running = drain().finally(() => {
        running = null;
        // An answer queued in the instant between the loop ending and this point would otherwise wait for the next retry.
        if (pending.size && !failed.size && !disposed) void flush();
      });
    }
    return running;
  }

  return {
    enqueue(key: string, value: T) { pending.set(key, value); failed.delete(key); emit(); void flush(); },
    flush,
    // For the "Try now" button and the browser's online event: do not wait for the next scheduled retry.
    retryNow() { attempt = 0; return flush(); },
    hasUnsaved: () => pending.size > 0,
    // The answers still waiting to be saved (including ones restored from storage), so the page can show them.
    snapshot: (): Array<[string, T]> => [...pending.entries()],
    dispose() { disposed = true; clearTimer(); },
  };
}
