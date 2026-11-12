// The quiz clock is worked out from a fixed deadline (when the page loaded plus the seconds the server said were left), never by counting ticks.
// A phone that sleeps, or a tab that sits in the background, slows timers down; the deadline does not move, so the clock is right the moment the student returns.
export const deadlineFrom = (remainingSeconds: number, now = Date.now()): number => now + (Number.isFinite(remainingSeconds) ? Math.max(0, remainingSeconds) : 0) * 1000;
export const secondsLeft = (deadline: number, now = Date.now()): number => Math.max(0, Math.ceil((deadline - now) / 1000));
