// Checks the "Round closes" times a creator typed, before they are saved. A round that closes in the past would be shut the moment the event goes live,
// and a later round that closes before an earlier one can never be played. Empty times are fine (the round has no close time).
export type RoundTimeProblem = { index: number; message: string };

export function roundTimeProblems(closes: string[], now: Date = new Date()): RoundTimeProblem[] {
  const problems: RoundTimeProblem[] = [];
  let previous: { index: number; at: number } | null = null;
  closes.forEach((value, index) => {
    if (!value) return;
    const at = new Date(value).getTime();
    if (Number.isNaN(at)) { problems.push({ index, message: `Round ${index + 1}: that is not a date and time.` }); return; }
    if (at <= now.getTime()) problems.push({ index, message: `Round ${index + 1} closes in the past, so nobody could play it. Choose a later date and time.` });
    else if (previous && at <= previous.at) problems.push({ index, message: `Round ${index + 1} closes before or at the same time as round ${previous.index + 1}. Each round must close after the one before it.` });
    previous = { index, at };
  });
  return problems;
}
