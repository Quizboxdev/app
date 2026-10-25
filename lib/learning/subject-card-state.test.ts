import { describe, expect, it } from "vitest";
import { subjectCardView } from "./subject-card-state";
import type { MyAccess } from "@/lib/api/access";

const access = (over: Partial<MyAccess> = {}): MyAccess => ({ gated: true, free_limit: 3, used: 1, remaining: 2, subscribed: false, exhausted: false, ...over });

describe("subject card state", () => {
  it("covers loading and error before any data claims", () => {
    expect(subjectCardView({ loading: true }).state).toBe("LOADING");
    const e = subjectCardView({ error: true });
    expect([e.state, e.action.kind]).toEqual(["ERROR", "retry"]);
  });

  it("says a subject has no questions only when the server count is zero, never because a photo is missing", () => {
    expect(subjectCardView({ available: 0 }).state).toBe("CONTENT_UNAVAILABLE");
    expect(subjectCardView({ available: 0 }).action.kind).toBe("none"); // no 'Notify me': no registration workflow exists
    expect(subjectCardView({ available: 12 }).state).toBe("UNSTARTED");
    expect(subjectCardView({ available: null }).state).toBe("UNSTARTED");
  });

  it("resumes a stored attempt by id with real progress, and only then", () => {
    const v = subjectCardView({ available: 40, attempt: { id: "a1", answered: 12, total: 20 } });
    expect([v.state, v.action.kind, v.progress, v.status]).toEqual(["UNFINISHED", "resume", 60, "12 of 20 answered"]);
    expect(subjectCardView({ available: 40, attempt: { id: "a1" } }).progress).toBeNull();
  });

  it("treats the free allowance as account-wide: used up means one 'see plans' status on every subject, not a per-subject lock", () => {
    const used = subjectCardView({ available: 40, access: access({ exhausted: true, remaining: 0 }) });
    expect([used.state, used.action.kind, used.status]).toEqual(["ACCESS_REQUIRED", "subscribe", "Free practice used"]);
    expect(subjectCardView({ available: 40, access: access({ remaining: 2 }) }).state).toBe("UNSTARTED");
    expect(subjectCardView({ available: 40, access: access({ exhausted: true, subscribed: true }) }).state).toBe("UNSTARTED");
    expect(subjectCardView({ available: 40, access: { ...access(), gated: false, exhausted: true } }).state).toBe("UNSTARTED");
  });

  it("only recommends revision or a next topic from real signals", () => {
    expect(subjectCardView({ available: 40, weak: true }).state).toBe("REVISION_RECOMMENDED");
    expect(subjectCardView({ available: 40, nextTopic: { id: "t", title: "Fractions" } }).state).toBe("NEXT_TOPIC");
    expect(subjectCardView({ available: 40, evidence: 3 }).state).toBe("READY");
  });
});
