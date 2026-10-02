import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { acceptanceAccount, ACCEPTANCE_ROLES } from "../lib/operations/acceptance";
export async function runLiveAcceptance() {
 const checkedAt=new Date().toISOString();
 const report:any={checkedAt,project:"",status:"FAIL",category:"CONFIGURATION",passed:0,failed:0,skipped:95,executed:0};
 try {
  try {process.loadEnvFile('.env.local');} catch { /* CI may supply configuration. */ }
  report.project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
  const accounts=ACCEPTANCE_ROLES.map(role=>acceptanceAccount(role));
  for(const [i,account] of accounts.entries()){
   const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
   const login=await client.auth.signInWithPassword(account);
   if(login.error||!login.data.user){report.accountRole=ACCEPTANCE_ROLES[i];report.category=login.error?.code==='invalid_credentials'?'AUTHENTICATION':'INFRASTRUCTURE';throw new Error('AUTHENTICATED_PREFLIGHT_FAILED');}
   await client.auth.signOut();
  }
  const admin=accounts[0],student=accounts[1];
  await mkdir('.local-backups',{recursive:true});
  const output='.local-backups/authenticated-tests.json';
  const files=['lib/content/factory/factory.live.test.ts','lib/learning/practice.live.test.ts','lib/operations/closure.live.test.ts','lib/operations/final-gates.live.test.ts'];
  const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...files,'--reporter=default','--reporter=json',`--outputFile.json=${output}`],{stdio:'inherit',env:{...process.env,QB_LIVE_ACCEPTANCE:'1',QB_ACCEPTANCE_PASSWORD:student.password,QB_CONTENT_OPERATOR_EMAIL:admin.email,QB_CONTENT_OPERATOR_PASSWORD:admin.password}});
  const tests=JSON.parse(await readFile(output,'utf8'));
  report.passed=tests.numPassedTests;report.failed=tests.numFailedTests;report.skipped=tests.numPendingTests;report.executed=report.passed+report.failed;
  report.status=result.status===0&&report.passed>=95&&report.failed===0&&report.skipped===0?'PASS':'FAIL';
  const errors=tests.testResults.flatMap((r:any)=>[r.message,...r.assertionResults.flatMap((a:any)=>a.failureMessages)]).join(' ');
  report.category=report.status==='PASS'?'VERIFIED':/PGRST202|Could not find the function|fetch failed|ECONNREFUSED|invalid_credentials/.test(errors)?'INFRASTRUCTURE':'APPLICATION_OR_DATABASE_CONTRACT';
 }catch(error){report.reason=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'ACCEPTANCE_CONFIGURATION_UNAVAILABLE';}
 await writeFile('reports/authenticated-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
}
if(process.argv[1]?.endsWith('run-live-acceptance.ts'))runLiveAcceptance().then(r=>{if(r.status!=='PASS')process.exitCode=1;}).catch(()=>{console.error('LIVE_ACCEPTANCE_UNAVAILABLE');process.exitCode=1;});
