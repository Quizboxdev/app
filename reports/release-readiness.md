# Release Readiness

NOT READY

- CONTENT / approved_production_content: FAIL (0 active approved mapped production questions)
- SECURITY / rpc_privileges: PASS (0 unexpected anonymous definer grants)
- DATABASE / rls: PASS (0 public tables without RLS)
- AUTH / signup_provisioning: PASS (quizbox_signup_profile trigger)
- SECURITY / dependencies: PASS (0 high/critical dependency findings)
- APPLICATION / quality_gates: PASS (Current run: typecheck, lint, tests, build and content verification)
- APPLICATION / authenticated_regression: PASS (Current run requires QB_LIVE_ACCEPTANCE=1 and acceptance environment credentials)
- AUTH / leaked_password_protection: MANUAL VERIFICATION REQUIRED (Live security advisor reports protection disabled; enable and reverify in Supabase Auth)
- SECURITY / test_credential_rotation: MANUAL VERIFICATION REQUIRED (Previously committed/shared test passwords must be rotated or accounts isolated; no history rewrite performed)
- OPERATIONS / backup_restore: MANUAL VERIFICATION REQUIRED (Infrastructure backup and isolated database restore drill need operator verification)
- SECURITY / production_content: FAIL (questions active/approved mapped, excluding both fixture namespaces)
