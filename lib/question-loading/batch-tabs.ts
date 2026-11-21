import { batchView, type BatchRow } from "./queue";

// The Approve Batches page keeps three short lists instead of one long one: what still needs a person, what is live, and what was closed.
// Approved batches move out of the first list, so the batch being loaded and reviewed is never buried under hundreds of finished ones.
export type BatchTab = "waiting" | "approved" | "closed";
export const BATCH_TABS: ReadonlyArray<readonly [BatchTab, string]> = [["waiting", "Waiting for approval"], ["approved", "Approved"], ["closed", "Discarded"]];

// An approval that was cut off partway still has work to do (Finish approval), so it stays in "waiting" until it is finished or revoked.
export function tabOf(b: BatchRow, approved: boolean, approvalUnfinished = false): BatchTab {
  if (approved && !approvalUnfinished) return "approved";
  return batchView(b, approved, approvalUnfinished).action === "none" ? "closed" : "waiting";
}

export function countByTab<T extends BatchRow>(batches: readonly T[], approval: (b: T) => { in_progress?: boolean } | undefined): Record<BatchTab, number> {
  const out: Record<BatchTab, number> = { waiting: 0, approved: 0, closed: 0 };
  for (const b of batches) { const a = approval(b); out[tabOf(b, Boolean(a), Boolean(a?.in_progress))] += 1; }
  return out;
}

// "Tick all" on the sample is for the super administrator only. Subject experts review on their own page and never get an approve-all.
export const canTickAll = (sme: { super_admin?: boolean } | null | undefined): boolean => sme?.super_admin === true;
