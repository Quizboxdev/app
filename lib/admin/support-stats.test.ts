import { describe, expect, it } from "vitest";
import type { AdminRow } from "@/lib/api/support";
import { supportStats } from "./support-stats";

const row = (o: Partial<AdminRow>): AdminRow => ({ id: Math.random().toString(36), reference: "QB-T-1", subject: "Help", category: "account", status: "open", priority: "normal", requester: "A", email: "a@x.test", signed_in: true, source: "app",
  created_at: "2026-11-14T10:00:00Z", last_message_at: "2026-11-14T10:00:00Z", messages: 1, ...o } as AdminRow);
const NOW = new Date("2026-11-15T12:00:00Z");

describe("support request figures", () => {
  it("counts statuses, high priority, the oldest open request and this week against last", () => {
    const s = supportStats([
      row({ created_at: "2026-11-14T10:00:00Z" }),                                           // open, 1 day
      row({ created_at: "2026-11-02T10:00:00Z", priority: "high", category: "payment" }),     // open, high, 13 days
      row({ status: "waiting_for_user", created_at: "2026-11-10T10:00:00Z" }),
      row({ status: "resolved", created_at: "2026-11-05T10:00:00Z" }),
      row({ status: "closed", created_at: "2026-10-01T10:00:00Z" }),
    ], NOW);
    expect([s.total, s.open, s.waiting, s.done, s.highOpen]).toEqual([5, 2, 1, 2, 1]);
    expect(s.oldestOpenDays).toBe(13);
    expect([s.thisWeek, s.lastWeek]).toEqual([2, 2]);
    expect(s.categories[0]).toEqual({ category: "account", n: 4 });
    expect(s.daily).toHaveLength(30);
    expect(s.daily[29]).toEqual({ week: "2026-11-15", opened: 0 });
    expect(s.daily[28]).toEqual({ week: "2026-11-14", opened: 1 });
  });
  it("copes with an empty queue", () => {
    const s = supportStats([], NOW);
    expect(s).toMatchObject({ total: 0, open: 0, oldestOpenDays: null, thisWeek: 0 });
    expect(s.daily.every((d) => d.opened === 0)).toBe(true);
  });
});
