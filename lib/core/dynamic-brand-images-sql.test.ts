import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/20261050100000_dynamic_brand_images.sql", import.meta.url), "utf8");
const campaign = "00000000-0000-4000-8000-000000000001";

describe("dynamic brand image migration", () => {
  it("seeds the subject flag off and accepts only owner-scoped storage logo paths while preserving legacy data URLs", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create schema storage;
        create table public.profiles(id uuid primary key);
        create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null, scope_id uuid, value jsonb not null, description text not null default '', updated_by uuid, updated_at timestamptz not null default now());
        create unique index platform_settings_scope_key on public.platform_settings(key,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'));
        create table public.challenge_campaigns(id uuid primary key, brand jsonb not null default '{}', updated_at timestamptz not null default now());
        create function public.qb_challenge_owned(uuid) returns public.challenge_campaigns language sql as $$ select * from public.challenge_campaigns where id=$1 $$;
        create function public.qb_challenge_audit(text,uuid) returns void language plpgsql as $$ begin return; end $$;
        create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        insert into public.challenge_campaigns(id) values ('${campaign}');`);
      await db.exec(migration);
      expect((await db.query<{ value: boolean }>("select value from public.platform_settings where key='flags.q_insignia_backend_subject_photos'")).rows[0]?.value).toBe(false);
      const validPath = `campaigns/${campaign}/123e4567-e89b-12d3-a456-426614174000.webp`;
      const set = async (logo: string) => db.query("select public.challenge_set_brand($1,$2::jsonb)", [campaign, JSON.stringify({ logo })]);
      await set(validPath);
      expect((await db.query<{ logo: string }>("select brand->>'logo' as logo from public.challenge_campaigns where id=$1", [campaign])).rows[0]?.logo).toBe(validPath);
      await set("data:image/png;base64,AAAA");
      await expect(set("campaigns/00000000-0000-4000-8000-000000000002/123e4567-e89b-12d3-a456-426614174000.webp")).rejects.toThrow("INVALID_BRAND");
      await db.query("reset role");
    } finally { await db.close(); }
  });
});
