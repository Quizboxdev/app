#!/usr/bin/env bash
# Builds a throwaway local Postgres (port 55432) from a schema-only production dump. No production data is copied.
# Usage: scripts/testdb/build_from_prod_dump.sh <dump.sql>
set -u
DUMP="$1"; PGBIN="/c/Program Files/PostgreSQL/18/bin"
DIR="${TESTDB_DIR:-$TEMP/qb_testdb}"; PORT=55432
rm -rf "$DIR"; "$PGBIN/initdb" -D "$DIR" -U postgres --auth=trust -E UTF8 >/dev/null || exit 1
"$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT" -l "$DIR/log.txt" -w start >/dev/null || exit 1
P() { "$PGBIN/psql" -h localhost -p $PORT -U postgres -v ON_ERROR_STOP=0 -q "$@"; }
P -d postgres -c "create database qb_test" >/dev/null
P -d qb_test <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator noinherit login; create role supabase_admin; create role supabase_auth_admin; create role dashboard_user;
create schema extensions; create extension pgcrypto schema extensions; create extension "uuid-ossp" schema extensions;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true)::jsonb->>'role',''),'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
SQL
P -d qb_test -f "$DUMP" 2>"$DIR/restore_errors.txt"
echo "restore errors: $(grep -c ERROR "$DIR/restore_errors.txt")"
P -d qb_test -Atc "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')" 
