// The player's working state, kept free of React so it can be tested: answers waiting to be saved, and the device's own copy that survives a lost connection or a closed tab.
export type Answers = Record<string, number>;
export type Draft = { sitting: string; answers: Answers };
export const draftKey = (sitting: string) => `qb-interschool-${sitting}`;
export const payload = (answers: Answers) => Object.entries(answers).map(([question_id, choice]) => ({ question_id, choice }));
// What the server holds, overlaid with anything answered on this device that has not reached it yet.
export function restore(questions: Array<{ id: string; options: string[]; chosen: number | null }>, stored: string | null, sitting: string): { answers: Answers; unsaved: Answers } {
  const server: Answers = {};
  for (const q of questions) if (q.chosen !== null && q.chosen !== undefined) server[q.id] = q.chosen;
  const unsaved: Answers = {};
  try {
    const draft = JSON.parse(stored ?? "null") as Draft | null;
    if (draft?.sitting === sitting) for (const q of questions) { const v = draft.answers?.[q.id]; if (Number.isInteger(v) && v >= 0 && v < q.options.length && server[q.id] !== v) unsaved[q.id] = v; }
  } catch { /* a damaged copy is ignored */ }
  return { answers: { ...server, ...unsaved }, unsaved };
}
// Seconds left on the server's clock: the device's clock is only used to count down from the server's time.
export const secondsLeft = (expiresAt: string, serverTime: string, receivedAt: number, now: number) => Math.max(0, Math.round((new Date(expiresAt).getTime() - new Date(serverTime).getTime() - (now - receivedAt)) / 1000));
