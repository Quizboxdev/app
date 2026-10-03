# Release Readiness

NOT READY

- approved_production_content: FAIL (Approved content not verified)
- rpc_privileges: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- rls: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- signup_provisioning: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- dependencies: MANUAL VERIFICATION REQUIRED (Fresh authenticated audit unavailable; not certified from stale receipts)
- quality_gates: FAIL (Current run: typecheck, lint, tests, build and content verification)
- authenticated_regression: FAIL (CONFIGURATION: ACCEPTANCE_ENVIRONMENT_REQUIRED; 0 passed, 95 not executed)
- leaked_password_protection: FAIL (MANAGEMENT_TOKEN_REQUIRED_FOR_POSITIVE_CONFIG_VERIFICATION)
- test_credential_rotation: FAIL (ACCEPTANCE_ENVIRONMENT_REQUIRED)
- backup_restore: PASS (Isolated restore execution, schema/data checksums, FK integrity and storage verification required)
- content_operator_authentication: FAIL (Update current admin credential in ignored local environment; no user discovery or reset performed)
