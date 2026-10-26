import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Partner Access Gateway, phase 1 (isolated PostgreSQL): licences, seats, credentials, inbound-event idempotency, SSO linking and the entitlement hook.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261049100000_partner_access_gateway.sql");
const ROLLBACK = read("../../supabase/rollback/partner_access_gateway.sql");
const MIGRATION2 = read("../../supabase/migrations/20261049200000_partner_gateway_server_layer.sql");
const ROLLBACK2 = read("../../supabase/rollback/partner_gateway_server_layer.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, ADMIN, ADMIN2, TEACHER, S1, S2, S3, MINOR, MANAGED, OTHER] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id);
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const server = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); await db.exec("set role service_role"); };
const one = async (q: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(q, params)).rows[0] ?? {})[0] as any;
const fails = async (q: string, params: unknown[], m: RegExp) => { await expect(db.query(q, params)).rejects.toThrow(m); };
const sql = async (q: string, params: unknown[] = []) => { await db.exec("reset role"); return (await db.query<Record<string, any>>(q, params)).rows; };
const flag = async (on: boolean) => { await sql("update public.platform_settings set value = $1::jsonb where key = 'flags.partner_access_gateway_v1'", [JSON.stringify(on)]); };
const hasSub = async (u: string) => (await sql("select public.qb_has_subscription($1) as v", [u]))[0].v as boolean;

let seq = 300;
const fresh = async () => { const u = id(++seq); await sql("insert into public.profiles values ($1,'STUDENT','active','Fresh','f@example.com')", [u]); return u; };

// Staff set up a verified partner with an ACTIVE contract (approved by a second person).
async function activePartner(name: string, seats = 3, o: { starts?: string; expires?: string; kind?: string } = {}) {
  await as(ADMIN);
  const p = await one("select public.qb_admin_partner_save(null,$1,$2,'GH')", [name, o.kind ?? "school"]);
  await db.query("select public.qb_admin_partner_set_status($1,'verified','Checked registration documents')", [p.id]);
  const c = await one("select public.qb_admin_partner_contract_save(null,$1,'basic-annual',array['practice'],'GH','{}','{}',$2::date,$3::date,$4,'INV-001')", [p.id, o.starts ?? day(-1), o.expires ?? day(30), seats]);
  await db.query("select public.qb_admin_partner_contract_submit($1)", [c.id]);
  await as(ADMIN2);
  await db.query("select public.qb_admin_partner_contract_approve($1,'Invoice INV-001 paid, checked by finance')", [c.id]);
  return { partner: p.id as string, contract: c.id as string };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, is_minor boolean not null default false, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.audit_logs(id bigint generated always as identity primary key, actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
    create schema quizbox_core;
    create function quizbox_core.setting(p_key text) returns jsonb language sql stable as $$ select value from public.platform_settings where key = p_key and scope_type = 'global' $$;
    create function quizbox_core.flag(p_key text) returns boolean language sql stable as $$ select coalesce(quizbox_core.setting(p_key) = 'true'::jsonb, false) $$;
    create function quizbox_core.is_staff(p_roles text[] default array['super_admin']) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and (exists(select 1 from public.profiles where id = auth.uid() and lower(role) = 'owner') or exists(select 1 from public.user_capabilities where user_id = auth.uid() and active and capability = any(p_roles))) $$;
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql security definer as $$
      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    grant usage on schema quizbox_core to anon, authenticated, service_role; grant execute on all functions in schema quizbox_core to anon, authenticated, service_role;
    create table public.learner_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid, status text not null default 'active', valid_from timestamptz not null default now(), valid_until timestamptz not null default now() + interval '30 days');
    -- the access chokepoint exactly as it was before this release
    create function public.qb_has_subscription(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
      select exists (select 1 from public.learner_subscriptions s where s.user_id = p_user and s.status = 'active' and s.valid_from <= now() and s.valid_until > now()) $fn$;
    insert into public.profiles values ('${OWNER}','OWNER','active','Owner','o@example.com'),('${ADMIN}','ADMIN','active','Admin One','a1@example.com'),('${ADMIN2}','ADMIN','active','Admin Two','a2@example.com'),
      ('${TEACHER}','TEACHER','active','Teacher','t@example.com'),('${S1}','STUDENT','active','S1','s1@example.com'),('${S2}','STUDENT','active','S2','s2@example.com'),('${S3}','STUDENT','active','S3','s3@example.com'),
      ('${MINOR}','STUDENT','active','Minor','m@example.com'),('${MANAGED}','STUDENT','active','Managed','mm@example.com'),('${OTHER}','STUDENT','active','Other','x@example.com');
    insert into public.student_profiles(user_id, is_minor, managed_by) values ('${MINOR}', true, null), ('${MANAGED}', true, '${TEACHER}');
    insert into public.user_capabilities values ('${ADMIN}','super_admin',true),('${ADMIN2}','super_admin',true);
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION2);
});
afterAll(async () => { await db.close(); });

describe("closed by default", () => {
  it("the flag is off and the tables are shut to every browser role", async () => {
    expect(await one("select value from public.platform_settings where key='flags.partner_access_gateway_v1'")).toBe(false);
    await as(ADMIN);
    await fails("select * from public.partners", [], /permission denied/);
    await fails("select * from public.partner_seats", [], /permission denied/);
    await as(null);
    await fails("select public.qb_admin_partners_overview()", [], /permission denied/);
  });
  it("only a super admin can use the admin functions", async () => {
    await as(TEACHER);
    await fails("select public.qb_admin_partner_save(null,'Nope School','school','GH')", [], /QB_NOT_AUTHORIZED/);
    await fails("select public.qb_admin_partners_overview()", [], /QB_NOT_AUTHORIZED/);
    await as(S1);
    await fails("select public.qb_admin_partner_credential_issue($1,array['licence:read'])", [id(99)], /QB_NOT_AUTHORIZED/);
  });
  it("a signed-in browser cannot call the partner functions", async () => {
    await as(ADMIN);
    await fails("select public.qb_partner_seat_allocate($1,$2,'x',null)", [id(1), id(2)], /permission denied/);
    await fails("select public.qb_partner_credential_verify('qbpk_xxxxxxxxxxxxxxxxxxxxxxxx')", [], /permission denied/);
  });
  it("with the flag off nothing a partner can do works and access is unchanged", async () => {
    await flag(false);
    const { partner, contract } = await activePartner("Flag Off School");
    await server();
    await fails("select public.qb_partner_seat_allocate($1,$2,'e1',$3)", [partner, contract, S1], /QB_FEATURE_DISABLED/);
    expect(await hasSub(S1)).toBe(false);
  });
});

describe("contract lifecycle (commercial approval is a QuizBox decision)", () => {
  it("needs a verified partner, a billing reference, a note and a second approver", async () => {
    await flag(true);
    await as(ADMIN);
    const p = await one("select public.qb_admin_partner_save(null,'Lifecycle Co','company','GH')");
    await fails("select public.qb_admin_partner_set_status($1,'verified','')", [p.id], /QB_NOTE_REQUIRED/);
    const c = await one("select public.qb_admin_partner_contract_save(null,$1,'pkg',array['practice'],'GH','{}','{}',$2::date,$3::date,5,null)", [p.id, day(0), day(10)]);
    await db.query("select public.qb_admin_partner_contract_submit($1)", [c.id]);
    await fails("select public.qb_admin_partner_contract_approve($1,'ok')", [c.id], /QB_PARTNER_NOT_VERIFIED/);
    await db.query("select public.qb_admin_partner_set_status($1,'verified','docs checked')", [p.id]);
    await fails("select public.qb_admin_partner_contract_approve($1,'ok')", [c.id], /QB_BILLING_REFERENCE_REQUIRED/);
    await db.query("select public.qb_admin_partner_contract_save($1,$2,'pkg',array['practice'],'GH','{}','{}',$3::date,$4::date,5,'INV-9')", [c.id, p.id, day(0), day(10)]);
    await db.query("select public.qb_admin_partner_contract_submit($1)", [c.id]);
    await fails("select public.qb_admin_partner_contract_approve($1,'ok')", [c.id], /QB_SELF_APPROVAL_NOT_ALLOWED/);
    await as(ADMIN2);
    await fails("select public.qb_admin_partner_contract_approve($1,'')", [c.id], /QB_NOTE_REQUIRED/);
    expect((await one("select public.qb_admin_partner_contract_approve($1,'paid')", [c.id])).status).toBe("active");
  });
  it("an active contract cannot be edited casually, a partner cannot raise capacity, and amending cannot cut below seats in use", async () => {
    const { partner, contract } = await activePartner("Amend School", 2);
    await as(ADMIN);
    await fails("select public.qb_admin_partner_contract_save($1,$2,'x',array['practice'],'GH','{}','{}',$3::date,$4::date,99,'R')", [contract, partner, day(0), day(5)], /QB_PARTNER_CONTRACT_LOCKED/);
    await server();
    await db.query("select public.qb_partner_seat_allocate($1,$2,'a',$3)", [partner, contract, S1]);
    await db.query("select public.qb_partner_seat_allocate($1,$2,'b',$3)", [partner, contract, S2]);
    await as(ADMIN);
    await fails("select public.qb_admin_partner_contract_amend($1,1,$2::date,'R','cut')", [contract, day(20)], /QB_PARTNER_SEATS_IN_USE/);
    expect((await one("select public.qb_admin_partner_contract_amend($1,3,$2::date,'INV-001b','more seats paid')", [contract, day(40)])).max_seats).toBe(3);
    await server();
    // a partner reference event changes text only, never capacity or dates
    await db.query("select public.qb_partner_contract_reference_update($1,$2,'NEW-REF')", [partner, contract]);
    const [row] = await sql("select max_seats, expires_on::text as e, external_billing_ref as r, reconciliation_status as rs from public.partner_contracts where id=$1", [contract]);
    expect(row.max_seats).toBe(3); expect(row.r).toBe("NEW-REF"); expect(row.rs).toBe("unreconciled");
  });
});

describe("seats and the entitlement", () => {
  it("a seated person has access; overflow is refused; a retry does not take a second seat", async () => {
    await flag(true);
    const { partner, contract } = await activePartner("Seats School", 2);
    const [U1, U2] = [await fresh(), await fresh()];
    await server();
    const a = await one("select public.qb_partner_seat_allocate($1,$2,'ext-1',$3)", [partner, contract, U1]);
    expect(a.duplicate).toBe(false); expect(a.remaining).toBe(1);
    const again = await one("select public.qb_partner_seat_allocate($1,$2,'ext-1',$3)", [partner, contract, U1]);
    expect(again.duplicate).toBe(true); expect(again.seat_id).toBe(a.seat_id);
    await db.query("select public.qb_partner_seat_allocate($1,$2,'ext-2',null)", [partner, contract]);
    await fails("select public.qb_partner_seat_allocate($1,$2,'ext-3',$3)", [partner, contract, U2], /QB_PARTNER_SEAT_CAPACITY/);
    expect(await hasSub(U1)).toBe(true);
    expect(await hasSub(U2)).toBe(false);
    // revoking frees the seat and ends the access, the account stays
    expect((await one("select public.qb_partner_seat_revoke($1,'ext-1','left school')", [partner])).revoked).toBe(1);
    expect(await hasSub(U1)).toBe(false);
    expect((await sql("select count(*)::int as n from public.profiles where id=$1", [U1]))[0].n).toBe(1);
    await server();
    await db.query("select public.qb_partner_seat_allocate($1,$2,'ext-3',$3)", [partner, contract, U2]);
    expect(await hasSub(U2)).toBe(true);
  });
  it("one partner cannot touch another partner's contract or seats", async () => {
    const a = await activePartner("Org A", 2); const b = await activePartner("Org B", 2);
    await server();
    await fails("select public.qb_partner_seat_allocate($1,$2,'x',null)", [b.partner, a.contract], /QB_PARTNER_NOT_FOUND/);
    await db.query("select public.qb_partner_seat_allocate($1,$2,'shared-ref',null)", [a.partner, a.contract]);
    expect((await one("select public.qb_partner_seat_revoke($1,'shared-ref')", [b.partner])).revoked).toBe(0);
    expect(await one("select public.qb_partner_seat_list($1,$2)", [b.partner, a.contract])).toEqual([]);
    expect((await one("select public.qb_partner_licence_status($1)", [b.partner])).every((r: any) => r.contract_id === b.contract)).toBe(true);
  });
  it("an expired, suspended, cancelled or unverified-partner licence stops access but keeps the seat and the account", async () => {
    const { partner, contract } = await activePartner("Ends School", 4);
    await server();
    await db.query("select public.qb_partner_seat_allocate($1,$2,'e',$3)", [partner, contract, S3]);
    expect(await hasSub(S3)).toBe(true);
    await as(ADMIN); await db.query("select public.qb_admin_partner_contract_set_status($1,'suspended','under review')", [contract]);
    expect(await hasSub(S3)).toBe(false);
    await as(ADMIN); await db.query("select public.qb_admin_partner_contract_set_status($1,'active','cleared')", [contract]);
    expect(await hasSub(S3)).toBe(true);
    await as(ADMIN); await db.query("select public.qb_admin_partner_set_status($1,'suspended','investigating')", [partner]);
    expect(await hasSub(S3)).toBe(false);
    await as(ADMIN); await db.query("select public.qb_admin_partner_set_status($1,'verified','cleared')", [partner]);
    expect(await hasSub(S3)).toBe(true);
    await sql("update public.partner_contracts set expires_on = current_date - 1 where id=$1", [contract]);
    expect(await hasSub(S3)).toBe(false);
    await server();
    expect(await one("select public.qb_partner_contracts_expire()")).toBeGreaterThanOrEqual(1);
    expect((await sql("select status from public.partner_contracts where id=$1", [contract]))[0].status).toBe("expired");
    expect((await sql("select status from public.partner_seats where contract_id=$1", [contract]))[0].status).toBe("active");
    await fails("select public.qb_partner_seat_allocate($1,$2,'new',null)", [partner, contract], /QB_PARTNER_LICENCE_NOT_ACTIVE/);
  });
  it("another entitlement keeps working after the licence ends, and the flag switches licences off at once", async () => {
    const { partner, contract } = await activePartner("Both School", 2);
    await server(); await db.query("select public.qb_partner_seat_allocate($1,$2,'both',$3)", [partner, contract, OTHER]);
    await sql("insert into public.learner_subscriptions(user_id) values ($1)", [OTHER]);
    await sql("update public.partner_contracts set status='cancelled' where id=$1", [contract]);
    expect(await hasSub(OTHER)).toBe(true);
    await sql("update public.learner_subscriptions set status='cancelled' where user_id=$1", [OTHER]);
    expect(await hasSub(OTHER)).toBe(false);
    await sql("update public.partner_contracts set status='active' where id=$1", [contract]);
    expect(await hasSub(OTHER)).toBe(true);
    await flag(false); expect(await hasSub(OTHER)).toBe(false); await flag(true);
  });
  it("a free-standing minor cannot be seated; a school-managed minor can", async () => {
    const { partner, contract } = await activePartner("Minors School", 3);
    await server();
    await fails("select public.qb_partner_seat_allocate($1,$2,'min',$3)", [partner, contract, MINOR], /QB_PARTNER_MINOR_CONSENT_REQUIRED/);
    await db.query("select public.qb_partner_seat_allocate($1,$2,'mgd',$3)", [partner, contract, MANAGED]);
    expect(await hasSub(MANAGED)).toBe(true);
  });
});

describe("API credentials", () => {
  it("the secret is shown once, only a hash is stored, and it verifies, expires, rotates and revokes", async () => {
    const { partner } = await activePartner("Key School", 2);
    await as(ADMIN);
    const k = await one("select public.qb_admin_partner_credential_issue($1,array['licence:read','seats:write'],30)", [partner]);
    expect(k.secret).toMatch(/^qbpk_[0-9a-f]{64}$/);
    const [stored] = await sql("select secret_hash, key_prefix from public.partner_credentials where id=$1", [k.id]);
    expect(stored.secret_hash).not.toContain(k.secret.slice(6, 30)); expect(stored.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await sql("select details from public.audit_logs"))).not.toContain(k.secret);
    await server();
    const v = await one("select public.qb_partner_credential_verify($1)", [k.secret]);
    expect(v.partner_id).toBe(partner); expect(v.scopes).toEqual(["licence:read", "seats:write"]);
    await fails("select public.qb_partner_credential_verify($1)", [k.secret.slice(0, -1) + "0"], /QB_PARTNER_AUTH_INVALID/);
    await fails("select public.qb_partner_credential_verify('qbpk_short')", [], /QB_PARTNER_AUTH_INVALID/);
    await as(ADMIN);
    const n = await one("select public.qb_admin_partner_credential_rotate($1,30)", [k.id]);
    const [old] = await sql("select expires_at < now() + interval '25 hours' as soon from public.partner_credentials where id=$1", [k.id]);
    expect(old.soon).toBe(true); expect(n.secret).not.toBe(k.secret);
    await as(ADMIN); await db.query("select public.qb_admin_partner_credential_revoke($1)", [k.id]);
    await server(); await fails("select public.qb_partner_credential_verify($1)", [k.secret], /QB_PARTNER_AUTH_INVALID/);
    await db.query("select public.qb_partner_credential_verify($1)", [n.secret]);
    await sql("update public.partner_credentials set expires_at = now() - interval '1 minute' where id=$1", [n.id]);
    await server(); await fails("select public.qb_partner_credential_verify($1)", [n.secret], /QB_PARTNER_AUTH_INVALID/);
  });
  it("a suspended partner's key stops working and a revoked partner loses everything", async () => {
    const { partner } = await activePartner("Revoked Org", 2);
    await as(ADMIN);
    const k = await one("select public.qb_admin_partner_credential_issue($1,array['seats:read'])", [partner]);
    await db.query("select public.qb_admin_partner_set_status($1,'suspended','late payment')", [partner]);
    await server(); await fails("select public.qb_partner_credential_verify($1)", [k.secret], /QB_PARTNER_AUTH_INVALID/);
    await as(ADMIN); await db.query("select public.qb_admin_partner_set_status($1,'revoked','contract ended')", [partner]);
    await fails("select public.qb_admin_partner_set_status($1,'verified','again')", [partner], /QB_PARTNER_REVOKED/);
    expect((await sql("select status from public.partner_credentials where id=$1", [k.id]))[0].status).toBe("revoked");
  });
  it("only a verified partner can be issued a key", async () => {
    await as(ADMIN);
    const p = await one("select public.qb_admin_partner_save(null,'Unverified Co','company','GH')");
    await fails("select public.qb_admin_partner_credential_issue($1,array['licence:read'])", [p.id], /QB_PARTNER_NOT_VERIFIED/);
    await fails("select public.qb_admin_partner_credential_issue($1,array['superpower'])", [p.id], /check constraint|QB_PARTNER_NOT_VERIFIED/);
  });
});

describe("inbound events", () => {
  it("are idempotent, reject a replay with a different body, retry failures and park dead letters for staff", async () => {
    const { partner } = await activePartner("Events Co", 2);
    const sha = "a".repeat(64), other = "b".repeat(64);
    await server();
    expect((await one("select public.qb_partner_event_begin($1,'evt-1','partner.seat.allocated',$2)", [partner, sha])).state).toBe("new");
    expect((await one("select public.qb_partner_event_begin($1,'evt-1','partner.seat.allocated',$2)", [partner, sha])).state).toBe("duplicate");
    await fails("select public.qb_partner_event_begin($1,'evt-1','partner.seat.allocated',$2)", [partner, other], /QB_PARTNER_EVENT_REPLAY_MISMATCH/);
    await fails("select public.qb_partner_event_begin($1,'evt-x','partner.contract.capacity_increased',$2)", [partner, sha], /QB_PARTNER_EVENT_UNSUPPORTED/);
    await db.query("select public.qb_partner_event_finish($1,'evt-1',true)", [partner]);
    expect((await one("select public.qb_partner_event_begin($1,'evt-1','partner.seat.allocated',$2)", [partner, sha])).status).toBe("processed");
    await db.query("select public.qb_partner_event_begin($1,'evt-2','partner.seat.revoked',$2)", [partner, sha]);
    expect((await one("select public.qb_partner_event_finish($1,'evt-2',false,'DB_DOWN')", [partner])).status).toBe("failed");
    expect((await one("select public.qb_partner_event_begin($1,'evt-2','partner.seat.revoked',$2)", [partner, sha])).state).toBe("retry");
    for (let i = 0; i < 4; i++) { await db.query("select public.qb_partner_event_finish($1,'evt-2',false,'DB_DOWN')", [partner]); await db.query("select public.qb_partner_event_begin($1,'evt-2','partner.seat.revoked',$2)", [partner, sha]); }
    expect((await one("select public.qb_partner_event_finish($1,'evt-2',false,'DB_DOWN')", [partner])).status).toBe("dead");
    await as(ADMIN);
    const dead = await one("select public.qb_admin_partner_events($1,'dead')", [partner]);
    expect(dead).toHaveLength(1);
    await db.query("select public.qb_admin_partner_event_requeue($1)", [dead[0].id]);
    await server(); expect((await one("select public.qb_partner_event_begin($1,'evt-2','partner.seat.revoked',$2)", [partner, sha])).state).toBe("retry");
    expect((await sql("select column_name from information_schema.columns where table_name='partner_webhook_events' and column_name in ('payload','body')")).length).toBe(0);
  });
  it("webhook secrets rotate with a 24 hour overlap and are stored only as the ciphertext the app gave", async () => {
    const { partner } = await activePartner("Secret Co", 2);
    await as(ADMIN);
    await db.query("select public.qb_admin_partner_webhook_secret_rotate($1,'v1:ciphertext-one-aaaaaaaaaaaaaaaa')", [partner]);
    await db.query("select public.qb_admin_partner_webhook_secret_rotate($1,'v1:ciphertext-two-bbbbbbbbbbbbbbbb')", [partner]);
    await server();
    expect(await one("select public.qb_partner_webhook_secrets_active($1)", [partner])).toEqual(["v1:ciphertext-two-bbbbbbbbbbbbbbbb", "v1:ciphertext-one-aaaaaaaaaaaaaaaa"]);
    await sql("update public.partner_webhook_secrets set valid_until = now() - interval '1 minute' where status='retiring' and partner_id=$1", [partner]);
    await server();
    expect(await one("select public.qb_partner_webhook_secrets_active($1)", [partner])).toEqual(["v1:ciphertext-two-bbbbbbbbbbbbbbbb"]);
  });
});

describe("single sign-on linking (after the server has verified the token)", () => {
  it("links issuer + subject to one account and one seat, refuses wrong issuers, conflicts and revoked members", async () => {
    const { partner, contract } = await activePartner("Sso School", 3);
    const [U1, U2, U3] = [await fresh(), await fresh(), await fresh()];
    await as(ADMIN);
    await db.query("select public.qb_admin_partner_identity_save($1,'oidc','https://login.school.example','quizbox-client','https://login.school.example/jwks','{school.example}',false,'active')", [partner]);
    await fails("select public.qb_admin_partner_identity_save($1,'oidc','http://insecure.example','c',null,'{}',false,'active')", [partner], /check constraint/);
    await server();
    await db.query("select public.qb_partner_seat_allocate($1,$2,'staff-77',null)", [partner, contract]);
    await fails("select public.qb_partner_sso_link($1,'https://evil.example','sub-1',$2,'staff-77')", [partner, U1], /QB_PARTNER_AUTH_INVALID/);
    const ok = await one("select public.qb_partner_sso_link($1,'https://login.school.example','sub-1',$2,'staff-77')", [partner, U1]);
    expect(ok.seat).toBe(true); expect(ok.licensed).toBe(true); expect(await hasSub(U1)).toBe(true);
    await db.query("select public.qb_partner_sso_link($1,'https://login.school.example','sub-1',$2,'staff-77')", [partner, U1]);
    await fails("select public.qb_partner_sso_link($1,'https://login.school.example','sub-1',$2,'staff-77')", [partner, U2], /QB_PARTNER_IDENTITY_CONFLICT/);
    await fails("select public.qb_partner_sso_link($1,'https://login.school.example','sub-2',$2,'staff-77')", [partner, U2], /QB_PARTNER_IDENTITY_CONFLICT/);
    await fails("select public.qb_partner_sso_link($1,'https://login.school.example','sub-3',$2,'staff-1')", [partner, MINOR], /QB_PARTNER_MINOR_CONSENT_REQUIRED/);
    const nobody = await one("select public.qb_partner_sso_link($1,'https://login.school.example','sub-9',$2,'not-allocated')", [partner, U3]);
    expect(nobody.seat).toBe(false); expect(await hasSub(U3)).toBe(false);
    await db.query("select public.qb_partner_seat_revoke($1,'staff-77','left')", [partner]);
    await fails("select public.qb_partner_sso_link($1,'https://login.school.example','sub-1',$2,'staff-77')", [partner, U1], /QB_PARTNER_MEMBER_REVOKED/);
    expect(await hasSub(U1)).toBe(false);
  });
});

describe("staff seats, slugs, OIDC lookups and rate buckets (phase 2-4 support)", () => {
  async function staffContract(name: string, seats = 3) {
    await as(ADMIN);
    const p = await one("select public.qb_admin_partner_save(null,$1,'school','GH')", [name]);
    await db.query("select public.qb_admin_partner_set_status($1,'verified','docs checked')", [p.id]);
    const c = await one("select public.qb_admin_partner_contract_save(null,$1,'staff-pack',array['practice','staff'],'GH','{}','{}',$2::date,$3::date,$4,'INV-S')", [p.id, day(-1), day(30), seats]);
    await db.query("select public.qb_admin_partner_contract_submit($1)", [c.id]);
    await as(ADMIN2); await db.query("select public.qb_admin_partner_contract_approve($1,'paid')", [c.id]);
    return { partner: p.id as string, contract: c.id as string };
  }
  it("staff seats share the pool, need the staff capability, are adults only and never grant learner access or a role", async () => {
    const { partner, contract } = await staffContract("Staff Seats School", 2);
    const T = await fresh();
    await server();
    const a = await one("select public.qb_partner_seat_allocate($1,$2,'teacher-1',$3,'staff')", [partner, contract, T]);
    expect(a.kind).toBe("staff");
    expect(await hasSub(T)).toBe(false);
    expect(await one("select public.qb_partner_staff_seat_active($1)", [T])).toBe(true);
    expect((await sql("select role from public.profiles where id=$1", [T]))[0].role).toBe("STUDENT");
    await server();
    await fails("select public.qb_partner_seat_allocate($1,$2,'teacher-1',null,'learner')", [partner, contract], /QB_PARTNER_SEAT_KIND_CONFLICT/);
    await fails("select public.qb_partner_seat_allocate($1,$2,'minor-staff',$3,'staff')", [partner, contract, MANAGED], /QB_PARTNER_STAFF_SEAT_ADULT_ONLY/);
    await db.query("select public.qb_partner_seat_allocate($1,$2,'learner-1',null)", [partner, contract]);
    await fails("select public.qb_partner_seat_allocate($1,$2,'teacher-2',null,'staff')", [partner, contract], /QB_PARTNER_SEAT_CAPACITY/);
    const plain = await activePartner("No Staff Cap", 2);
    await server();
    await fails("select public.qb_partner_seat_allocate($1,$2,'t',null,'staff')", [plain.partner, plain.contract], /QB_PARTNER_STAFF_SEATS_NOT_IN_CONTRACT/);
    await fails("select public.qb_partner_seat_allocate($1,$2,'t',null,'principal')", [plain.partner, plain.contract], /QB_PARTNER_INVALID_INPUT/);
    expect((await one("select public.qb_partner_member_lookup($1,'teacher-1')", [partner]))[0]).toMatchObject({ kind: "staff", status: "active", linked: true, licensed_now: true });
    expect(await one("select public.qb_partner_member_lookup($1,'teacher-1')", [plain.partner])).toEqual([]);
    await as(ADMIN);
    expect(await one("select public.qb_admin_partner_seats($1)", [contract])).toHaveLength(2);
    const d = await one("select public.qb_admin_partner_detail($1)", [partner]);
    expect(d.contracts[0]).toMatchObject({ staff_seats: 1, learner_seats: 1 });
  });
  it("the entry page shows only the name; the OIDC configuration is complete only when staff finished the wizard", async () => {
    const { partner } = await activePartner("Entry School", 2);
    await as(ADMIN);
    await db.query("select public.qb_admin_partner_slug_set($1,'entry-school')", [partner]);
    await fails("select public.qb_admin_partner_slug_set($1,'Bad Slug!')", [partner], /partners_slug_format/);
    await server();
    expect(await one("select public.qb_partner_public_by_slug('ENTRY-school')")).toEqual({ name: "Entry School", kind: "school", sso_ready: false });
    expect(await one("select public.qb_partner_oidc_config('entry-school')")).toBeNull();
    await as(ADMIN);
    await db.query("select public.qb_admin_partner_identity_save($1,'oidc','https://idp.entry.example','client-1','https://idp.entry.example/jwks','{entry.example}',false,'active')", [partner]);
    await server();
    expect(await one("select public.qb_partner_oidc_config('entry-school')")).toBeNull();
    await as(ADMIN);
    await db.query("select public.qb_admin_partner_oidc_endpoints_save($1,'https://idp.entry.example/auth','https://idp.entry.example/token','v1:secretciphertext-aaaaaaaaaaaaaaaa')", [partner]);
    await fails("select public.qb_admin_partner_oidc_endpoints_save($1,'http://idp.entry.example/auth','https://idp.entry.example/token',null)", [partner], /partner_identity_endpoints_https/);
    await server();
    const cfg = await one("select public.qb_partner_oidc_config('entry-school')");
    expect(cfg).toMatchObject({ issuer: "https://idp.entry.example", audience: "client-1", client_secret_enc: "v1:secretciphertext-aaaaaaaaaaaaaaaa", allowed_domains: ["entry.example"] });
    await as(ADMIN);
    const det = await one("select public.qb_admin_partner_detail($1)", [partner]);
    expect(det.identity.has_client_secret).toBe(true);
    expect(JSON.stringify(det)).not.toContain("secretciphertext");
    await db.query("select public.qb_admin_partner_set_status($1,'suspended','paused')", [partner]);
    await server();
    expect(await one("select public.qb_partner_public_by_slug('entry-school')")).toBeNull();
    await flag(false);
    expect(await one("select public.qb_partner_public_by_slug('entry-school')")).toBeNull();
    await flag(true);
  });
  it("accounts are matched by a link, or by a verified address in a staff-approved domain; never by an unverified or look-alike address", async () => {
    const { partner } = await activePartner("Match School", 2);
    const U = await fresh();
    await sql("update public.profiles set email='kofi@match.example' where id=$1", [U]);
    await sql("insert into public.profiles values ($1,'STUDENT','active','Dup','dup@match.example'),($2,'STUDENT','active','Dup2','dup@match.example'),($3,'ADMIN','active','Boss','boss@match.example'),($4,'TEACHER','active','Cap','cap@match.example')", [id(901), id(902), id(903), id(904)]);
    await sql("insert into public.user_capabilities values ($1,'finance_admin',true)", [id(904)]);
    await as(ADMIN);
    await fails("select public.qb_admin_partner_identity_save($1,'oidc','https://idp.match.example','c',null,'{gmail.com}',false,'active')", [partner], /QB_PARTNER_PUBLIC_DOMAIN/);
    await fails("select public.qb_admin_partner_identity_save($1,'oidc','https://idp.match.example','c',null,'{not a domain}',false,'active')", [partner], /QB_PARTNER_DOMAIN_INVALID/);
    await db.query("select public.qb_admin_partner_identity_save($1,'oidc','https://idp.match.example','c',null,'{Match.Example}',false,'active')", [partner]);
    await server();
    const f = (email: string | null, verified: boolean, sub = "s-1") => one("select public.qb_partner_sso_find_account($1,'https://idp.match.example',$2,$3,$4)", [partner, sub, email, verified]);
    expect(await f("kofi@match.example", true)).toEqual({ user_id: U, via: "email_domain" });
    expect(await f("KOFI@Match.Example", true)).toEqual({ user_id: U, via: "email_domain" });
    expect(await f("kofi@match.example", false)).toEqual({ user_id: null, via: "none" });
    expect(await f("kofi@evil-match.example", true)).toEqual({ user_id: null, via: "none" });
    expect(await f("dup@match.example", true)).toEqual({ user_id: null, via: "none" });
    expect(await f(null, true)).toEqual({ user_id: null, via: "none" });
    expect(await f("boss@match.example", true)).toEqual({ user_id: null, via: "none" });   // an administrator is never reachable through a partner's domain
    expect(await f("cap@match.example", true)).toEqual({ user_id: null, via: "none" });    // nor anyone holding a staff capability
    await sql("insert into public.partner_identity_links(partner_id, issuer, subject, user_id, external_ref) values ($1,'https://idp.match.example','linked-sub',$2,'r')", [partner, U]);
    await server();
    expect(await f("someone-else@x.example", false, "linked-sub")).toEqual({ user_id: U, via: "link" });
    await sql("update public.partner_identity_links set status='revoked' where subject='linked-sub'");
    await server();
    expect(await f("kofi@match.example", true, "linked-sub")).toEqual({ user_id: null, via: "revoked" });
  });
  it("rate buckets count per key and window, and the sweep clears old ones", async () => {
    await server();
    for (let i = 0; i < 3; i++) expect(await one("select public.qb_partner_rate_check('p:test:api',3,60)")).toBe(true);
    expect(await one("select public.qb_partner_rate_check('p:test:api',3,60)")).toBe(false);
    expect(await one("select public.qb_partner_rate_check('p:other:api',3,60)")).toBe(true);
    await fails("select public.qb_partner_rate_check($1,3,60)", ["x".repeat(201)], /QB_PARTNER_INVALID_INPUT/);
    await sql("update public.partner_rate_buckets set window_start = now() - interval '2 days'");
    await server();
    await db.query("select public.qb_partner_contracts_expire()");
    expect((await sql("select count(*)::int as n from public.partner_rate_buckets"))[0].n).toBe(0);
    await as(ADMIN);
    await fails("select public.qb_partner_rate_check('k',1,1)", [], /permission denied/);
  });
});

describe("audit and rollback", () => {
  it("writes admin and partner actions to the audit log with the partner id and no secrets", async () => {
    const rows = await sql("select action, details from public.audit_logs where action like 'partner.%'");
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((r) => r.details?.partner_id)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/qbpk_[0-9a-f]{20}|ciphertext/);
  });
  it("the migration can be run twice and the rollback restores the earlier access answer", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION2);
    const { partner, contract } = await activePartner("Rollback School", 2);
    await server(); await db.query("select public.qb_partner_seat_allocate($1,$2,'rb',$3)", [partner, contract, S2]);
    expect(await hasSub(S2)).toBe(true);
    await db.exec(ROLLBACK2);
    await flag(true);
    expect(await hasSub(S2)).toBe(true);
    await db.exec(ROLLBACK);
    expect(await hasSub(S2)).toBe(false);
    expect((await sql("select count(*)::int as n from pg_proc where proname like 'qb\\_partner\\_%' or proname like 'qb\\_admin\\_partner%'"))[0].n).toBe(0);
    expect((await sql("select count(*)::int as n from public.partner_seats"))[0].n).toBeGreaterThan(0);
    expect(await one("select value from public.platform_settings where key='flags.partner_access_gateway_v1'")).toBe(false);
  });
});
