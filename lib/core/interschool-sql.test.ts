import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ADMIN, MANAGED, MIGRATIONS, PLAIN_TEACHER, SCHOOLS, SPONSOR_NEW, SPONSOR_OK, SUBJECT, UNVERIFIED_SCHOOL, baseSql, helpers, learner, makeDb, migration, staff, strandOf, type Db } from "./interschool-fixture";

// Inter-school competitions: configuration, permissions, registration and capacity (isolated PostgreSQL; the migrations are applied unchanged).
let db: Db;
let t: ReturnType<typeof helpers>;
const err = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
beforeAll(async () => { db = await makeDb(3); t = helpers(db); }, 60_000);
afterAll(async () => { await db.close(); });

describe("switched off", () => {
  it("does nothing until the owner switches it on", async () => {
    await t.as(ADMIN);
    await err("select public.interschool_create($1)", [JSON.stringify(t.settings())], /QB_FEATURE_DISABLED/);
    expect(await t.rpc("select public.interschool_public_list()")).toEqual([]);
    expect(await t.rpc("select public.interschool_public_get('x')")).toBeNull();
  });
  it("re-applies cleanly and gives browsers no table access", async () => {
    await t.q("select 1");
    for (const m of ["20261126100000_interschool_core", "20261126110000_interschool_registration", "20261126120000_interschool_play"]) await db.exec(migration(m));
    await t.on();
    await t.as(ADMIN);
    for (const table of ["competitions", "paper_questions", "candidates", "sittings", "round_results"]) await err(`select * from quizbox_interschool.${table}`, [], /permission denied/);
    await t.as(null);
    await err("select public.interschool_manage_list()", [], /permission denied/);
  });
});

describe("organisers", () => {
  it("allows administrators, verified school staff and verified sponsors, and nobody else", async () => {
    await t.as(ADMIN);
    expect((await t.rpc<any>("select public.interschool_create($1)", [JSON.stringify(t.settings({ title: "Admin cup" }))])).organiser_kind).toBe("ADMIN");
    await t.as(staff(1));
    expect((await t.rpc<any>("select public.interschool_create($1,$2)", [JSON.stringify(t.settings({ title: "School cup" })), SCHOOLS[0]])).organiser_kind).toBe("SCHOOL");
    await err("select public.interschool_create($1,$2)", [JSON.stringify(t.settings()), SCHOOLS[1]], /IS_ORGANISER_NOT_APPROVED/);
    await t.as(SPONSOR_OK);
    expect((await t.rpc<any>("select public.interschool_create($1)", [JSON.stringify(t.settings({ title: "Bank cup" }))])).organiser_kind).toBe("SPONSOR");
    for (const [who, school] of [[SPONSOR_NEW, null], [PLAIN_TEACHER, UNVERIFIED_SCHOOL], [learner(1, 7, 1), SCHOOLS[0]]] as const) {
      await t.as(who);
      await err("select public.interschool_create($1,$2)", [JSON.stringify(t.settings()), school], /IS_ORGANISER_NOT_APPROVED/);
    }
  });
  it("refuses unknown settings and keeps administrator-only choices for administrators", async () => {
    await t.as(staff(1));
    await err("select public.interschool_create($1,$2)", [JSON.stringify(t.settings({ status: "PUBLISHED" })), SCHOOLS[0]], /IS_UNKNOWN_SETTING/);
    await err("select public.interschool_create($1,$2)", [JSON.stringify(t.settings({ funding: "COMPLIMENTARY" })), SCHOOLS[0]], /IS_ADMIN_ONLY_SETTING/);
    await err("select public.interschool_create($1,$2)", [JSON.stringify(t.settings({ sponsor_logo_url: "javascript:alert(1)" })), SCHOOLS[0]], /check constraint/);
  });
  it("keeps one school's organiser out of another's competition", async () => {
    const c = await t.competition(staff(1), { host: SCHOOLS[0], publish: false });
    await t.as(staff(2));
    await err("select public.interschool_manage_get($1)", [c.id], /IS_NOT_AUTHORISED/);
    await err("select public.interschool_set_status($1,'CANCELLED','because')", [c.id], /IS_NOT_AUTHORISED/);
  });
});

describe("configuration and publishing", () => {
  it("keeps class levels apart unless mixing is chosen", async () => {
    const c = await t.competition(ADMIN, { publish: false });
    await err("select public.interschool_set_divisions($1,$2)", [c.id, JSON.stringify([{ level_codes: ["B7", "B8"] }])], /IS_MIXED_LEVELS_NOT_CONFIRMED/);
    await err("select public.interschool_set_divisions($1,$2)", [c.id, JSON.stringify([{ level_codes: ["B7"] }, { level_codes: ["B7"] }])], /IS_LEVEL_IN_TWO_DIVISIONS/);
    const r = await t.rpc<any>("select public.interschool_set_divisions($1,$2)", [c.id, JSON.stringify([{ level_codes: ["B7", "B8"], mixed: true }])]);
    expect(r.divisions[0].level_codes).toEqual(["B7", "B8"]);
  });
  it("only takes subjects of the division's level and counts the questions available", async () => {
    const c = await t.competition(ADMIN, { publish: false });
    await err("select public.interschool_set_rounds($1,$2)", [c.divisions[0], JSON.stringify([t.round(1, SUBJECT.math8)])], /IS_SUBJECT_NOT_FOR_LEVEL/);
    await t.rpc("select public.interschool_set_rounds($1,$2)", [c.divisions[0], JSON.stringify([t.round(1, SUBJECT.math7, { sections: [{ subject_id: SUBJECT.math7, count: 150 }] })])]);
    const check = await t.rpc<any>("select public.interschool_check($1)", [c.id]);
    expect(check.problems[0].code).toBe("IS_NOT_ENOUGH_QUESTIONS");
    await err("select public.interschool_publish($1)", [c.id], /IS_NOT_READY/);
    await err("select public.interschool_set_rounds($1,$2)", [c.divisions[0], JSON.stringify([t.round(1, SUBJECT.math7, { sections: [{ subject_id: SUBJECT.math7, count: 5, difficulty: { easy: 1, hard: 1 } }] })])], /IS_DIFFICULTY_MIX_INVALID/);
  });
  it("freezes common papers with the requested subjects, topics and difficulty, and never repeats a question between rounds", async () => {
    const c = await t.competition(ADMIN, { rounds: (subject) => [
      t.round(1, subject, { sections: [{ subject_id: subject, count: 4, difficulty: { easy: 3, hard: 1 } }, { subject_id: SUBJECT.eng7, count: 3, node_ids: [strandOf(SUBJECT.eng7)] }] }),
      t.round(2, subject, { sections: [{ subject_id: subject, count: 6 }] })] });
    const rows = await t.q<any>("select r.round_no, q.difficulty, q.subject_node_id, q.source_question_id from quizbox_interschool.paper_questions q join quizbox_interschool.papers p on p.id=q.paper_id join quizbox_interschool.rounds r on r.id=p.round_id join quizbox_interschool.divisions d on d.id=r.division_id where d.competition_id=$1", [c.id]);
    const one = rows.filter((r) => r.round_no === 1);
    expect(one).toHaveLength(7);
    expect(one.filter((r) => r.subject_node_id === SUBJECT.math7 && r.difficulty === "easy")).toHaveLength(3);
    expect(one.filter((r) => r.subject_node_id === SUBJECT.math7 && r.difficulty === "hard")).toHaveLength(1);
    expect(one.filter((r) => r.subject_node_id === SUBJECT.eng7)).toHaveLength(3);
    expect(new Set(rows.map((r) => r.source_question_id)).size).toBe(13);
    // editing the bank does not change the frozen paper
    await t.q("update public.questions set question_text='changed', correct_answer='B' where id=$1", [one[0].source_question_id]);
    expect((await t.q<any>("select count(*)::int n from quizbox_interschool.paper_questions where question_text='changed'"))[0].n).toBe(0);
  });
  it("needs approval for open or large competitions run by a school, but not for a small invited one", async () => {
    const small = await t.competition(staff(1), { host: SCHOOLS[0], publish: false });
    expect((await t.rpc<any>("select public.interschool_publish($1)", [small.id])).papers_frozen).toBe(1);
    const open = await t.competition(staff(1), { host: SCHOOLS[0], publish: false, settings: { title: "Open cup", participation: "OPEN" } });
    await err("select public.interschool_publish($1)", [open.id], /IS_APPROVAL_REQUIRED/);
    await t.rpc("select public.interschool_request_approval($1)", [open.id]);
    await err("select public.interschool_decide($1,true,null)", [open.id], /IS_NOT_AUTHORISED/);
    await t.as(ADMIN); await err("select public.interschool_decide($1,false,null)", [open.id], /IS_REASON_REQUIRED/);
    await t.rpc("select public.interschool_decide($1,true,null)", [open.id]);
    await t.as(staff(1));
    await t.rpc("select public.interschool_publish($1)", [open.id]);
  });
  it("requires a team size before team totals can be used", async () => {
    const c = await t.competition(ADMIN, { publish: false, settings: { school_scoring: "TEAM_TOTAL" } });
    expect((await t.rpc<any>("select public.interschool_check($1)", [c.id])).problems).toContain("IS_TEAM_SIZE_REQUIRED");
    await t.rpc("select public.interschool_update($1,$2)", [c.id, JSON.stringify({ max_per_level_per_school: 5 })]);
    await t.rpc("select public.interschool_publish($1)", [c.id]);
  });
  it("keeps rules and scoring frozen after publishing, and allows only safe changes", async () => {
    const c = await t.competition(ADMIN);
    await err("select public.interschool_update($1,$2)", [c.id, JSON.stringify({ school_scoring: "AVERAGE" })], /IS_FROZEN_AFTER_PUBLISH/);
    await err("select public.interschool_set_rounds($1,$2)", [c.divisions[0], JSON.stringify([t.round(1, SUBJECT.math7)])], /IS_FROZEN_AFTER_PUBLISH/);
    await err("select public.interschool_update($1,$2)", [c.id, JSON.stringify({ capacity: 10 })], /IS_CAPACITY_CANNOT_SHRINK/);
    await t.rpc("select public.interschool_update($1,$2)", [c.id, JSON.stringify({ capacity: 100, prizes: "A trophy" })]);
  });
  it("pauses, closes, cancels with a reason, and duplicates as a fresh draft", async () => {
    const c = await t.competition(ADMIN);
    await t.rpc("select public.interschool_set_status($1,'PAUSED')", [c.id]);
    await t.rpc("select public.interschool_set_status($1,'PUBLISHED')", [c.id]);
    await t.rpc("select public.interschool_set_status($1,'CLOSED')", [c.id]);
    await err("select public.interschool_set_status($1,'CANCELLED',null)", [c.id], /IS_REASON_REQUIRED/);
    await t.rpc("select public.interschool_set_status($1,'CANCELLED','Venue lost')", [c.id]);
    await err("select public.interschool_set_status($1,'PUBLISHED')", [c.id], /IS_INVALID_TRANSITION/);
    const copy = await t.rpc<any>("select public.interschool_duplicate($1)", [c.id]);
    const got = await t.rpc<any>("select public.interschool_manage_get($1)", [copy.id]);
    expect([got.status, got.divisions.length, got.divisions[0].rounds.length, got.opens_at]).toEqual(["DRAFT", 1, 1, null]);
  });
});

describe("school registration and capacity", () => {
  it("lets only invited, verified schools into an invitational competition", async () => {
    const c = await t.competition(ADMIN, { invite: [SCHOOLS[0], SCHOOLS[1]] });
    await err("select public.interschool_invite($1,$2)", [c.id, [UNVERIFIED_SCHOOL]], /IS_SCHOOL_NOT_VERIFIED/);
    await t.as(staff(3));
    await err("select public.interschool_school_respond($1,$2,true)", [c.id, SCHOOLS[2]], /IS_SCHOOL_NOT_INVITED/);
    await err("select public.interschool_school_respond($1,$2,true)", [c.id, SCHOOLS[0]], /IS_NOT_AUTHORISED/);
    await t.as(staff(1));
    expect((await t.rpc<any>("select public.interschool_school_respond($1,$2,true)", [c.id, SCHOOLS[0]])).status).toBe("REGISTERED");
    await t.as(staff(2));
    expect((await t.rpc<any>("select public.interschool_school_respond($1,$2,false)", [c.id, SCHOOLS[1]])).status).toBe("DECLINED");
    expect((await t.q<any>("select count(*)::int n from public.notifications where title='Competition invitation'"))[0].n).toBeGreaterThanOrEqual(2);
  });
  it("lets any verified school join an open one", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN" } });
    await t.as(staff(4));
    expect((await t.rpc<any>("select public.interschool_school_respond($1,$2,true)", [c.id, SCHOOLS[3]])).status).toBe("REGISTERED");
  });
  it("checks affiliation and class level; a school chosen at sign-up must be confirmed by the school", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN" } });
    const [d] = c.divisions;
    await t.as(learner(1, 8, 1));
    await err("select public.interschool_register($1,$2,$3)", [c.slug, d, SCHOOLS[0]], /IS_LEVEL_MISMATCH/);
    await t.as(learner(1, 7, 1));
    await err("select public.interschool_register($1,$2,$3)", [c.slug, d, SCHOOLS[1]], /IS_NOT_THIS_SCHOOL/);
    await err("select public.interschool_register($1,$2,null)", [c.slug, d], /IS_SCHOOL_REQUIRED/);
    expect((await t.rpc<any>("select public.interschool_register($1,$2,$3,'qr')", [c.slug, d, SCHOOLS[0]])).status).toBe("CONFIRMED");
    expect((await t.rpc<any>("select public.interschool_register($1,$2,$3)", [c.slug, d, SCHOOLS[0]])).already).toBe(true);
    await t.as(learner(1, 7, 7));
    const pending = await t.rpc<any>("select public.interschool_register($1,$2,$3)", [c.slug, d, SCHOOLS[0]]);
    expect(pending.status).toBe("PENDING");
    await t.as(staff(2));
    await err("select public.interschool_confirm_candidate($1,true)", [pending.candidate_id], /IS_NOT_AUTHORISED/);
    await t.as(staff(1));
    await t.rpc("select public.interschool_confirm_candidate($1,true)", [pending.candidate_id]);
    expect((await t.q<any>("select source from quizbox_interschool.candidates where user_id=$1 and competition_id=$2", [learner(1, 7, 1), c.id]))[0].source).toBe("QR");
  });
  it("allows one registration per learner, even across two divisions", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN" }, levels: [7] });
    await t.nominate(c.id, 1, c.divisions[0], [learner(1, 7, 1)]);
    const again = await t.nominate(c.id, 1, c.divisions[0], [learner(1, 7, 1), learner(1, 8, 1)]);
    expect(again.results.map((r) => r.ok)).toEqual([true, false]);
    expect((await t.q<any>("select count(*)::int n from quizbox_interschool.candidates where competition_id=$1", [c.id]))[0].n).toBe(1);
  });
  it("enforces the school, level, division, competition and school-count limits", async () => {
    const c = await t.competition(ADMIN, { levels: [7, 8], settings: { participation: "OPEN", max_per_school: 3, max_per_level_per_school: 2, capacity: 5, max_schools: 3 } });
    const [b7, b8] = c.divisions;
    const first = await t.nominate(c.id, 1, b7, [1, 2, 3].map((n) => learner(1, 7, n)));
    expect(first.results.map((r) => r.error ?? r.status)).toEqual(["CONFIRMED", "CONFIRMED", "IS_SCHOOL_LEVEL_FULL"]);
    const second = await t.nominate(c.id, 1, b8, [1, 2].map((n) => learner(1, 8, n)));
    expect(second.results.map((r) => r.error ?? r.status)).toEqual(["CONFIRMED", "IS_SCHOOL_ALLOCATION_FULL"]);
    expect((await t.q<any>("select count(*)::int n from public.notifications where title='School places are full'"))[0].n).toBeGreaterThanOrEqual(1);
    // other schools carry on until the whole competition is full
    const other = await t.nominate(c.id, 2, b7, [1, 2].map((n) => learner(2, 7, n)));
    expect(other.results.every((r) => r.ok)).toBe(true);
    await t.as(staff(3));
    await err("select public.interschool_nominate($1,$2,$3,$4)", [c.id, SCHOOLS[2], b7, [learner(3, 7, 1)]], /IS_COMPETITION_FULL/);
  });
  it("counts schools, and queues the rest when a waiting list is on", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN", max_schools: 1, capacity: 2, waitlist: true } });
    const [d] = c.divisions;
    await t.nominate(c.id, 1, d, [learner(1, 7, 1), learner(1, 7, 2)]);
    const third = await t.nominate(c.id, 1, d, [learner(1, 7, 3)]);
    expect(third.results[0].status).toBe("WAITLISTED");
    const second = await t.nominate(c.id, 2, d, [learner(2, 7, 1)]);
    expect(second.results[0].status).toBe("WAITLISTED");
    // withdrawing frees a place for the oldest waiting learner of a registered school
    const held = (await t.q<any>("select id from quizbox_interschool.candidates where competition_id=$1 and user_id=$2", [c.id, learner(1, 7, 1)]))[0].id;
    await t.as(learner(1, 7, 1)); await t.rpc("select public.interschool_withdraw($1)", [held]);
    const states = await t.q<any>("select user_id, status from quizbox_interschool.candidates where competition_id=$1 order by created_at", [c.id]);
    expect(states.find((s) => s.user_id === learner(1, 7, 3))?.status).toBe("CONFIRMED");
    expect(states.find((s) => s.user_id === learner(2, 7, 1))?.status).toBe("WAITLISTED");
  });
  it("replaces a learner before the lock and refuses changes after it", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN", capacity: 1 } });
    const [d] = c.divisions;
    const first = (await t.nominate(c.id, 1, d, [learner(1, 7, 1)])).results[0];
    await t.as(staff(2)); await err("select public.interschool_replace($1,$2)", [first.candidate_id, learner(1, 7, 2)], /IS_NOT_AUTHORISED/);
    await t.as(staff(1));
    await err("select public.interschool_replace($1,$2)", [first.candidate_id, learner(2, 7, 1)], /IS_NOT_THIS_SCHOOL/);
    const swapped = await t.rpc<any>("select public.interschool_replace($1,$2)", [first.candidate_id, learner(1, 7, 2)]);
    expect(swapped.status).toBe("CONFIRMED");
    await t.rpc("select public.interschool_lock_roster($1,$2)", [c.id, SCHOOLS[0]]);
    await err("select public.interschool_replace($1,$2)", [swapped.candidate_id, learner(1, 7, 3)], /IS_ROSTER_LOCKED/);
    await err("select public.interschool_withdraw($1)", [swapped.candidate_id], /IS_ROSTER_LOCKED/);
  });
  it("rejects registration before it opens, after it closes, when paused or cancelled", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN" } });
    const attempt = async (message: RegExp) => { await t.as(learner(1, 7, 4)); await err("select public.interschool_register($1,$2,$3)", [c.slug, c.divisions[0], SCHOOLS[0]], message); };
    await t.q("update quizbox_interschool.competitions set registration_opens_at=now()+interval '1 day' where id=$1", [c.id]); await attempt(/IS_REGISTRATION_NOT_OPEN/);
    await t.q("update quizbox_interschool.competitions set registration_opens_at=now()-interval '2 day', registration_closes_at=now()-interval '1 minute' where id=$1", [c.id]); await attempt(/IS_REGISTRATION_CLOSED/);
    expect((await t.rpc<any>("select public.interschool_public_get($1)", [c.slug])).registration).toBe("CLOSED");
    await t.q("update quizbox_interschool.competitions set registration_closes_at=now()+interval '1 day', status='PAUSED' where id=$1", [c.id]); await attempt(/IS_REGISTRATION_PAUSED/);
    await t.q("update quizbox_interschool.competitions set status='CANCELLED' where id=$1", [c.id]); await attempt(/IS_COMPETITION_CANCELLED/);
  });
  it("keeps managed learners out unless the owner allows school nominations", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN" } });
    expect((await t.nominate(c.id, 1, c.divisions[0], [MANAGED])).results[0].error).toBe("IS_MANAGED_LEARNER_NOT_ALLOWED");
    await t.setting("interschool.allow_managed_learners", true);
    expect((await t.nominate(c.id, 1, c.divisions[0], [MANAGED])).results[0].status).toBe("CONFIRMED");
    await t.setting("interschool.allow_managed_learners", false);
  });
  it("shows each school only its own learners; the organiser sees numbers", async () => {
    const c = await t.competition(staff(1), { host: SCHOOLS[0], invite: [SCHOOLS[0], SCHOOLS[1]] });
    await t.nominate(c.id, 2, c.divisions[0], [learner(2, 7, 1)]);
    await t.as(staff(1));
    await err("select public.interschool_school_roster($1,$2)", [c.id, SCHOOLS[1]], /IS_NOT_AUTHORISED/);
    await err("select public.interschool_school_learners($1,$2,$3)", [c.id, SCHOOLS[1], c.divisions[0]], /IS_NOT_AUTHORISED/);
    const monitor = JSON.stringify(await t.rpc("select public.interschool_registrations($1)", [c.id]));
    expect(monitor).toContain("School 2 Academy");
    expect(monitor).not.toContain("Learner271");
    expect(monitor).not.toContain(learner(2, 7, 1));
    await t.as(staff(2));
    expect(JSON.stringify(await t.rpc("select public.interschool_school_roster($1,$2)", [c.id, SCHOOLS[1]]))).toContain("Learner271");
  });
  it("publishes a public page without learner details, and lists only what an administrator lists", async () => {
    const c = await t.competition(ADMIN, { settings: { participation: "OPEN", title: "Listed cup" } });
    await t.nominate(c.id, 1, c.divisions[0], [learner(1, 7, 1)]);
    await t.as(null);
    await err("select public.interschool_public_get($1)", [c.slug], /permission denied/);
    await t.as("service");
    const page = await t.rpc<any>("select public.interschool_public_get($1)", [c.slug]);
    expect([page.registration, page.places_left, page.divisions[0].subjects]).toEqual(["OPEN", 99, ["Mathematics"]]);
    expect(JSON.stringify(page)).not.toContain("Learner");
    expect((await t.rpc<any[]>("select public.interschool_public_list()")).map((x) => x.slug)).not.toContain(c.slug);
    await t.rpc("select public.interschool_track($1,'view','qr')", [c.slug]);
    await t.as(ADMIN); await t.rpc("select public.interschool_set_listed($1,true)", [c.id]);
    expect((await t.rpc<any[]>("select public.interschool_public_list()")).map((x) => x.slug)).toContain(c.slug);
    expect((await t.rpc<any>("select public.interschool_registrations($1)", [c.id])).views).toEqual({ QR: 1 });
  });
});

describe("joining", () => {
  it("offers a learner only their own schools and the divisions for their level", async () => {
    const c = await t.competition(ADMIN, { levels: [7, 8], settings: { participation: "OPEN", title: "Join cup" } });
    await t.as(learner(2, 8, 1));
    const o = await t.rpc<any>("select public.interschool_join_options($1)", [c.slug]);
    expect([o.level, o.divisions.map((d: any) => d.title), o.schools.map((s: any) => [s.name, s.verified_member, s.can_enter]), o.mine]).toEqual(["B8", ["Basic 8"], [["School 2 Academy", true, true]], null]);
    await t.rpc("select public.interschool_register($1,$2,$3)", [c.slug, c.divisions[1], SCHOOLS[1]]);
    expect((await t.rpc<any>("select public.interschool_join_options($1)", [c.slug])).mine).toEqual({ status: "CONFIRMED", division: "Basic 8" });
  });
});

describe("on a database that grants new functions and tables to everyone by default (as Supabase does)", () => {
  it("still leaves browsers only the calls meant for them", async () => {
    const hosted = new PGlite();
    const base = baseSql(), at = base.indexOf("create table public.profiles");
    await hosted.exec(base.slice(0, at) + "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role; alter default privileges grant execute on functions to anon, authenticated, service_role; alter default privileges grant all on tables to anon, authenticated, service_role;\n" + base.slice(at));
    for (const m of MIGRATIONS) await hosted.exec(migration(m));
    const open = async (role: string) => (await hosted.query<{ f: string }>("select p.proname as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'interschool%' and has_function_privilege($1, p.oid, 'execute') order by 1", [role])).rows.map((r) => r.f);
    expect(await open("anon")).toEqual([]);
    const signedIn = await open("authenticated");
    for (const serverOnly of ["interschool_payment_apply", "interschool_payment_status", "interschool_send_reminders", "interschool_track"]) expect(signedIn).not.toContain(serverOnly);
    expect(signedIn).toContain("interschool_register");
    const reachable = await hosted.query<{ n: number }>("select count(*)::int n from pg_tables where schemaname='quizbox_interschool' and (has_schema_privilege('authenticated', schemaname, 'usage') or has_table_privilege('authenticated', schemaname||'.'||tablename, 'select') or has_table_privilege('anon', schemaname||'.'||tablename, 'select'))");
    expect(reachable.rows[0].n).toBe(0);
    await hosted.close();
  });
});
