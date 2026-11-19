#!/usr/bin/env bash
# Builds a throw-away local PostgreSQL 18 (port 55433, database qb_test) = a schema-only production dump + every migration in this repository, in order.
# Used by supabase/tests/december_readiness_gate.sql when Preview is not reachable. No data is copied from any environment.
#   scripts/readiness/build-scratch-db.sh <schema-only-dump.sql> [data-dir]
# Migrations that stop with "already exists" are expected (the dump already contains them); they are listed in <data-dir>/migration_errors.txt.
set -u
DUMP="${1:?usage: build-scratch-db.sh <schema-only-dump.sql> [data-dir]}"
HERE="$(cd "$(dirname "$0")" && pwd)"; MIG="$HERE/../../supabase/migrations"
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/18/bin}"; DIR="${2:-${TEMP:-/tmp}/qb_gate_pgdata}"; PORT=55433
"$PGBIN/pg_ctl" -D "$DIR" stop -m fast >/dev/null 2>&1
rm -rf "$DIR"; "$PGBIN/initdb" -D "$DIR" -U postgres --auth=trust -E UTF8 >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT" -l "$DIR/log.txt" -w start >/dev/null || exit 1
P() { "$PGBIN/psql" -h localhost -p $PORT -U postgres -v ON_ERROR_STOP=0 -q "$@"; }
P -d postgres -c "create database qb_test" >/dev/null
P -d qb_test <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator noinherit login; create role supabase_admin; create role supabase_auth_admin; create role dashboard_user;
create schema extensions; create extension pgcrypto schema extensions; create extension "uuid-ossp" schema extensions;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, encrypted_password text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz, phone text, banned_until timestamptz, deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true)::jsonb->>'role',''),'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
SQL
P -d qb_test -f "$DUMP" 2>"$DIR/restore_errors.txt"; echo "dump restore errors: $(grep -c ERROR "$DIR/restore_errors.txt")"
: > "$DIR/migration_errors.txt"
for f in $(ls "$MIG"/*.sql | sort); do
  out=$(P -d qb_test -v ON_ERROR_STOP=1 --single-transaction -f "$f" 2>&1)
  if echo "$out" | grep -q "ERROR"; then echo "== $(basename "$f")" >> "$DIR/migration_errors.txt"; echo "$out" | grep ERROR | head -2 >> "$DIR/migration_errors.txt"; fi
done
echo "migration files that stopped on an error (expected: 'already exists'): $(grep -c '^==' "$DIR/migration_errors.txt")  -> $DIR/migration_errors.txt"
P -d qb_test -Atc "select 'tables',count(*) from pg_tables where schemaname='public' union all select 'functions',count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' union all select 'policies',count(*) from pg_policies where schemaname='public'"
