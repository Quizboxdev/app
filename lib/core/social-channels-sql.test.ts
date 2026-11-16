import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Social channels managed from the admin (migration 20261076100000): the public list is empty until the flag is on, links are checked per platform, WhatsApp numbers become wa.me links, and only a super admin can change anything.
const MIG = "supabase/migrations/20261076100000_social_channels.sql";
const ADMIN = "00000000-0000-0000-0000-0000000000a1", USER = "00000000-0000-0000-0000-0000000000b1";

async function setup(flag = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema quizbox_market; create function quizbox_market.is_super() returns boolean language sql as $$ select coalesce(current_setting('test.super', true), '') = 'on' $$;
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core; create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select (value)::text = 'true' from public.platform_settings where key = p_key), false) $$;
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  if (flag) await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.social_channels'`);
  await as(db, ADMIN, true);
  return db;
}
const as = (db: PGlite, uid: string | null, sup = false) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false), set_config('test.super', '${sup ? "on" : ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const save = (db: PGlite, o: Record<string, unknown>) => one(db, `select public.qb_social_admin_save('${JSON.stringify(o).replace(/'/g, "''")}'::jsonb) as r`);

describe("social channels", () => {
  it("answers nothing publicly while the flag is off, but staff can already see and prepare the list", async () => {
    const db = await setup(false);
    expect(await one(db, `select public.qb_social_channels() as r`)).toEqual([]);
    const list = await one(db, `select public.qb_social_admin_list() as r`);
    expect(list.flag).toBe(false);
    expect(list.rows.map((x: any) => x.kind)).toEqual(["tiktok", "instagram", "facebook", "youtube", "linkedin", "snapchat"]);
  });
  it("serves the six seeded channels in order once the flag is on, and lets anyone (even signed out) read them", async () => {
    const db = await setup();
    await as(db, null);
    const pub = await one(db, `select public.qb_social_channels() as r`);
    expect(pub.map((x: any) => x.kind)).toEqual(["tiktok", "instagram", "facebook", "youtube", "linkedin", "snapchat"]);
    expect(pub[0]).toMatchObject({ label: "TikTok", handle: "@quizz_box", url: "https://www.tiktok.com/@quizz_box" });
    expect((await db.query<{ r: boolean }>(`select has_function_privilege('anon', 'public.qb_social_channels()', 'execute') as r`)).rows[0].r).toBe(true);
    expect((await db.query<{ r: boolean }>(`select has_function_privilege('anon', 'public.qb_social_admin_save(jsonb)', 'execute') as r`)).rows[0].r).toBe(false);
    expect((await db.query<{ r: boolean }>(`select has_table_privilege('authenticated', 'public.social_channels', 'select') as r`)).rows[0].r).toBe(false);
  });
  it("turns a WhatsApp number into a wa.me link and adds it at the end", async () => {
    const db = await setup();
    const r = await save(db, { kind: "whatsapp", label: "WhatsApp support", handle: "+233 24 123 4567", target: "+233 (0)24-123 4567" });
    expect(r.url).toBe("https://wa.me/2330241234567");
    const pub = await one(db, `select public.qb_social_channels() as r`);
    expect(pub.at(-1)).toMatchObject({ kind: "whatsapp", handle: "+233 24 123 4567" });
    await expect(save(db, { kind: "whatsapp", label: "Bad number", target: "12345" })).rejects.toThrow(/QB_SOCIAL_INVALID/);
  });
  it("accepts a Telegram link, a WhatsApp channel and an email, and refuses the wrong site, plain http and script links", async () => {
    const db = await setup();
    expect((await save(db, { kind: "telegram", label: "Telegram channel", target: "https://t.me/quizbox_ghana" })).url).toBe("https://t.me/quizbox_ghana");
    expect((await save(db, { kind: "whatsapp_channel", label: "WhatsApp channel", target: "https://whatsapp.com/channel/0029VaABC" })).kind).toBe("whatsapp_channel");
    expect((await save(db, { kind: "email", label: "Email us", target: "Hello@QuizBox.io" })).url).toBe("mailto:hello@quizbox.io");
    await expect(save(db, { kind: "instagram", label: "Instagram", target: "https://www.facebook.com/quizbox" })).rejects.toThrow(/QB_SOCIAL_WRONG_SITE/);
    await expect(save(db, { kind: "instagram", label: "Instagram", target: "https://instagram.com.evil.example/quizbox" })).rejects.toThrow(/QB_SOCIAL_WRONG_SITE/);
    await expect(save(db, { kind: "telegram", label: "Telegram", target: "http://t.me/quizbox" })).rejects.toThrow(/QB_SOCIAL_INVALID/);
    await expect(save(db, { kind: "website", label: "Site", target: "javascript:alert(1)" })).rejects.toThrow(/QB_SOCIAL_INVALID/);
    await expect(save(db, { kind: "website", label: "Site", target: "https://user@evil.example/" })).rejects.toThrow(/QB_SOCIAL_INVALID/);
    await expect(save(db, { kind: "website", label: "<b>x</b>", target: "https://quizbox.io" })).rejects.toThrow(/QB_SOCIAL_INVALID/);
    await expect(save(db, { kind: "myspace", label: "Old", target: "https://myspace.com/x" })).rejects.toThrow();
  });
  it("edits, hides, reorders and deletes", async () => {
    const db = await setup();
    const rows = (await one(db, `select public.qb_social_admin_list() as r`)).rows;
    const [tiktok, instagram] = [rows[0].id, rows[1].id];
    await save(db, { id: instagram, kind: "instagram", label: "Instagram", handle: "@quizbox", target: "https://www.instagram.com/quizbox/", active: false });
    expect((await one(db, `select public.qb_social_channels() as r`)).map((x: any) => x.kind)).not.toContain("instagram");
    const order = [...rows.map((x: any) => x.id)].reverse();
    await one(db, `select public.qb_social_admin_reorder(array['${order.join("','")}']::uuid[]) as r`);
    expect((await one(db, `select public.qb_social_channels() as r`)).map((x: any) => x.kind)).toEqual(["snapchat", "linkedin", "youtube", "facebook", "tiktok"]);
    await one(db, `select public.qb_social_admin_delete('${tiktok}') as r`);
    expect((await one(db, `select count(*)::int as r from public.social_channels`))).toBe(5);
    await expect(one(db, `select public.qb_social_admin_delete('${tiktok}') as r`)).rejects.toThrow(/QB_NOT_FOUND/);
    await expect(save(db, { id: tiktok, kind: "tiktok", label: "Gone", target: "https://www.tiktok.com/@x" })).rejects.toThrow(/QB_NOT_FOUND/);
  });
  it("stops at 30 channels", async () => {
    const db = await setup();
    for (let i = 0; i < 24; i++) await save(db, { kind: "website", label: `Site ${i}`, target: `https://example${i}.org` });
    await expect(save(db, { kind: "website", label: "One too many", target: "https://example.org" })).rejects.toThrow(/QB_SOCIAL_TOO_MANY/);
  });
  it("is for super admins only", async () => {
    const db = await setup();
    await as(db, USER);
    for (const sql of [`select public.qb_social_admin_list()`, `select public.qb_social_admin_save('{"kind":"website","label":"Hi","target":"https://quizbox.io"}'::jsonb)`, `select public.qb_social_admin_delete(gen_random_uuid())`, `select public.qb_social_admin_reorder('{}'::uuid[])`])
      await expect(db.query(sql)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
  });
});
