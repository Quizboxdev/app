import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Repeat-weekly assignments and due-soon reminders (20261067100000), on an isolated PostgreSQL. The publisher is a recorder that notes who it was
// called as, so the test shows the runner acts as the teacher. Everything is closed until flags.repeat_assignments is on.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261067100000_repeat_assignments.sql");
const ROLLBACK = read("../../supabase/rollback/repeat_assignments.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TEACHER = id(30), OTHER = id(31), CLASS = id(40), OTHER_CLASS = id(41);
const learner = (n: number) => id(100 + n);
let db: PGlite;
const as = async (user: string | null, role: "authenticated" | "service_role" | "anon" = "authenticated") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
};
const admin = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); };
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const setFlag = async (on: boolean) => { await admin(); await db.query("update public.platform_settings set value = $1::jsonb where key = 'flags.repeat_assignments'", [JSON.stringify(on)]); };
const sections = (extra = "") => JSON.stringify([{ subject: "Science", quota: 10 + (extra ? 0 : 0), ...(extra ? { note: extra } : {}) }, { subject: "Mathematics", quota: 5 }]);
const create = (cls = CLASS, secs = sections(), over: { dow?: number; time?: string; days?: number; title?: string } = {}) =>
  one("select public.qb_schedule_create($1,$2,'Do your best',$3::jsonb,null,'PRACTICE',2,25,$4,$5,$6) v", [cls, over.title ?? "Weekly check", secs, over.dow ?? 5, over.time ?? "16:00", over.days ?? 3]).then((r) => r.v as { id: string; next_run_at: string });
const makeDue = async (sid: string, ago = "1 minute") => { await admin(); await db.query(`update public.assignment_schedules set next_run_at = now() - interval '${ago}' where id = $1`, [sid]); };
const run = async () => { await as(null, "service_role"); const v = (await one("select public.qb_schedules_run(50) v")).v; await admin(); return v as { enabled: boolean; published: number; skipped: number; missed: number }; };
const remind = async () => { await as(null, "service_role"); const v = (await one("select public.qb_assignment_reminders_run() v")).v; await admin(); return v as { enabled: boolean; assignments: number; reminders: number }; };
const notes = async (user: string, type: string) => Number((await one("select count(*) n from public.notes where user_id = $1 and type = $2", [user, type])).n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key);
    create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'));
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql stable security definer set search_path = '' as $$
      select coalesce((select value from public.platform_settings where key = p_key and scope_type = 'global') = 'true'::jsonb, false) $$;
    create table public.classes(id uuid primary key, teacher_user_id uuid, class_name text);
    create table public.assignments(id uuid primary key default gen_random_uuid(), title text, status text default 'published', due_at timestamptz, published_at timestamptz, created_at timestamptz default now());
    create table public.class_memberships(id uuid primary key default gen_random_uuid(), class_id uuid, student_user_id uuid);
    create table public.assignment_targets(id uuid primary key default gen_random_uuid(), assignment_id uuid, membership_id uuid, status text default 'active');
    create table public.attempts(id uuid primary key default gen_random_uuid(), assignment_id uuid, student_user_id uuid, submitted_at timestamptz);
    create table public.notes(user_id uuid, type text, title text, message text, link text);
    create schema quizbox_ops;
    create function quizbox_ops.notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_entity_type text default null, p_entity uuid default null, p_market uuid default null)
      returns void language sql as $$ insert into public.notes values (p_user, p_type, p_title, p_message, p_link) $$;
    create schema quizbox_topic;
    create function quizbox_topic.class_for_teacher(p_class uuid) returns public.classes language plpgsql stable security definer set search_path = '' as $$
      declare c public.classes; begin select * into c from public.classes where id = p_class;
        if c.id is null then raise exception 'CLASS_NOT_FOUND'; end if;
        if c.teacher_user_id is distinct from auth.uid() then raise exception 'CLASS_ACCESS_DENIED' using errcode = '42501'; end if; return c; end $$;
    create function quizbox_topic.blueprint_plan(p_class uuid, p_sections jsonb, p_difficulty text) returns jsonb language plpgsql as $$
      begin if p_sections::text like '%SHORT%' then raise exception 'QB_TOPIC_SHORT: Energy has 2 available, 5 needed'; end if; return '{}'::jsonb; end $$;
    create table public.pub_capture(uid uuid, class_id uuid, title text, mode text, attempts int, minutes int, start_at timestamptz, due_at timestamptz, assignment_id uuid);
    create function public.qb_publish_blueprint_assignment(p_class_id uuid, p_title text, p_description text, p_sections jsonb, p_difficulty text, p_mode text, p_attempts_allowed integer,
      p_time_limit_minutes integer, p_start_at timestamptz, p_due_at timestamptz, p_target_student_ids uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare a uuid := gen_random_uuid();
      begin
        if p_sections::text like '%FAIL%' then raise exception 'QB_TOPIC_SHORT: Energy has 2 available, 5 needed'; end if;
        insert into public.assignments(id, title, due_at, published_at) values (a, p_title, p_due_at, p_start_at);
        insert into public.pub_capture values (auth.uid(), p_class_id, p_title, p_mode, p_attempts_allowed, p_time_limit_minutes, p_start_at, p_due_at, a);
        return jsonb_build_object('assignment_id', a, 'status', 'PUBLISHED');
      end $$;
    insert into public.profiles values ('${TEACHER}'), ('${OTHER}');
    insert into public.classes values ('${CLASS}', '${TEACHER}', 'Class 7A'), ('${OTHER_CLASS}', '${OTHER}', 'Class 8B');
  `);
  await db.exec(MIGRATION);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("while the flag is off (the default)", () => {
  it("seeds the flag as false and refuses to create, run or remind", async () => {
    await admin();
    expect((await one("select value from public.platform_settings where key = 'flags.repeat_assignments'")).value).toBe(false);
    await as(TEACHER);
    await expect(create()).rejects.toThrow(/QB_FEATURE_DISABLED/);
    await admin();
    // A schedule that somehow exists and is due still does nothing, and nobody is reminded.
    await db.query("insert into public.assignment_schedules(teacher_user_id, class_id, title, sections, publish_dow, next_run_at) values ($1,$2,'x','[{\"subject\":\"Science\",\"quota\":5}]',5, now() - interval '1 minute')", [TEACHER, CLASS]);
    expect(await run()).toMatchObject({ enabled: false, published: 0 });
    expect(Number((await one("select count(*) n from public.pub_capture")).n)).toBe(0);
    await db.query("insert into public.assignments(id,title,due_at,published_at) values ($1,'Due soon', now() + interval '5 hours', now() - interval '3 hours')", [id(500)]);
    expect(await remind()).toMatchObject({ enabled: false, reminders: 0 });
    await db.exec("delete from public.assignment_schedules; delete from public.assignments;");
  });
});

describe("a teacher's schedules", () => {
  beforeAll(async () => { await setFlag(true); });

  it("closes the table to the browser and the runner to everyone but the service", async () => {
    await as(TEACHER);
    await expect(one("select * from public.assignment_schedules")).rejects.toThrow(/permission denied/);
    await expect(one("select public.qb_schedules_run(5)")).rejects.toThrow(/permission denied/);
    await expect(one("select public.qb_assignment_reminders_run()")).rejects.toThrow(/permission denied/);
    await as(null, "anon");
    await expect(one("select public.qb_schedule_list()")).rejects.toThrow(/permission denied/);
  });

  it("creates a schedule whose first run is the right weekday and time, at least a day away", async () => {
    await as(TEACHER);
    const made = await create();
    await admin();
    const row = await one(`select extract(isodow from next_run_at at time zone 'Africa/Accra')::int dow, to_char(next_run_at at time zone 'Africa/Accra','HH24:MI') hm,
      next_run_at > now() + interval '23 hours' later, next_run_at < now() + interval '9 days' soon from public.assignment_schedules where id = $1`, [made.id]);
    expect(row).toMatchObject({ dow: 5, hm: "16:00", later: true, soon: true });
    await db.query("delete from public.assignment_schedules where id = $1", [made.id]);
  });

  it("refuses another teacher's class, a bad time, a short topic, and a sixth active schedule", async () => {
    await as(TEACHER);
    await expect(create(OTHER_CLASS)).rejects.toThrow(/CLASS_ACCESS_DENIED/);
    await expect(create(CLASS, sections(), { time: "teatime" })).rejects.toThrow(/INVALID_SCHEDULE_TIME/);
    await expect(create(CLASS, sections("SHORT"))).rejects.toThrow(/QB_TOPIC_SHORT: Energy/);
    for (let i = 0; i < 5; i++) await create(CLASS, sections(), { title: `Week ${i}` });
    await expect(create()).rejects.toThrow(/QB_SCHEDULE_LIMIT/);
    await as(OTHER);
    expect(((await one("select public.qb_schedule_list() v")).v as unknown[]).length).toBe(0);     // another teacher sees none of them
    await as(TEACHER);
    const list = (await one("select public.qb_schedule_list() v")).v as Array<{ subjects: string[]; total: number; publish_time: string; class_name: string }>;
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ subjects: ["Science", "Mathematics"], total: 15, publish_time: "16:00", class_name: "Class 7A" });
    await admin(); await db.exec("delete from public.assignment_schedules");
  });

  it("pauses, resumes without replaying missed weeks, and deletes only its own", async () => {
    await as(TEACHER);
    const { id: sid } = await create();
    await one("select public.qb_schedule_set_active($1, false)", [sid]);
    await makeDue(sid, "3 days");
    expect(await run()).toMatchObject({ published: 0, missed: 0 });                                       // paused: never run
    await as(TEACHER);
    await one("select public.qb_schedule_set_active($1, true)", [sid]);
    await admin();
    expect((await one("select next_run_at > now() n from public.assignment_schedules where id = $1", [sid])).n).toBe(true);
    await as(OTHER);
    await expect(one("select public.qb_schedule_delete($1)", [sid])).rejects.toThrow(/NOT_FOUND/);
    await expect(one("select public.qb_schedule_set_active($1, false)", [sid])).rejects.toThrow(/NOT_FOUND/);
    await as(TEACHER);
    await one("select public.qb_schedule_delete($1)", [sid]);
    await admin();
    expect(Number((await one("select count(*) n from public.assignment_schedules")).n)).toBe(0);
  });
});

describe("the weekly runner", () => {
  beforeAll(async () => { await setFlag(true); await admin(); await db.exec("delete from public.assignment_schedules; delete from public.pub_capture; delete from public.notes;"); });

  it("publishes a due schedule as the teacher, advances it to the next matching weekday, tells the teacher, and leaves the caller's identity as it found it", async () => {
    await as(TEACHER);
    const { id: sid } = await create(CLASS, sections(), { days: 4, title: "Friday drill" });
    await makeDue(sid);
    await as(null, "service_role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    const out = (await one("select public.qb_schedules_run(50) v")).v;
    expect((await one("select current_setting('request.jwt.claim.sub', true) s")).s).toBe("");          // restored
    await admin();
    expect(out).toMatchObject({ enabled: true, published: 1, skipped: 0, missed: 0 });
    const pub = await one("select * from public.pub_capture");
    expect(pub.uid).toBe(TEACHER);                                                                       // it acted as the teacher
    expect(pub).toMatchObject({ class_id: CLASS, mode: "PRACTICE", attempts: 2, minutes: 25 });
    expect(pub.title).toMatch(/^Friday drill · \d{2} [A-Z][a-z]{2}$/);
    expect(Math.round((new Date(pub.due_at).getTime() - new Date(pub.start_at).getTime()) / 86_400_000)).toBe(4);
    const s = await one(`select last_status, runs, fail_streak, last_assignment_id = $2 linked, next_run_at > now() later, next_run_at < now() + interval '8 days' soon,
      extract(isodow from next_run_at at time zone 'Africa/Accra')::int dow from public.assignment_schedules where id = $1`, [sid, pub.assignment_id]);
    expect(s).toMatchObject({ last_status: "PUBLISHED", runs: 1, fail_streak: 0, linked: true, later: true, soon: true, dow: 5 });
    expect(await notes(TEACHER, "ASSIGNMENT_SCHEDULE")).toBe(1);
    expect(await run()).toMatchObject({ published: 0 });                                                 // already advanced: a second tick sends nothing
    await db.exec("delete from public.assignment_schedules");
  });

  it("skips a week that cannot be published, tells the teacher why, and pauses after three in a row", async () => {
    await as(TEACHER);
    const { id: sid } = await create();
    await admin();
    await db.query(`update public.assignment_schedules set sections = '[{"subject":"Science","quota":5,"note":"FAIL"}]' where id = $1`, [sid]);
    await db.exec("delete from public.notes; delete from public.pub_capture");
    for (let week = 1; week <= 3; week++) {
      await makeDue(sid);
      expect(await run()).toMatchObject({ published: 0, skipped: 1 });
      const s = await one("select active, fail_streak, last_status, last_error from public.assignment_schedules where id = $1", [sid]);
      expect(s).toMatchObject({ fail_streak: week, last_status: "SKIPPED", active: week < 3 });
      expect(s.last_error).toMatch(/QB_TOPIC_SHORT: Energy/);
    }
    expect(Number((await one("select count(*) n from public.pub_capture")).n)).toBe(0);                  // nothing half-published
    expect(await notes(TEACHER, "ASSIGNMENT_SCHEDULE")).toBe(3);
    expect((await one("select message from public.notes order by ctid desc limit 1")).message).toMatch(/now paused/);
    await makeDue(sid);
    expect(await run()).toMatchObject({ skipped: 0 });                                                   // paused: no fourth try
    // Fixing it and resuming starts clean.
    await db.query(`update public.assignment_schedules set sections = '[{"subject":"Science","quota":5}]' where id = $1`, [sid]);
    await as(TEACHER); await one("select public.qb_schedule_set_active($1, true)", [sid]); await admin();
    expect(await one("select fail_streak, last_error, active from public.assignment_schedules where id = $1", [sid])).toMatchObject({ fail_streak: 0, last_error: null, active: true });
    await db.exec("delete from public.assignment_schedules");
  });

  it("does not send a stale assignment when the runner was down for more than a day", async () => {
    await as(TEACHER);
    const { id: sid } = await create();
    await makeDue(sid, "2 days");
    await db.exec("delete from public.pub_capture");
    expect(await run()).toMatchObject({ published: 0, missed: 1 });
    expect(Number((await one("select count(*) n from public.pub_capture")).n)).toBe(0);
    expect(await one("select last_status, next_run_at > now() n from public.assignment_schedules where id = $1", [sid])).toMatchObject({ last_status: "MISSED", n: true });
    await db.exec("delete from public.assignment_schedules");
  });
});

describe("due-soon reminders", () => {
  const a = { soon: id(501), later: id(502), fresh: id(503) };
  beforeAll(async () => {
    await setFlag(true); await admin();
    await db.exec("delete from public.notes; delete from public.assignments;");
    await db.query(`insert into public.assignments(id,title,due_at,published_at) values
      ($1,'Fractions drill', now() + interval '10 hours', now() - interval '3 hours'),
      ($2,'Next week', now() + interval '48 hours', now() - interval '3 hours'),
      ($3,'Just published', now() + interval '10 hours', now() - interval '10 minutes')`, [a.soon, a.later, a.fresh]);
    for (let n = 1; n <= 3; n++) {
      const m = id(600 + n);
      await db.query("insert into public.class_memberships(id, class_id, student_user_id) values ($1,$2,$3)", [m, CLASS, learner(n)]);
      for (const x of Object.values(a)) await db.query("insert into public.assignment_targets(assignment_id, membership_id) values ($1,$2)", [x, m]);
    }
    await db.query("insert into public.attempts(assignment_id, student_user_id, submitted_at) values ($1,$2,now())", [a.soon, learner(3)]);   // learner 3 has handed in
    await db.query("insert into public.attempts(assignment_id, student_user_id, submitted_at) values ($1,$2,null)", [a.soon, learner(2)]);     // learner 2 only started
  });

  it("reminds each learner who has not handed in, once, and only for work due within a day", async () => {
    expect(await remind()).toEqual({ enabled: true, assignments: 1, reminders: 2 });
    expect(await notes(learner(1), "ASSIGNMENT_DUE_SOON")).toBe(1);
    expect(await notes(learner(2), "ASSIGNMENT_DUE_SOON")).toBe(1);                                      // an unsubmitted attempt does not count as done
    expect(await notes(learner(3), "ASSIGNMENT_DUE_SOON")).toBe(0);                                      // handed in
    const n = await one("select title, message, link from public.notes where user_id = $1", [learner(1)]);
    expect(n).toMatchObject({ title: "Due soon: Fractions drill", link: "/student/assessments" });
    expect(n.message).toMatch(/^Due [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{2}:\d{2}\. It is not finished yet\.$/);
    expect(await remind()).toMatchObject({ assignments: 0, reminders: 0 });                              // never twice
    expect(Number((await one("select recipients from public.assignment_reminders_sent where assignment_id = $1", [a.soon])).recipients)).toBe(2);
  });
});

describe("reversal", () => {
  it("removes everything it added, leaves ordinary assignments alone, and can be applied again", async () => {
    await admin();
    const before = Number((await one("select count(*) n from public.assignments")).n);
    await db.exec(ROLLBACK);
    expect((await one("select to_regclass('public.assignment_schedules') s, to_regclass('public.assignment_reminders_sent') r, to_regproc('public.qb_schedules_run') f")).s).toBeNull();
    expect(Number((await one("select count(*) n from public.platform_settings where key = 'flags.repeat_assignments'")).n)).toBe(0);
    expect(Number((await one("select count(*) n from public.assignments")).n)).toBe(before);
    await db.exec(ROLLBACK);                                                                             // a second rollback is harmless
    await db.exec(MIGRATION); await db.exec(MIGRATION);                                                  // and the migration is safe to run twice
    expect((await one("select value from public.platform_settings where key = 'flags.repeat_assignments'")).value).toBe(false);
  });
});
