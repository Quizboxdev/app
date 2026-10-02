import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { validatePublicEnvironment } from "../lib/env";
import { acceptancePassword } from "../lib/operations/safety";
import { releaseGates, releaseBlocked } from "../lib/operations/release";
import { auditSecurity } from "./security-readiness";
async function main() {
  try { process.loadEnvFile(".env.local"); } catch { /* The environment may be supplied by CI. */ }
  validatePublicEnvironment({NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY});
  let credentials=false;try{acceptancePassword();credentials=true;}catch{console.error("Authenticated acceptance credentials/environment missing; release remains blocked.");}
  const commands=["typecheck","lint","test","build","content:audit","content:validate","content:verify","content:factory -- coverage"];
  const results:Record<string,boolean>={};
  for(const command of commands) {
    const run=spawnSync(process.platform==="win32"?"cmd.exe":"npm",process.platform==="win32"?["/d","/s","/c","npm.cmd run "+command]:["run",...command.split(" ")],{stdio:"inherit",env:process.env});
    results[command]=run.status===0;
  }
  const security=await auditSecurity(process.env.QB_LIVE_ACCEPTANCE==="1"&&credentials&&results.test);
  const gates=releaseGates({approved:security.live.productionApproved,anonUnexpected:security.live.functions.filter((f:any)=>f.anon&&f.name!=="qb_marketplace_catalog").length,rlsDisabled:security.live.tables.filter((t:any)=>!t.rls).length,signup:security.live.signup_trigger,dependencyHigh:security.dependencies.high+security.dependencies.critical,applicationPassed:Object.values(results).every(Boolean),authenticatedPassed:process.env.QB_LIVE_ACCEPTANCE==="1"&&results.test,credentialsPresent:credentials});
  for(const finding of security.findings.filter((f)=>f.severity==="P0"&&!['PASS','MANUAL VERIFICATION REQUIRED'].includes(f.status))) {
    if(!gates.some((gate)=>gate.id===finding.id))gates.push({category:"SECURITY",id:finding.id,severity:"P0",status:"FAIL",evidence:finding.reference});
  }
  const report={generatedAt:new Date().toISOString(),decision:releaseBlocked(gates)?"NOT READY":"READY",commands:results,gates};
  await writeFile("reports/release-readiness.json",JSON.stringify(report,null,2));
  await writeFile("reports/release-readiness.md","# Release Readiness\n\n"+report.decision+"\n\n"+gates.map((g)=>"- "+g.category+" / "+g.id+": "+g.status+" ("+g.evidence+")").join("\n")+"\n");
  console.log(JSON.stringify(report));if(releaseBlocked(gates))process.exitCode=1;
}
main().catch(()=>{console.error("RELEASE_CHECK_UNAVAILABLE: fail closed; check operator environment and live RPC deployment.");process.exitCode=1;});
