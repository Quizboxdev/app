# Production Security Readiness

- P0 rpc_anonymous_execute: PASS (pg_proc ACL; qb_production_security_audit)
- P0 public_rls: PASS (pg_class.relrowsecurity)
- P0 signup: PASS (auth.users trigger quizbox_signup_profile; fixed STUDENT role)
- P0 dependencies: PASS (package-lock.json; npm audit)
- P0 production_content: FAIL (questions active/approved mapped, excluding both fixture namespaces)
- P0 test_credential_rotation: MANUAL VERIFICATION REQUIRED (Historical acceptance password fallback removed from lib/learning/practice.live.test.ts, factory.live.test.ts and scripts/verify-practice-acceptance.ts; history not rewritten)
- P0 leaked_password_protection: FAIL (Live Supabase advisor receipt 2026-10-02T01:02:54.265Z; Authentication > Attack Protection)
- P0 backup_restore: MANUAL VERIFICATION REQUIRED (docs/production-closure.md; no production restore performed)
- P1 legacy_authorization: PARTIAL (Every public SECURITY DEFINER inventoried; fixed nullable-role bypass, admin gates, tenant analytics and competition summary scope. Full seller/sponsor/competition mutation matrix not exercised)
- P1 durable_abuse: PASS (quizbox_private.operation_budgets; class_join errors return committed counters; per-actor minute/hour windows)
- P0 answer_keys: PASS (factory.live.test.ts and practice.live.test.ts; raw question detail functions revoked)
- P0 secret_handling: PASS (.gitignore; tracked local environment and actual service-key literal scan; separate staged-file verification required)
- P1 media: PASS (private question-media bucket; attempt snapshot storage policy; app/api/content/media/route.ts)

Public catalogue is the only intentional anonymous definer endpoint.
