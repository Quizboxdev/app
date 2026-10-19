import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Clearing notifications (isolated PostgreSQL; the migration is applied unchanged over the original function).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261026100000_notification_dismiss.sql");
const ROLLBACK = read("../../supabase/rollback/notification_dismiss.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ME, OTHER] = [1, 2].map(id);
let db: PGlite;
const as = async (user: string | null) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); };
const call = async (action: string, data: object = {}) => (await db.query<{ r: any }>("select public.qb_notifications($1,$2::jsonb) r", [action, JSON.stringify(data)])).rows[0].r;
const list = async () => (await call("list")).items.map((n: any) => n.title);
const add = async (user: string, title: string, read = false) => { await db.exec("reset role"); await db.query("insert into public.notifications(recipient_user_id,title,message,read_at) values ($1,$2,'m',$3)", [user, title, read ? new Date().toISOString() : null]); };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create table public.markets(id uuid primary key, name text);
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, type text default 'x', title text not null, message text not null, link text, market_id uuid,
      read_at timestamptz, created_at timestamptz not null default now());
    create schema quizbox_ops; create function quizbox_ops.live_alerts(u uuid) returns jsonb language sql as $$ select '[]'::jsonb $$;
    grant usage on schema quizbox_ops to authenticated; grant execute on function quizbox_ops.live_alerts(uuid) to authenticated;
    -- the original function, as it was before this migration
    create function public.qb_notifications(p_action text default 'list', p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $f$
    declare me uuid:=auth.uid(); stored jsonb;
    begin
      if me is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
      if p_action='mark_read' then update public.notifications set read_at=coalesce(read_at,now()) where id=(p_data->>'id')::uuid and recipient_user_id=me; return jsonb_build_object('ok',true);
      elsif p_action='mark_all_read' then update public.notifications set read_at=now() where recipient_user_id=me and read_at is null; return jsonb_build_object('ok',true);
      elsif p_action<>'list' then raise exception 'INVALID_NOTIFICATION_ACTION'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'type',n.type,'title',n.title,'message',n.message,'link',n.link,'created_at',n.created_at,'read',n.read_at is not null,'live',false,'market',(select name from public.markets where id=n.market_id)) order by n.created_at desc),'[]')
        into stored from (select * from public.notifications where recipient_user_id=me and (not coalesce((p_data->>'unread_only')::boolean,false) or read_at is null) order by created_at desc limit 50) n;
      return jsonb_build_object('unread',(select count(*) from public.notifications where recipient_user_id=me and read_at is null),'live',quizbox_ops.live_alerts(me),'items',stored);
    end $f$;
    grant execute on function public.qb_notifications(text,jsonb) to authenticated;
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("clearing notifications", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("dismisses one notification: it leaves the list and the count, and stays in the database", async () => {
    await add(ME, "First"); await add(ME, "Second"); await add(OTHER, "Not mine");
    await as(ME); const items = (await call("list")).items; expect(items).toHaveLength(2);
    await call("dismiss", { id: items.find((n: any) => n.title === "First").id });
    expect(await list()).toEqual(["Second"]); expect((await call("list")).unread).toBe(1);
    await db.exec("reset role"); expect((await db.query<any>("select count(*)::int n from public.notifications where title = 'First' and dismissed_at is not null and read_at is not null")).rows[0].n).toBe(1);
  });

  it("cannot dismiss or clear someone else's notifications", async () => {
    await db.exec("reset role"); const other = (await db.query<any>("select id from public.notifications where title = 'Not mine'")).rows[0].id;
    await as(ME); await call("dismiss", { id: other }); await call("clear_all");
    await db.exec("reset role"); expect((await db.query<any>("select dismissed_at from public.notifications where id = $1", [other])).rows[0].dismissed_at).toBeNull();
    await as(OTHER); expect(await list()).toEqual(["Not mine"]);
  });

  it("clears only the read ones, or everything, and reports how many", async () => {
    await add(ME, "Read one", true); await add(ME, "Unread one");
    await as(ME); expect((await list()).sort()).toEqual(["Read one", "Unread one"]);       // "Second" was cleared by the previous test
    expect((await call("clear_read")).cleared).toBe(1);
    expect(await list()).toEqual(["Unread one"]);
    expect((await call("clear_all")).cleared).toBe(1);
    expect(await list()).toEqual([]); expect((await call("list")).unread).toBe(0);
    expect((await call("clear_all")).cleared).toBe(0);
  });

  it("mark all read does not bring cleared items back, and unknown actions and signed-out calls are refused", async () => {
    await as(ME); await call("mark_all_read"); expect(await list()).toEqual([]);
    await expect(call("explode")).rejects.toThrow(/INVALID_NOTIFICATION_ACTION/);
    await as(null); await expect(call("list")).rejects.toThrow(/permission denied/);
  });

  it("the rollback restores the original behaviour (cleared items reappear)", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    await as(ME); expect((await list()).sort()).toEqual(["First", "Read one", "Second", "Unread one"]);
    await expect(call("dismiss", {})).rejects.toThrow(/INVALID_NOTIFICATION_ACTION/);
    await db.exec("reset role"); await db.exec(MIGRATION);
  });
});
