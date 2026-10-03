import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "../competition/fixtures/database";

// Fixture users: id(2) OWNER (Super Admin), id(3) teacher, id(4)/id(6) students, id(1)/id(5) sponsors.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
async function as(user: string | null) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); }
const rpc = async <T = any>(sql: string, args: unknown[] = []) => (await db.query<{ v: T }>(`select ${sql} v`, args)).rows[0].v;

describe("platform operations over the isolated governance SQL", () => {
  const curriculum = randomUUID(), cls = randomUUID(), cls2 = randomUUID(), membership = randomUUID(), assignment = randomUUID(), inst = randomUUID(), question = randomUUID();
  beforeAll(async () => {
    ({ db } = await createDeliveryFixture());
    await db.exec("reset role; set session_replication_role=replica");
    const ghana = (await db.query<{ id: string }>("select id from markets where name='Ghana'")).rows[0].id;
    const authority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [ghana])).rows[0].id;
    await db.query("insert into curricula(id,code,country,market_id) values($1,'GH-OPS','Ghana',$2)", [curriculum, ghana]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [curriculum, ghana, authority]);
    await db.query("insert into institutions(id,name) values($1,'Fixture School')", [inst]);
    await db.query("insert into institution_memberships(institution_id,user_id,role) values($1,$2,'admin'),($1,$3,'teacher')", [inst, id(3), id(2)]);
    await db.query("insert into classes(id,class_name,institution_id,teacher_user_id,status,curriculum_id) values($1,'Class A',$3,$4,'active',$5),($2,'Class B',$3,$4,'active',$5)", [cls, cls2, inst, id(3), curriculum]);
    await db.query("insert into class_memberships(id,class_id,student_user_id,student_name,status) values($1,$2,$3,'Fixture Student','active')", [membership, cls, id(4)]);
    await db.query("insert into assignments(id,class_id,status,teacher_user_id,title) values($1,$2,'published',$3,'Fractions homework')", [assignment, cls, id(3)]);
    await db.query("insert into questions(id,subject_code,subject_name,grade,question_text,option_a,option_b,option_c,option_d,correct_answer) values($1,'Science','Science','B10','Q','A','B','C','D','A')", [question]);
    await db.exec("set session_replication_role=origin");
    await db.query("insert into assignment_targets(assignment_id,student_user_id,membership_id,status) values($1,$2,$3,'active')", [assignment, id(4), membership]);
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("raises an in-app notification for the targeted student only", async () => {
    await as(id(4)); const mine = await rpc("public.qb_notifications('list','{}'::jsonb)");
    expect(mine.items).toEqual([expect.objectContaining({ type: "ASSIGNMENT_CREATED", title: "New assignment: Fractions homework", link: "/student/assessments", read: false })]);
    await as(id(6)); expect((await rpc("public.qb_notifications('list','{}'::jsonb)")).items).toEqual([]);
    await rpc("public.qb_notifications('mark_read',$1::jsonb)", [JSON.stringify({ id: mine.items[0].id })]);
    await as(id(4)); expect((await rpc("public.qb_notifications('list','{}'::jsonb)")).unread).toBe(1);
    await rpc("public.qb_notifications('mark_all_read','{}'::jsonb)"); expect((await rpc("public.qb_notifications('list','{}'::jsonb)")).unread).toBe(0);
  });

  it("restricts privileged operations to their roles", async () => {
    await as(id(4));
    await expect(rpc("public.qb_admin_ops('lookup','{\"query\":\"fixture\"}'::jsonb)")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await expect(rpc("public.qb_content_quality('summary','{}'::jsonb)")).rejects.toThrow("QB_CONTENT_ACCESS_DENIED");
    await expect(rpc("public.qb_platform_insights()")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await expect(rpc("public.qb_school('overview',$1::jsonb)", [JSON.stringify({ institution_id: inst })])).rejects.toThrow("QB_SCHOOL_ADMIN_REQUIRED");
    await expect(rpc("public.qb_report_question($1,'The answer is wrong')", [question])).rejects.toThrow("QB_REPORT_REQUIRES_ATTEMPT");
  });

  it("audits Super Admin lookups and status changes", async () => {
    await as(id(2));
    expect(await rpc("public.qb_admin_ops('lookup','{\"query\":\"Fixture\"}'::jsonb)")).toEqual(expect.any(Array));
    await rpc("public.qb_admin_ops('set_user_status',$1::jsonb)", [JSON.stringify({ id: id(6), status: "inactive" })]);
    await expect(rpc("public.qb_admin_ops('set_user_status',$1::jsonb)", [JSON.stringify({ id: id(2), status: "inactive" })])).rejects.toThrow("INVALID_USER_STATUS");
    const trail = await rpc<Array<{ action: string }>>("public.qb_admin_ops('audit_trail','{\"action\":\"QB_ADMIN\"}'::jsonb)");
    expect(trail.map(a => a.action)).toEqual(expect.arrayContaining(["QB_ADMIN_LOOKUP", "QB_ADMIN_SET_USER_STATUS"]));
    await db.exec("reset role"); await db.query("update profiles set status='active' where id=$1", [id(6)]);
  });

  it("flags questions into the quality queue without changing them", async () => {
    await db.exec("reset role"); const before = (await db.query("select question_text,validation_status from questions where id=$1", [question])).rows[0];
    await as(id(2));
    await rpc("public.qb_content_quality('flag',$1::jsonb)", [JSON.stringify({ question_id: question, reason: "Low accuracy" })]);
    const queue = await rpc<Array<{ question_id: string; type: string }>>("public.qb_content_quality('queue','{}'::jsonb)");
    expect(queue).toEqual([expect.objectContaining({ question_id: question, type: "QUALITY_REVIEW" })]);
    await db.exec("reset role"); expect((await db.query("select question_text,validation_status from questions where id=$1", [question])).rows[0]).toEqual(before);
  });

  it("lets a school admin archive classes and transfer students with history", async () => {
    await as(id(3));
    expect((await rpc("public.qb_school('overview',$1::jsonb)", [JSON.stringify({ institution_id: inst })])).classes).toHaveLength(2);
    await rpc("public.qb_school('transfer_student',$1::jsonb)", [JSON.stringify({ class_id: cls, membership_id: membership, to_class_id: cls2 })]);
    await db.exec("reset role");
    const rows = (await db.query<{ class_id: string; status: string; left: boolean }>("select class_id,status::text status,left_at is not null left from class_memberships where student_user_id=$1 order by joined_at", [id(4)])).rows;
    expect(rows).toEqual([{ class_id: cls, status: "inactive", left: true }, { class_id: cls2, status: "active", left: false }]);
    await as(id(3)); await rpc("public.qb_school('archive_class',$1::jsonb)", [JSON.stringify({ class_id: cls })]);
    await as(id(6)); await expect(rpc("public.qb_school('archive_class',$1::jsonb)", [JSON.stringify({ class_id: cls2 })])).rejects.toThrow("QB_SCHOOL_ADMIN_REQUIRED");
  });

  it("records anonymous auth failures without identifiers", async () => {
    await as(null); await rpc("public.qb_auth_failure('invalid_credentials')");
    await db.exec("reset role"); const ev = (await db.query<{ details: Record<string, string> }>("select details from system_events where event_type='AUTH_FAILURE'")).rows;
    expect(ev).toEqual([{ details: { code: "invalid_credentials" } }]);
  });

  it("serves role home payloads", async () => {
    await as(id(4)); expect((await rpc<{ role: string; sections: Array<{ key: string }> }>("public.qb_home()")).sections.map(s => s.key)).toEqual(expect.arrayContaining(["profile", "due", "results"]));
    await as(id(2)); expect((await rpc<{ role: string }>("public.qb_home()")).role).toBe("super_admin");
  });
});
