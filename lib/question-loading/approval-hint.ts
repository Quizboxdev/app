// Why the approve button is off when no question is waiting. `by_state` keys look like "review/inactive" or "approved/active" (review state / availability).
export function nothingToApprove(byState: Record<string, number>): string {
  const count = (state: string) => Object.entries(byState).filter(([k]) => k.startsWith(`${state}/`)).reduce((n, [, v]) => n + v, 0);
  const approved = count("approved"), waiting = count("review");
  if (waiting > 0) return `${waiting} question${waiting === 1 ? " is" : "s are"} waiting for review but none passes the automatic checks, so none can be approved. Ask for the batch to be corrected and loaded again.`;
  if (approved > 0) return `All ${approved} question${approved === 1 ? " is" : "s are"} already approved, so there is nothing left to do. To see another batch, close this and press Review sample on a row that shows "Not approved".`;
  return "This batch has no questions waiting for review.";
}
