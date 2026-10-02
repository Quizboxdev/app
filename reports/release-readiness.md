# Release Readiness

NOT READY

- approved_production_content: FAIL (0 approved in latest read-only content receipt; authenticated release audit unavailable)
- rpc_privileges: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- rls: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- signup_provisioning: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- dependencies: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- quality_gates: PASS (Current run: typecheck, lint, tests, build and content verification)
- authenticated_regression: FAIL (Current run requires QB_LIVE_ACCEPTANCE=1 and acceptance environment credentials)
- leaked_password_protection: MANUAL VERIFICATION REQUIRED (Live security advisor reports protection disabled; enable and reverify in Supabase Auth)
- test_credential_rotation: MANUAL VERIFICATION REQUIRED (Previously committed/shared test passwords must be rotated or accounts isolated; no history rewrite performed)
- backup_restore: MANUAL VERIFICATION REQUIRED (Infrastructure backup and isolated database restore drill need operator verification)
- content_operator_authentication: FAIL (Update current admin credential in ignored local environment; no user discovery or reset performed)
