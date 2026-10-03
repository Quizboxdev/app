-- READ-ONLY release-data verification. Run against a target with:
--   supabase db query --linked -f scripts/release-data-verification.sql
-- Every row must report pass=true on production. Expected failures on a data-cloned test branch are
-- the test-market and fixture rows (that is how leakage would be detected).
select * from (
 select 'fixtures.not_public' as check_id,
  not exists(select 1 from pg_proc where proname='question_allowed' and pronamespace='quizbox_market'::regnamespace and prosrc not like '%DEV_ACCEPTANCE_FIXTURE%qb_is_acceptance_actor%') as pass,
  'DEV_ACCEPTANCE_FIXTURE questions are denied to non-acceptance users by question_allowed' as detail
 union all select 'fixtures.no_branch_fixture_questions', not exists(select 1 from public.questions where source_type in ('TESTLAND_FIXTURE')),
  'No TESTLAND_FIXTURE questions'
 union all select 'markets.no_test_market_active', not exists(select 1 from public.markets where is_test and status='ACTIVE'),
  'No test market is ACTIVE'
 union all select 'markets.test_visibility_off', not exists(select 1 from public.feature_flags where feature_code='TEST_MARKETS_VISIBLE' and enabled),
  'TEST_MARKETS_VISIBLE is disabled'
 union all select 'users.no_synthetic_accounts', not exists(select 1 from auth.users where email like '%@e2e.quizbox.invalid'),
  'No synthetic e2e accounts'
 union all select 'content.qbtest_review_only', not exists(select 1 from public.questions q where q.subject_code='QBTEST' and (q.status::text='active' or exists(select 1 from public.legacy_content_attributions l where l.question_id=q.id))),
  'QBTEST questions remain inactive and unattributed'
 union all select 'content.gh_source_unresolved_or_proven', not exists(select 1 from public.market_curricula mc join public.curricula c on c.id=mc.curriculum_id where c.code='GH-SOURCE' and mc.authority_id is not null and (c.source_name is null or c.source_hash is null)),
  'GH-SOURCE has no authority unless provenance is recorded'
 union all select 'factory.no_mock_campaigns', not exists(select 1 from quizbox_factory.campaigns where provider in ('mock','local-sample') or name ilike '%(branch)%'),
  'No Content Factory campaigns using the branch mock provider'
 union all select 'factory.no_branch_test_config', not exists(select 1 from public.source_documents where title ilike '[BRANCH TEST]%') and not exists(select 1 from public.compensation_policies where name ilike '[BRANCH TEST]%'),
  'No branch-test source documents or compensation policies'
 union all select 'competitions.no_demo_published', not exists(select 1 from public.competitions where status='PUBLISHED' and title ~* '(demo|challenge 2|multi-market challenge|global challenge)'),
  'No branch demo competitions are published'
) checks order by pass, check_id;
