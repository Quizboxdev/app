import { isTransientFailure, realSleep } from "./resume";

// Owner batch actions (approve, revoke, discard) run in short steps on the database, because one statement over a thousand questions runs past its time limit.
// Every step is its own short transaction and picks up where the last one ended, so a step that is cut off is simply sent again; nothing is repeated or skipped.
export type StepResult = { done: boolean };
type Failure = Error & { code?: unknown; rawMessage?: unknown };

export async function runSteps<T extends StepResult>(call: () => Promise<T>, o: { onStep?: (r: T) => void; retryDelayMs?: number; sleep?: (ms: number) => Promise<void>; maxSteps?: number } = {}): Promise<T> {
  const sleep = o.sleep ?? realSleep, delay = o.retryDelayMs ?? 1500;
  for (let step = 0; step < (o.maxSteps ?? 500); step++) {
    let result: T | undefined;
    for (let attempt = 0; ; attempt++) {
      try { result = await call(); break; }
      catch (e) {
        const f = e as Failure;
        if (attempt < 3 && isTransientFailure({ code: f.code, message: f.rawMessage ?? f.message })) { if (delay > 0) await sleep(delay * (attempt + 1)); continue; }
        throw e;
      }
    }
    o.onStep?.(result!);
    if (result!.done) return result!;
  }
  throw new Error("This is taking much longer than expected, so it was stopped. Nothing was lost: open the batch again and press the same button to carry on.");
}

// The database function for this feature has not been installed yet (the app was updated before its database change).
export const isMissingFunction = (e: unknown): boolean => {
  const f = (e ?? {}) as Failure;
  return String(f.code ?? "") === "PGRST202" || /could not find the function|schema cache/i.test(String(f.rawMessage ?? f.message ?? ""));
};
