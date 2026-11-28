import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, SCHOOLS, SPONSOR_OK, helpers, learner, makeDb, staff, type Db } from "./interschool-fixture";

// The screens read these names (lib/interschool/types.ts). If a database function stops returning one, a screen would silently show nothing, so each answer is checked here.
let db: Db;
let t: ReturnType<typeof helpers>;
beforeAll(async () => { db = await makeDb(); t = helpers(db); await t.on(); await t.setting("flags.interschool_certificates", true); }, 60_000);
afterAll(async () => { await db.close(); });
const has = (value: unknown, keys: string, where: string) => { expect(value, where).toBeTruthy(); expect(keys.split(" ").filter((k) => !(k in (value as object))), where).toEqual([]); };
const SETTINGS = "title description sponsor_name sponsor_logo_url flyer_url scale region district participation entry_mode registration_mode funding max_schools max_per_school max_per_level_per_school expected_participants capacity waitlist registration_opens_at registration_closes_at opens_at ends_at rules prizes school_scoring scoring_top_n min_candidates score_carry";

describe("what each screen is given", () => {
  it("matches the shapes the screens read, from draft to certificate", async () => {
    await t.as(ADMIN); await t.rpc("select public.interschool_set_rate(500,0)");
    const c = await t.competition(SPONSOR_OK, { publish: false, settings: { funding: "SPONSORED", participation: "OPEN", sponsor_name: "Gold Bank", capacity: 20, expected_participants: 20 },
      rounds: (s) => [t.round(1, s, { format: "KNOCKOUT", rule: "FIXTURE_WINNERS" })] });
    await t.as(SPONSOR_OK);
    const managed = await t.rpc<any>("select public.interschool_manage_get($1)", [c.id]);
    has(managed, `${SETTINGS} id slug status organiser_kind is_admin needs_approval approved_at decision_note listed_at funded_participants funding_cleared_at divisions`, "manage_get");
    has(managed.divisions[0], "id title level_codes mixed position capacity rounds", "division");
    has(managed.divisions[0].rounds[0], "id round_no title format stage opens_at closes_at duration_seconds sections rule pass_percent top_n frozen", "round");
    has(await t.rpc("select public.interschool_manage_list()"), "can_create competitions", "manage_list");
    const check = await t.rpc<any>("select public.interschool_check($1)", [c.id]);
    has(check, "problems questions needs_approval approved", "check"); has(check.questions[0].sections[0], "subject_id subject need have ok short", "section report");
    expect((await t.rpc<any[]>("select public.interschool_subjects($1)", [["B7"]]))[0]).toMatchObject({ level: "B7", questions: 120 });
    const quote = await t.rpc<any>("select public.interschool_quote($1)", [c.id]);
    has(quote, "id version sponsor_name participants rate_minor setup_fee_minor discount_minor discount_reason total_minor currency status valid_until", "quote");
    const invoice = await t.rpc<any>("select public.interschool_decide_quote($1,true)", [quote.id]);
    has(invoice, "id number sponsor_name participants amount_minor currency status due_at paid_at funding_note", "invoice");
    await t.rpc("select public.interschool_request_approval($1)", [c.id]);
    await t.as(ADMIN);
    has((await t.rpc<any>("select public.interschool_admin_overview()")).waiting_approval[0], "id title organiser kind participation funding capacity", "approval row");
    await t.rpc("select public.interschool_decide($1,true,null)", [c.id]);
    const overview = await t.rpc<any>("select public.interschool_admin_overview()");
    has(overview, "by_status waiting_approval unpaid_invoices refunds_to_review open_disputes rounds_to_finalise settings", "overview");
    has(overview.unpaid_invoices[0], "id number competition_id competition sponsor amount_minor status due_at", "unpaid row");
    await t.rpc("select public.interschool_fund_invoice($1,'RECORD_PAYMENT','Bank transfer 7')", [invoice.id]);
    await t.as(SPONSOR_OK); await t.rpc("select public.interschool_publish($1)", [c.id]);
    await t.as(ADMIN); await t.rpc("select public.interschool_set_listed($1,true)", [c.id]);

    await t.as(staff(1)); await t.rpc("select public.interschool_school_respond($1,$2,true)", [c.id, SCHOOLS[0]]);
    const home = await t.rpc<any[]>("select public.interschool_school_home()");
    has(home[0], "institution_id school competitions", "school home");
    has(home[0].competitions[0], "id slug title status participation registration_closes_at opens_at entry_status registration places_used max_per_school", "school row");
    const learners = await t.rpc<any[]>("select public.interschool_school_learners($1,$2,$3)", [c.id, SCHOOLS[0], c.divisions[0]]);
    has(learners[0], "user_id name level", "learner");
    await t.nominate(c.id, 1, c.divisions[0], [learner(1, 7, 1)]); await t.nominate(c.id, 2, c.divisions[0], [learner(2, 7, 1)]);
    await t.as(staff(1));
    const roster = await t.rpc<any>("select public.interschool_school_roster($1,$2)", [c.id, SCHOOLS[0]]);
    has(roster, "competition school entry_status locked divisions", "roster"); has(roster.competition, "id slug title status rules registration registration_closes_at registration_mode max_per_school max_per_level_per_school", "roster competition");
    has(roster.divisions[0].candidates[0], "id user_id name status verified", "candidate");

    await t.as(ADMIN); await t.rpc("select public.interschool_generate_fixtures($1,'KNOCKOUT')", [c.divisions[0]]);
    const [round] = await t.rounds(c.divisions[0]);
    await t.openRound(round);
    await t.as(learner(1, 7, 2));
    const options = await t.rpc<any>("select public.interschool_join_options($1)", [c.slug]);
    has(options, "id slug title rules registration registration_mode learner managed level individual_allowed divisions schools mine", "join options"); has(options.schools[0], "id name verified_member can_enter", "join school");
    const { view } = await t.play(learner(1, 7, 1), round, 3, false);
    has(view, "sitting_id expires_at server_time submitted resumed title questions", "sitting"); has(view.questions[0], "id question_text options chosen", "question");
    const mine = await t.rpc<any[]>("select public.interschool_mine()");
    has(mine[0], "candidate_id status status_reason competition division school can_withdraw rounds", "mine");
    has(mine[0].rounds[0], "round_id round_no title question_count duration_seconds opens_at closes_at state opponent result", "my round");
    expect(mine[0].rounds[0]).toMatchObject({ state: "IN_PROGRESS", opponent: "School 2 Academy" });
    await t.rpc("select public.interschool_submit($1,null)", [view.sitting_id]);
    await t.play(learner(2, 7, 1), round, 1);
    await t.closeRound(round); await t.as(ADMIN); await t.rpc("select public.interschool_finalise_round($1)", [round]);

    const results = await t.rpc<any>("select public.interschool_results($1)", [round]);
    has(results, "finalised competition division round rule schools learners fixtures", "results");
    has(results.schools[0], "institution_id school rank score total_score present entered eligible qualified", "school result");
    has(results.learners[0], "candidate_id name school score max_score percent total_score rank qualified absent seconds", "learner result");
    has(results.fixtures[0], "home away home_score away_score winner note status", "fixture result");
    const ops = await t.rpc<any>("select public.interschool_operations($1)", [c.id]);
    has(ops.rounds[0], "round_id division_id division round_no title format rule opens_at closes_at finalised_at started submitted fixtures", "operations round");
    has(ops.rounds[0].fixtures[0], "id home away scheduled_at closes_at status group_no winner home_score away_score note", "operations fixture");
    const reg = await t.rpc<any>("select public.interschool_registrations($1)", [c.id]);
    has(reg, "registration capacity expected held waiting schools divisions sources views", "registrations"); has(reg.schools[0], "institution_id school region status source locked confirmed pending waiting", "registration school");
    const billing = await t.rpc<any>("select public.interschool_billing($1)", [c.id]);
    has(billing, "funding funded_participants capacity funding_cleared rate_minor setup_fee_minor billing_on quotations invoices figures", "billing");
    has(billing.figures, "schools_registered schools_invited expected_participants funded_participants registered_participants took_part regions rounds sources page_views shares", "figures");
    await t.as(SPONSOR_OK);
    has((await t.rpc<any[]>("select public.interschool_sponsor_home()"))[0], "id slug title status funding organiser capacity funding_cleared registration quotations invoices figures", "sponsor home");
    await t.as(ADMIN); await t.rpc("select public.interschool_issue_certificates($1)", [c.id]);
    await t.as(learner(1, 7, 1));
    const certificates = await t.rpc<any[]>("select public.interschool_my_certificates()");
    has(certificates[0], "code kind recipient school competition division issued_at mine", "certificate");
    await t.as("service");
    has(await t.rpc("select public.interschool_verify_certificate($1)", [certificates[0].code]), "code kind competition division school issued_at recipient valid revoked_at", "verification");
    const page = await t.rpc<any>("select public.interschool_public_get($1)", [c.slug]);
    has(page, "id slug title description status participation entry_mode registration_mode scale region district sponsor_name sponsor_logo_url flyer_url host rules prizes funding school_scoring registration registration_opens_at registration_closes_at opens_at ends_at schools_registered max_schools places_left max_per_school divisions listed", "public page");
    has(page.divisions[0], "id title level_codes subjects rounds", "public division");
    has(page.divisions[0].rounds[0], "round_no title opens_at closes_at question_count duration_seconds rule pass_percent top_n", "public round");
    const published = await t.rpc<any[]>("select public.interschool_public_results($1)", [c.slug]);
    has(published[0], "division round_no round schools leaders", "public results"); has(published[0].leaders[0], "rank name school percent", "leader");
    // a completed competition leaves the promotional list
    expect(await t.rpc("select public.interschool_public_list()")).toEqual([]);
  });
});
