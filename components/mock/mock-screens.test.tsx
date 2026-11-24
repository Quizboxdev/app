import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// First paint of the mock-exam screens (before the database answers) and the screens that render from props alone. There is no browser here, so this proves the words, labels and states are in place;
// it does not prove the interactions (see docs/mock-exams/HANDOFF.md for the click-through to do on Preview).
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc: () => new Promise(() => undefined), auth: { getSession: async () => ({ data: { session: null } }) } }) }));
import type { Exam } from "@/lib/api/mock-exams";
import type { RoundState } from "@/lib/mock-exams/tally";
import AccessGate from "./AccessGate";
import ExamForm from "./ExamForm";
import ResultsPanel from "./ResultsPanel";
import ReviewPanel from "./ReviewPanel";
import RoundBuilder from "./RoundBuilder";
import SharePanel from "./SharePanel";
import TallyBar from "./TallyBar";

const round = (o: Partial<RoundState> = {}): RoundState => ({ id: "r1", position: 1, grade_code: "B7", subject_code: "MATH", subject_label: "Mathematics", topic_id: "t1", topic_title: "Fractions and decimals", requested: 5, selected: 0, available: 9, available_to_add: 9, shortfall: 0, ...o });
const exam = (o: Partial<Exam> = {}): Exam => ({ id: "e1", title: "JHS 2 BECE readiness mock", description: "", purpose: "bece_readiness", audience: "", curriculum_id: "c1", target_grade: "B8", desired_total: 12, time_limit_minutes: 60, attempts_allowed: 1,
  shuffle_questions: false, instructions: "", status: "draft", dirty: true, owner_kind: "teacher", version_count: 0, current_version_id: null, current_version_no: null, created_at: "2026-11-22T00:00:00Z", updated_at: "2026-11-22T00:00:00Z",
  rounds: [], totals: { desired: 12, allocated: 0, selected: 0, remaining_to_allocate: 12, remaining_to_select: 0 }, ...o });
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("access gate", () => {
  it("says it is loading until the database answers", () => { expect(html(<AccessGate>{() => <p>secret screen</p>}</AccessGate>)).toContain("Loading"); expect(html(<AccessGate>{() => <p>secret screen</p>}</AccessGate>)).not.toContain("secret screen"); });
});

describe("tally bar", () => {
  it("shows the five numbers, an accessible progress bar and the next step", () => {
    const h = html(<TallyBar exam={exam()} />);
    for (const t of ["Desired", "Allocated to rounds", "Chosen", "Still to allocate", "Still to choose"]) expect(h).toContain(t);
    expect(h).toContain('role="progressbar"'); expect(h).toContain('aria-live="polite"'); expect(h).toContain("Add your first round");
  });
  it("tells the author to fix a short round rather than hiding it", () => {
    const e = exam({ rounds: [round({ requested: 5, available: 2, available_to_add: 2, shortfall: 3 })], totals: { desired: 12, allocated: 5, selected: 0, remaining_to_allocate: 7, remaining_to_select: 5 } });
    expect(html(<TallyBar exam={e} />)).toMatch(/Round 1 is 3 short/);
  });
});

describe("round builder", () => {
  it("offers the four steps in order, with labels", () => {
    const h = html(<RoundBuilder exam={exam()} onChange={() => undefined} />);
    for (const t of ["1. Year", "2. Subject", "3. Topic", "4. Number of questions", "Add a round", "No rounds yet"]) expect(h).toContain(t);
    expect(h).toContain("Choose a year first");
  });
  it("shows a short round honestly, with the three ways out and no automatic substitution", () => {
    const e = exam({ rounds: [round({ requested: 5, available: 2, available_to_add: 2, shortfall: 3 })], totals: { desired: 12, allocated: 5, selected: 0, remaining_to_allocate: 7, remaining_to_select: 5 } });
    const h = html(<RoundBuilder exam={e} onChange={() => undefined} />);
    expect(h).toContain("Only 2 different approved questions are available in this topic, 3 short of the 5 you asked for.");
    for (const t of ["Ways to fix this round", "Ask for fewer questions in this round", "Choose another topic or year for the missing questions", "Ask for more questions to be written and approved for this topic", "Ask for 2", "Change the topic or year"]) expect(h).toContain(t);
    expect(h).toContain('href="/support"'); expect(h).toContain("Short");
    expect(h).not.toMatch(/another (topic|year)[^.]*automatically|filled from/i);
  });
  it("shows a filled round, its numbers and the actions on it", () => {
    const e = exam({ rounds: [round({ selected: 5, available_to_add: 4 })], totals: { desired: 12, allocated: 5, selected: 5, remaining_to_allocate: 7, remaining_to_select: 0 } });
    const h = html(<RoundBuilder exam={e} onChange={() => undefined} />);
    for (const t of ["Round 1: JHS 1 (B7) · Mathematics · Fractions and decimals", "Filled", "5 of 5 chosen.", "Choose by hand", "Clear choices", "Edit round", "Remove"]) expect(h).toContain(t);
  });
  it("hides every editing control on an archived exam", () => {
    const h = html(<RoundBuilder exam={exam({ status: "archived", rounds: [round()] })} onChange={() => undefined} />);
    expect(h).not.toContain("Add a round"); expect(h).not.toContain("Choose automatically");
  });
});

describe("exam form", () => {
  it("labels every field, limits the size, and groups the years by stage", () => {
    const h = html(<ExamForm onSaved={() => undefined} />);
    for (const t of ["Exam name", "Purpose", "Curriculum", "Target year", "Number of questions", "Time allowed (minutes)", "Attempts allowed", "Instructions for learners", "Create exam and add rounds"]) expect(h).toContain(t);
    expect(h).toContain('min="5"'); expect(h).toContain('max="100"');
    for (const t of ["Primary", "Junior High", "Senior High", "JHS 2 (B8)", "SHS 1 (SHS1)"]) expect(h).toContain(t);
    expect(h).toContain("Rounds can use this year and earlier years of the same stage.");
  });
  it("locks the curriculum once rounds exist", () => {
    const h = html(<ExamForm exam={exam({ rounds: [round()] })} onSaved={() => undefined} />);
    expect(h).toContain("The curriculum cannot change once rounds exist.");
  });
});

describe("review panel and results panel: first paint and empty states", () => {
  it("review shows a loading state first", () => { expect(html(<ReviewPanel exam={exam()} onChange={() => undefined} />)).toContain("Loading"); });
  it("results explain what to do before anything is published", () => {
    const h = html(<ResultsPanel examId="e1" hasVersion={false} />);
    expect(h).toContain("Publish the exam and give it to a class or sell it");
  });
  it("results show a loading state once there is a version", () => { expect(html(<ResultsPanel examId="e1" hasVersion />)).toContain("Loading results"); });
});

describe("share panel", () => {
  it("asks for publishing first, and tells a sponsor only about selling", () => {
    expect(html(<SharePanel exam={exam()} />)).toContain("assign it to a class or sell it on the Marketplace");
    const s = html(<SharePanel exam={exam({ owner_kind: "sponsor" })} />);
    expect(s).toContain("give it to your family, share it by link or sell it"); expect(s).not.toContain("assign it to a class");
  });
  it("lets a sponsor sell a published exam, but does not offer a class", () => {
    const h = html(<SharePanel exam={exam({ owner_kind: "sponsor", status: "published", current_version_id: "v1", current_version_no: 1, version_count: 1, dirty: false })} />);
    expect(h).toContain("Give to my family"); expect(h).not.toContain("Assign to a class");                                       // a sponsor has no classes; the other panels wait for their data
    expect(h).toContain("Loading");
  });
  it("shows the assign and sell panels to a teacher with a published exam, with selling off until chosen", () => {
    const h = html(<SharePanel exam={exam({ status: "published", current_version_id: "v1", current_version_no: 1, version_count: 1, dirty: false })} />);
    expect(h).toContain("Assign to a class");
    expect(h).toContain("Loading");                                   // the sell panel waits for its listing before showing anything
  });
});
