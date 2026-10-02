export interface Gate { category: string; id: string; status: "PASS" | "FAIL" | "MANUAL VERIFICATION REQUIRED"; severity: "P0" | "P1" | "P2"; evidence: string; }
export function releaseGates(input: { approved: number; anonUnexpected: number; rlsDisabled: number; signup: boolean; dependencyHigh: number; applicationPassed: boolean; authenticatedPassed: boolean; credentialsPresent: boolean }) : Gate[] {
  const gate = (category: string,id: string,pass: boolean,evidence: string): Gate => ({category,id,status:pass?"PASS":"FAIL",severity:"P0",evidence});
  return [
    gate("CONTENT","approved_production_content",input.approved>0,String(input.approved)+" active approved mapped production questions"),
    gate("SECURITY","rpc_privileges",input.anonUnexpected===0,String(input.anonUnexpected)+" unexpected anonymous definer grants"),
    gate("DATABASE","rls",input.rlsDisabled===0,String(input.rlsDisabled)+" public tables without RLS"),
    gate("AUTH","signup_provisioning",input.signup,"quizbox_signup_profile trigger"),
    gate("SECURITY","dependencies",input.dependencyHigh===0,String(input.dependencyHigh)+" high/critical dependency findings"),
    gate("APPLICATION","quality_gates",input.applicationPassed,"Current run: typecheck, lint, tests, build and content verification"),
    gate("APPLICATION","authenticated_regression",input.authenticatedPassed && input.credentialsPresent,"Current run requires QB_LIVE_ACCEPTANCE=1 and acceptance environment credentials"),
    {category:"AUTH",id:"leaked_password_protection",status:"MANUAL VERIFICATION REQUIRED",severity:"P0",evidence:"Live security advisor reports protection disabled; enable and reverify in Supabase Auth"},
    {category:"SECURITY",id:"test_credential_rotation",status:"MANUAL VERIFICATION REQUIRED",severity:"P0",evidence:"Previously committed/shared test passwords must be rotated or accounts isolated; no history rewrite performed"},
    {category:"OPERATIONS",id:"backup_restore",status:"MANUAL VERIFICATION REQUIRED",severity:"P0",evidence:"Infrastructure backup and isolated database restore drill need operator verification"}
  ];
}
export const releaseBlocked = (gates: Gate[]) => gates.some((gate) => gate.severity === "P0" && gate.status !== "PASS");
