export interface Gate { category: string; id: string; status: "PASS" | "FAIL" | "MANUAL VERIFICATION REQUIRED"; severity: "P0" | "P1" | "P2"; evidence: string; }
export function releaseGates(input: { approved: number; anonUnexpected: number; rlsDisabled: number; signup: boolean; dependencyHigh: number; applicationPassed: boolean; authenticatedPassed: boolean; credentialsPresent: boolean; passwordProtectionVerified?: boolean; credentialsVerified?: boolean; restoreVerified?: boolean }) : Gate[] {
  const gate = (category: string,id: string,pass: boolean,evidence: string): Gate => ({category,id,status:pass?"PASS":"FAIL",severity:"P0",evidence});
  return [
    gate("CONTENT","approved_production_content",input.approved>0,String(input.approved)+" active approved mapped production questions"),
    gate("SECURITY","rpc_privileges",input.anonUnexpected===0,String(input.anonUnexpected)+" unexpected anonymous definer grants"),
    gate("DATABASE","rls",input.rlsDisabled===0,String(input.rlsDisabled)+" public tables without RLS"),
    gate("AUTH","signup_provisioning",input.signup,"quizbox_signup_profile trigger"),
    gate("SECURITY","dependencies",input.dependencyHigh===0,String(input.dependencyHigh)+" high/critical dependency findings"),
    gate("APPLICATION","quality_gates",input.applicationPassed,"Current run: typecheck, lint, tests, build and content verification"),
    gate("APPLICATION","authenticated_regression",input.authenticatedPassed && input.credentialsPresent,"Current run requires QB_LIVE_ACCEPTANCE=1 and acceptance environment credentials"),
    gate("AUTH","leaked_password_protection",input.passwordProtectionVerified===true,"Fresh Management API configuration must confirm password_hibp_enabled=true"),
    gate("SECURITY","test_credential_rotation",input.credentialsVerified===true,"Six current distinct credentials verified; old passwords/refresh denied and access JWT expiry elapsed"),
    gate("OPERATIONS","backup_restore",input.restoreVerified===true,"Isolated restore execution, schema/data checksums, FK integrity and storage verification required")
  ];
}
export const releaseBlocked = (gates: Gate[]) => gates.some((gate) => gate.severity === "P0" && gate.status !== "PASS");
