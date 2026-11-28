#!/usr/bin/env python3
"""Concurrency and capacity test for the inter-school migrations on a throwaway LOCAL PostgreSQL cluster. Nothing outside this machine is contacted.

  python scripts/interschool/concurrency_test.py --pg-bin <PostgreSQL bin folder> [--client-bin <folder with psql and pgbench>] [--out report.md]

Builds the same stand-in database as the vitest suites (lib/core/interschool-fixture.ts) plus 1,200 extra learners, applies the five migrations unchanged, then uses pgbench
to hit the database functions from many connections at once. It measures this computer's database only: no web server, network, authentication service or connection pooler.
"""
import argparse, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser(); ap.add_argument("--pg-bin", required=True); ap.add_argument("--client-bin", default="", help="folder with psql and pgbench, if not the server folder"); ap.add_argument("--port", default="55447"); ap.add_argument("--out", default="")
args = ap.parse_args()
BIN = Path(args.pg_bin); CLIENT = Path(args.client_bin or args.pg_bin)
exe = lambda n: str((CLIENT if n in ("psql", "pgbench") else BIN) / (n + (".exe" if os.name == "nt" else "")))
TMP = Path(tempfile.mkdtemp(prefix="is-conc-")); DATA = TMP / "data"
env = {k: v for k, v in os.environ.items() if not k.upper().startswith("PG")}; env["PGCLIENTENCODING"] = "UTF8"
CONN = ["-h", "127.0.0.1", "-p", args.port, "-U", "postgres"]
fails, lines = [], []
def say(s=""): print(s, flush=True); lines.append(s)
def expect(label, ok, detail=""):
    say(f"- {'PASS' if ok else 'FAIL'}: {label}" + (f" ({detail})" if detail else "")); ok or fails.append(label)
def sql(text, db="istest"):
    f = TMP / "step.sql"; f.write_text(text, encoding="utf-8")
    p = subprocess.run([exe("psql"), "-X", "-q", *CONN, "-d", db, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", str(f)], capture_output=True, text=True, encoding="utf-8", env=env)
    if p.returncode: sys.exit("SQL failed:\n" + p.stderr[-2000:])
    return p.stdout.strip()
def bench(script, clients, per_client):
    f = TMP / "bench.sql"; f.write_text(script, encoding="utf-8")
    t0 = time.time()
    p = subprocess.run([exe("pgbench"), *CONN, "-n", "-f", str(f), "-c", str(clients), "-j", "8", "-t", str(per_client), "istest"], capture_output=True, text=True, env=env, timeout=900)
    out = p.stdout + p.stderr
    if p.returncode: sys.exit("pgbench failed:\n" + out[-2000:])
    m = lambda rx: (re.search(rx, out) or [None, "?"])[1]
    return {"clients": clients, "calls": clients * per_client, "seconds": round(time.time() - t0, 1), "tps": m(r"tps = ([\d.]+)"), "latency_ms": m(r"latency average = ([\d.]+)"), "failed": m(r"number of failed transactions: (\d+)")}
def row(name, r): say(f"| {name} | {r['clients']} | {r['calls']:,} | {r['seconds']} | {r['tps']} | {r['latency_ms']} |")

fixture = subprocess.run(["npx.cmd" if os.name == "nt" else "npx", "tsx", "-e", "import('./lib/core/interschool-fixture').then(m => process.stdout.write(m.baseSql()))"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
if fixture.returncode or "create table" not in fixture.stdout: sys.exit("could not build the stand-in schema:\n" + fixture.stderr[-1500:])
subprocess.run([exe("initdb"), "-D", str(DATA), "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"], check=True, capture_output=True, env=env)
subprocess.run([exe("pg_ctl"), "-D", str(DATA), "-o", f"-p {args.port} -h 127.0.0.1 -c max_connections=250", "-l", str(TMP / "pg.log"), "-w", "start"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
try:
    sql("create database istest;", db="postgres")
    sql(fixture.stdout)
    for m in sorted((ROOT / "supabase" / "migrations").glob("202611261*_interschool_*.sql")): sql(m.read_text(encoding="utf-8"))
    version = sql("select version();")
    ADMIN = "00000000-0000-4000-8000-000000000001"; SCHOOLS = [f"00000000-0000-4000-8000-{100 + n:012d}" for n in range(1, 7)]; MATH7 = "00000000-0000-4000-8000-000000000307"
    sql(f"""
      update public.platform_settings set value='true' where key like 'flags.interschool%';
      insert into public.profiles select ('10000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid, 'student', 'active', 'Load Learner' || g, 'load' || g || '@example.com' from generate_series(1,1200) g;
      insert into public.student_profiles(user_id, grade_code, institution_id) select ('10000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid, 'B7', (array[{','.join(f"'{s}'" for s in SCHOOLS)}]::uuid[])[(g % 6) + 1] from generate_series(1,1200) g;
      insert into public.institution_memberships select institution_id, user_id, 'student', 'active' from public.student_profiles where user_id::text like '10000000%';
      create schema load;
      create sequence load.n;
      create table load.target(slug text, competition uuid, division uuid, round uuid);
      create table load.outcomes(kind text, result text);
      create function load.learner(g bigint) returns uuid language sql immutable as $$ select ('10000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid $$;
      create function load.act(p_user uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', p_user::text, true) $$;
    """)
    def make(title, extra):
        sql(f"""
          do $$ declare c jsonb; d jsonb; begin
            perform set_config('request.jwt.claim.sub','{ADMIN}',false);
            c := public.interschool_create(jsonb_build_object('title','{title}','participation','OPEN','registration_opens_at',now()-interval '1 day','registration_closes_at',now()+interval '2 day','opens_at',now(),'ends_at',now()+interval '30 day') || '{extra}'::jsonb);
            d := public.interschool_set_divisions((c->>'id')::uuid, '[{{"level_codes":["B7"]}}]');
            perform public.interschool_set_rounds((d->'divisions'->0->>'id')::uuid, jsonb_build_array(jsonb_build_object('title','R1','opens_at',now()+interval '3 day','closes_at',now()+interval '4 day','duration_seconds',1800,'sections',jsonb_build_array(jsonb_build_object('subject_id','{MATH7}','count',20)))));
            perform public.interschool_publish((c->>'id')::uuid);
            delete from load.target;
            insert into load.target select c->>'slug', (c->>'id')::uuid, (d->'divisions'->0->>'id')::uuid, (select id from quizbox_interschool.rounds where division_id=(d->'divisions'->0->>'id')::uuid);
          end $$;
          alter sequence load.n restart; truncate load.outcomes;
        """)
        return sql("select competition from load.target;")
    register = """
      create or replace function load.register(g bigint) returns void language plpgsql as $$
      declare t load.target; school uuid; r jsonb;
      begin
        select * into t from load.target; perform load.act(load.learner(g));
        select institution_id into school from public.student_profiles where user_id = load.learner(g);
        r := public.interschool_register(t.slug, t.division, school);
        insert into load.outcomes values ('register', r->>'status');
      exception when others then insert into load.outcomes values ('register', sqlerrm);
      end $$;"""
    sql(register)
    say("# Inter-school concurrency and capacity test"); say()
    say(f"Run on {time.strftime('%Y-%m-%d')} on a developer laptop. {version.split(',')[0]}. Local database only."); say()

    say("## 1. Oversubscription: 600 learners, 150 places, 40 per school, 100 connections")
    comp = make("Race one", '{"capacity":150,"expected_participants":150,"max_per_school":40}')
    r1 = bench("select load.register(nextval('load.n'));", 100, 6)
    held = int(sql(f"select count(*) from quizbox_interschool.candidates where competition_id='{comp}' and status in ('PENDING','CONFIRMED')"))
    worst = int(sql(f"select max(n) from (select count(*) n from quizbox_interschool.candidates where competition_id='{comp}' and status in ('PENDING','CONFIRMED') group by institution_id) x"))
    expect("exactly the capacity is filled, never more", held == 150, f"{held} of 150")
    expect("no school goes over its allocation", worst <= 40, f"largest school {worst} of 40")
    kinds = sql("select result || ' x' || count(*) from load.outcomes group by result order by count(*) desc"); say(f"- Answers given: {', '.join(kinds.splitlines())}")
    expect("every call got an answer", int(sql("select count(*) from load.outcomes")) == 600)

    say(); say("## 2. Waiting list and school limit: 300 learners, 60 places, 3 schools allowed")
    comp = make("Race two", '{"capacity":60,"expected_participants":60,"waitlist":true,"max_schools":3}')
    r2 = bench("select load.register(nextval('load.n'));", 100, 3)
    held = int(sql(f"select count(*) from quizbox_interschool.candidates where competition_id='{comp}' and status in ('PENDING','CONFIRMED')"))
    schools = int(sql(f"select count(*) from quizbox_interschool.school_entries where competition_id='{comp}' and status='REGISTERED'"))
    total = int(sql(f"select count(*) from quizbox_interschool.candidates where competition_id='{comp}'"))
    expect("places filled exactly, the rest queued", held == 60 and total == 300, f"held {held}, rows {total}")
    expect("no more schools than allowed", schools == 3, f"{schools} of 3")

    say(); say("## 3. The same learner from many devices")
    comp = make("Race three", '{"capacity":500,"expected_participants":500}')
    bench("select load.register(7);", 50, 4)
    expect("one registration only", int(sql(f"select count(*) from quizbox_interschool.candidates where competition_id='{comp}'")) == 1)
    sql("update quizbox_interschool.rounds set opens_at=now()-interval '1 hour', closes_at=now()+interval '3 hour' where id=(select round from load.target);")
    sql("""create or replace function load.sit(g bigint, finish boolean) returns void language plpgsql as $$
      declare t load.target; v jsonb;
      begin
        select * into t from load.target; perform load.act(load.learner(g));
        v := public.interschool_start(t.round);
        if finish then
          perform public.interschool_submit((v->>'sitting_id')::uuid, (select jsonb_agg(jsonb_build_object('question_id', q->>'id', 'choice', 0)) from jsonb_array_elements(v->'questions') q));
        end if;
        insert into load.outcomes values ('sit', 'ok');
      exception when others then insert into load.outcomes values ('sit', sqlerrm);
      end $$;""")
    bench("select load.sit(7, false);", 50, 4)
    expect("one sitting only", int(sql("select count(*) from quizbox_interschool.sittings where round_id=(select round from load.target)")) == 1)
    bench("select load.sit(7, true);", 50, 2)
    expect("one submission, one score", sql("select count(*) || ' ' || count(submitted_at) from quizbox_interschool.sittings where round_id=(select round from load.target)") == "1 1")

    say(); say("## 4. The same payment arriving many times")
    sql(f"""do $$ declare c jsonb; q jsonb; i jsonb; begin
        perform set_config('request.jwt.claim.sub','{ADMIN}',false);
        perform public.interschool_set_rate(500,0);
        c := public.interschool_create('{{"title":"Paid race","funding":"SPONSORED","capacity":100,"expected_participants":100,"sponsor_name":"Test Sponsor"}}');
        q := public.interschool_quote((c->>'id')::uuid); i := public.interschool_decide_quote((q->>'id')::uuid, true);
        create table load.pay as select (public.interschool_payment_start((i->>'id')::uuid))->>'reference' as ref, n from generate_series(1,5) n;
      end $$;""")
    bench("\\set a random(1,5)\n\\set e random(1,10)\nselect public.interschool_payment_apply('paystack', 'ev-' || :a || '-' || :e, ref, 'successful', 'p-' || :a, 50000, 'GHS') from load.pay where n = :a;", 50, 6)
    paid = sql("select count(*) filter (where status='successful') || ' ' || count(*) filter (where status='duplicate') from quizbox_interschool.payment_attempts")
    funded = sql("select funded_participants from quizbox_interschool.competitions where title='Paid race'")
    expect("one payment funds the invoice, the others are flagged for refund", paid.startswith("1 ") and funded == "100", f"successful/duplicate = {paid}, funded {funded}")

    say(); say("## 5. Throughput on this computer"); say()
    say("| Step | Connections | Calls | Seconds | Calls per second | Average ms |"); say("|---|--:|--:|--:|--:|--:|")
    row("Registration, contested (test 1)", r1); row("Registration with waiting list (test 2)", r2)
    comp = make("Load", '{"capacity":5000,"expected_participants":5000}')
    row("Registration, 1,200 learners, places free", bench("select load.register(nextval('load.n'));", 100, 12))
    sql("update quizbox_interschool.rounds set opens_at=now()-interval '1 hour', closes_at=now()+interval '3 hour' where id=(select round from load.target); alter sequence load.n restart; truncate load.outcomes;")
    row("Start a 20-question paper", bench("select load.sit(nextval('load.n'), false);", 100, 12))
    sql("alter sequence load.n restart;")
    row("Save one answer", bench("\\set g random(1,1200)\nselect load.act(load.learner(:g)) \\; select public.interschool_save(s.id, jsonb_build_array(jsonb_build_object('question_id', q.id, 'choice', 1))) from quizbox_interschool.sittings s join lateral (select id from quizbox_interschool.paper_questions where paper_id=s.paper_id limit 1) q on true where s.user_id = load.learner(:g) and s.round_id = (select round from load.target);", 100, 40))
    row("Reopen and submit", bench("select load.sit(nextval('load.n'), true);", 100, 12))
    done = int(sql("select count(submitted_at) from quizbox_interschool.sittings where round_id=(select round from load.target)"))
    expect("all 1,200 sittings submitted without errors", done == 1200 and sql("select count(*) from load.outcomes where result<>'ok'") == "0", f"{done} submitted")
    sql("update quizbox_interschool.rounds set closes_at=now()-interval '1 minute' where id=(select round from load.target); update quizbox_interschool.sittings set started_at=now()-interval '2 hour', expires_at=now()-interval '1 hour' where round_id=(select round from load.target) and submitted_at is null;")
    t0 = time.time(); sql(f"select set_config('request.jwt.claim.sub','{ADMIN}',false); select public.interschool_finalise_round((select round from load.target));")
    say(f"| Finalise a round of 1,200 learners | 1 | 1 | {round(time.time() - t0, 2)} | - | - |")
    expect("results cover every learner", int(sql("select count(*) from quizbox_interschool.round_results where round_id=(select round from load.target)")) == 1200)
    row("Public competition page", bench("select public.interschool_public_get((select slug from load.target));", 100, 20))
    say(); say("These figures are the database on one laptop with no web server, network, authentication or connection pooler in between. They show that the rules hold under contention and give an order of magnitude; they are NOT a measure of what the hosted Preview or Production plan can carry.")
finally:
    subprocess.run([exe("pg_ctl"), "-D", str(DATA), "-m", "fast", "-w", "stop"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    shutil.rmtree(TMP, ignore_errors=True)
say(); say(f"Failures: {fails or 'none'}")
if args.out: Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
sys.exit(1 if fails else 0)
