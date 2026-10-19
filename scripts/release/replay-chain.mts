// Replays the whole migration chain, in order, on an empty in-memory PostgreSQL that has only what a new Supabase project provides
// (roles, the auth and storage schemas in minimal form, and the digest/uuid functions). Tracker C7: the chain must build a complete database from
// nothing, because that is how a Preview or test database is made. It stops at the first migration that cannot run and prints the error and the file.
//
//   npx tsx scripts/release/replay-chain.mts            replay everything
//   npx tsx scripts/release/replay-chain.mts --keep     keep going after a failure (each remaining file is tried on whatever state exists)
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const keepGoing = process.argv.includes("--keep");
const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite();
// What Supabase gives every project before the first migration runs.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin; create role authenticator nologin; create role supabase_admin nologin;
  create schema if not exists extensions; create schema if not exists auth; create schema if not exists storage;
  create or replace function extensions.digest(data text, type text) returns bytea language sql immutable as $$ select decode(md5(data) || md5(data), 'hex') $$;
  create or replace function extensions.digest(data bytea, type text) returns bytea language sql immutable as $$ select decode(md5(encode(data,'hex')) || md5(encode(data,'hex')), 'hex') $$;
  create or replace function extensions.gen_random_uuid() returns uuid language sql as $$ select gen_random_uuid() $$;
  create table auth.users(id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}',
    created_at timestamptz default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz, phone text, banned_until timestamptz, deleted_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
`);

let applied = 0, failed = 0;
for (const f of files) {
  try {
    // PGlite cannot install extensions; a real Supabase project already has them, so the CREATE EXTENSION lines are skipped here.
    await db.exec(readFileSync(join(dir, f), "utf8").replace(/create\s+extension\s+[^;]*;/gi, ""));
    applied++;
  } catch (e) {
    failed++;
    try { await db.exec("rollback"); } catch { /* nothing open */ }
    console.log(`FAILED  ${f}\n        ${String((e as Error).message).split("\n")[0]}`);
    if (!keepGoing) break;
  }
}
const tables = (await db.query<{ n: number }>("select count(*)::int n from pg_tables where schemaname = 'public' or schemaname like 'quizbox\\_%'")).rows[0].n;
console.log(`${applied} of ${files.length} migrations applied${failed ? `, ${failed} failed` : ""}; ${tables} application tables exist.`);
await db.close();
process.exit(failed ? 1 : 0);
