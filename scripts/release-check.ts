import { spawnSync } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { validatePublicEnvironment } from "../lib/env";
import { acceptancePassword } from "../lib/operations/safety";
import { acceptanceAccount, ACCEPTANCE_ROLES } from "../lib/operations/acceptance";
import { credentialEvidenceValid, freshEvidence, restoreEvidenceValid } from "../lib/operations/release-evidence";
import { verifyReleaseSecurity } from "./verify-release-security";
import { runLiveAcceptance } from "./run-live-acceptance";
import { releaseGates, releaseBlocked } from "../lib/operations/release";
import { auditSecurity } from "./security-readiness";
async function main() {
  try { process.loadEnvFile(".env.local"); } catch { /* The environment may be supplied by CI. */ }
  validatePublicEnvironment({NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  let credentials=false;try{
    if(process.env.QB_ENVIRONMENT==="acceptance") {
      const student=acceptanceAccount("student"),admin=acceptanceAccount("admin");
      process.env.QB_ACCEPTANCE_PASSWORD ??= student.password;
      process.env.QB_CONTENT_OPERATOR_EMAIL ??= admin.email;
      process.env.QB_CONTENT_OPERATOR_PASSWORD ??= admin.password;
    }
    acceptancePassword();credentials=true;
  }catch{console.error("Authenticated acceptance credentials/environment missing; release remains blocked.");}
  const project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
  const verification=await verifyReleaseSecurity();
  let credentialsVerified=false;try{credentialsVerified=credentialEvidenceValid(verification.credentials,project,ACCEPTANCE_ROLES.map(role=>acceptanceAccount(role)));}catch{/* Missing/old credentials never certify rotation. */}
  let restoreVerified=false;try{restoreVerified=restoreEvidenceValid(JSON.parse(await readFile('reports/restore-verification.json','utf8')),project);}catch{/* Missing isolated restore evidence fails closed. */}
  const passwordProtectionVerified=verification.passwordProtection.status==='PASS'&&verification.passwordProtection.enabled===true&&freshEvidence(verification.passwordProtection,project);
  const live=await runLiveAcceptance();
  const authenticatedPassed=live.status==='PASS'&&live.executed>=95&&live.skipped===0;
  const evidence={passwordProtectionVerified,credentialsVerified,restoreVerified};
  const describeEvidence=(gates:ReturnType<typeof releaseGates>)=>{
    gates.find(g=>g.id==='leaked_password_protection')!.evidence=passwordProtectionVerified?'Fresh Auth configuration confirms password_hibp_enabled=true':verification.passwordProtection.reason??'Live Auth configuration reports protection disabled';
    gates.find(g=>g.id==='test_credential_rotation')!.evidence=credentialsVerified?'Current distinct six-account rotation, rejection and known access-token expiry verified':verification.credentials.reason??'Rotation evidence missing';
  };
  const commands=["typecheck","lint","test","build","content:audit","content:validate","content:verify","content:factory -- coverage --server-readonly"];
  const results:Record<string,boolean>={};
  for(const command of commands) {
    const run=spawnSync(process.platform==="win32"?"cmd.exe":"npm",process.platform==="win32"?["/d","/s","/c","npm.cmd run "+command]:["run",...command.split(" ")],{stdio:"inherit",env:command==='test'?{...process.env,QB_LIVE_ACCEPTANCE:'0'}:process.env});
    results[command]=run.status===0;
  }
  let security: Awaited<ReturnType<typeof auditSecurity>>;
  try { security=await auditSecurity(authenticatedPassed); }
  catch {
    // Preserve the release blockers even when operator authentication prevents a fresh audit.
    const gates=releaseGates({approved:0,anonUnexpected:0,rlsDisabled:0,signup:false,dependencyHigh:0,applicationPassed:Object.values(results).every(Boolean),authenticatedPassed,credentialsPresent:credentials,...evidence});
    describeEvidence(gates);
    for (const gate of gates) if (!["approved_production_content","leaked_password_protection","test_credential_rotation","backup_restore","authenticated_regression","quality_gates"].includes(gate.id)) {
      gate.status="MANUAL VERIFICATION REQUIRED";gate.evidence="Fresh authenticated audit unavailable; not certified from stale receipts";
    }
    let coverage: any = null;try { if(results['content:factory -- coverage --server-readonly'])coverage=JSON.parse(await readFile("reports/question-coverage.json","utf8")); } catch { /* Missing content evidence fails closed. */ }
    const approved=gates.find(g=>g.id==="approved_production_content")!;
    approved.status=coverage?.summary.productionApproved>0?'PASS':'FAIL';
    approved.evidence=coverage ? `${coverage.summary.productionApproved} approved in current server-read-only coverage; authenticated release audit unavailable` : "Approved content not verified";
    gates.find(g=>g.id==='authenticated_regression')!.evidence=`${live.category}: ${live.reason??live.status}; ${live.passed} passed, ${live.skipped} not executed`;
    gates.push({category:"AUTH",id:"content_operator_authentication",severity:"P0",status:"FAIL",evidence:"Update current admin credential in ignored local environment; no user discovery or reset performed"});
    const report={generatedAt:new Date().toISOString(),decision:"NOT READY",commands:results,gates,authenticatedAuditAvailable:false};
    await writeFile("reports/release-readiness.json",JSON.stringify(report,null,2));
    await writeFile("reports/release-readiness.md","# Release Readiness\n\nNOT READY\n\n"+gates.map(g=>`- ${g.id}: ${g.status} (${g.evidence})`).join("\n")+"\n");
    console.log(JSON.stringify(report));process.exitCode=1;return;
  }
  const gates=releaseGates({approved:security.live.productionApproved,anonUnexpected:security.live.functions.filter((f:any)=>f.anon&&f.name!=="qb_marketplace_catalog").length,rlsDisabled:security.live.tables.filter((t:any)=>!t.rls).length,signup:security.live.signup_trigger,dependencyHigh:security.dependencies.high+security.dependencies.critical,applicationPassed:Object.values(results).every(Boolean),authenticatedPassed,credentialsPresent:credentials,...evidence});
  describeEvidence(gates);
  for(const finding of security.findings.filter((f)=>f.severity==="P0"&&!['PASS','MANUAL VERIFICATION REQUIRED'].includes(f.status))) {
    if(!gates.some((gate)=>gate.id===finding.id))gates.push({category:"SECURITY",id:finding.id,severity:"P0",status:"FAIL",evidence:finding.reference});
  }
  const report={generatedAt:new Date().toISOString(),decision:releaseBlocked(gates)?"NOT READY":"READY",commands:results,gates};
  await writeFile("reports/release-readiness.json",JSON.stringify(report,null,2));
  await writeFile("reports/release-readiness.md","# Release Readiness\n\n"+report.decision+"\n\n"+gates.map((g)=>"- "+g.category+" / "+g.id+": "+g.status+" ("+g.evidence+")").join("\n")+"\n");
  console.log(JSON.stringify(report));if(releaseBlocked(gates))process.exitCode=1;
}
main().catch(()=>{console.error("RELEASE_CHECK_UNAVAILABLE: fail closed; check operator environment and live RPC deployment.");process.exitCode=1;});
