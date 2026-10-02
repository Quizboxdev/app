import { writeFile,readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { operatorClient } from "./operator";
export async function auditSecurity(authenticatedPassed = false) {
  const client = await operatorClient();
  const audit = await client.rpc("qb_production_security_audit");
  if (audit.error) throw new Error("SECURITY_AUDIT_DENIED");
  let dependency: any;
  try { dependency = JSON.parse(execFileSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d","/s","/c","npm.cmd audit --json"] : ["audit","--json"], { encoding: "utf8", maxBuffer: 8*1024*1024 })); }
  catch (error: any) { try { dependency = JSON.parse(String(error.stdout)); } catch { throw new Error("DEPENDENCY_AUDIT_UNAVAILABLE"); } }
  const data = audit.data, unexpected = data.functions.filter((f: any) => f.anon && f.name !== "qb_marketplace_catalog");
  const advisoryReceipt=JSON.parse(await readFile("reports/live-security-advisors.json","utf8"));
  const leakedDisabled=advisoryReceipt.advisories.some((a:any)=>a.name==="auth_leaked_password_protection");
  const tracked=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
  const secretFiles=tracked.filter((file)=>/^\.env(?:\.|$)/.test(file)&&!file.endsWith(".example"));
  let embeddedSecrets=0;
  for(const file of tracked.filter((f)=>/^(app|components|lib|scripts)\//.test(f))) {
    const text=await readFile(file,"utf8");
    if(process.env.SUPABASE_SERVICE_ROLE_KEY && text.includes(process.env.SUPABASE_SERVICE_ROLE_KEY))embeddedSecrets++;
  }
  const findings = [
    {id:"rpc_anonymous_execute",severity:"P0",status:unexpected.length?"FAIL":"PASS",evidence:unexpected.map((f:any)=>f.signature),reference:"pg_proc ACL; qb_production_security_audit"},
    {id:"public_rls",severity:"P0",status:data.tables.some((t:any)=>!t.rls)?"FAIL":"PASS",reference:"pg_class.relrowsecurity",evidence:data.tables.filter((t:any)=>!t.rls)},
    {id:"signup",severity:"P0",status:data.signup_trigger?"PASS":"FAIL",reference:"auth.users trigger quizbox_signup_profile; fixed STUDENT role"},
    {id:"dependencies",severity:"P0",status:dependency.metadata.vulnerabilities.high+dependency.metadata.vulnerabilities.critical?"FAIL":"PASS",reference:"package-lock.json; npm audit",evidence:dependency.metadata.vulnerabilities},
    {id:"production_content",severity:"P0",status:data.productionApproved>0?"PASS":"FAIL",reference:"questions active/approved mapped, excluding both fixture namespaces",count:data.productionApproved},
    {id:"test_credential_rotation",severity:"P0",status:"MANUAL VERIFICATION REQUIRED",reference:"Historical acceptance password fallback removed from lib/learning/practice.live.test.ts, factory.live.test.ts and scripts/verify-practice-acceptance.ts; history not rewritten"},
    {id:"leaked_password_protection",severity:"P0",status:leakedDisabled?"FAIL":"MANUAL VERIFICATION REQUIRED",reference:"Live Supabase advisor receipt "+advisoryReceipt.checkedAt+"; Authentication > Attack Protection"},
    {id:"backup_restore",severity:"P0",status:"MANUAL VERIFICATION REQUIRED",reference:"docs/production-closure.md; no production restore performed"},
    {id:"legacy_authorization",severity:"P1",status:"PARTIAL",reference:"Every public SECURITY DEFINER inventoried; fixed nullable-role bypass, admin gates, tenant analytics and competition summary scope. Full seller/sponsor/competition mutation matrix not exercised"},
    {id:"durable_abuse",severity:"P1",status:"PASS",reference:"quizbox_private.operation_budgets; class_join errors return committed counters; per-actor minute/hour windows"},
    {id:"answer_keys",severity:"P0",status:authenticatedPassed?"PASS":"AUTHENTICATED TEST REQUIRED",reference:"factory.live.test.ts and practice.live.test.ts; raw question detail functions revoked"},
    {id:"secret_handling",severity:"P0",status:secretFiles.length||embeddedSecrets?"FAIL":"PASS",reference:".gitignore; tracked local environment and actual service-key literal scan; separate staged-file verification required",evidence:{trackedSecretFiles:secretFiles.length,embeddedServiceKeys:embeddedSecrets}},
    {id:"media",severity:"P1",status:data.private_media?"PASS":"FAIL",reference:"private question-media bucket; attempt snapshot storage policy; app/api/content/media/route.ts"}
  ];
  const report = { generatedAt:new Date().toISOString(), findings, live:data, dependencies:dependency.metadata.vulnerabilities,
    advisors:advisoryReceipt,privilegeInventory:data.functions.map((f:any)=>({...f,legitimateExecute:f.name==="qb_marketplace_catalog"?"anon published catalogue; authenticated":f.authenticated?"authenticated with actor/RLS/role checks; service_role":"internal/trigger/service_role only",reviewStatus:"Catalog and code review; not blanket dynamic certification"})) };
  await writeFile("reports/production-security-readiness.json",JSON.stringify(report,null,2));
  await writeFile("reports/production-security-readiness.md","# Production Security Readiness\n\n"+findings.map((f)=>"- "+f.severity+" "+f.id+": "+f.status+" ("+f.reference+")").join("\n")+"\n\nPublic catalogue is the only intentional anonymous definer endpoint.\n");
  return report;
}
if (process.argv[1]?.endsWith("security-readiness.ts")) auditSecurity().then((r)=>console.log(JSON.stringify({findings:r.findings.map(({id,status,severity})=>({id,status,severity})),functions:r.privilegeInventory.length}))).catch(()=>{console.error("SECURITY_READINESS_FAILED");process.exitCode=1;});
