import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveTarget, sweepStaleRuns } from "../lib/operations/live-fixture";
export async function runLiveAcceptance() {
 const checkedAt=new Date().toISOString();
 const report:any={checkedAt,project:"",status:"FAIL",category:"CONFIGURATION",passed:0,failed:0,skipped:99,executed:0};
 try {
  // Self-contained suites: each creates and removes its own world (lib/operations/live-fixture.ts). No persistent accounts or fixtures are used.
  const target=resolveTarget(); // Preview-only; refuses production before anything is created
  report.project=new URL(target.url).hostname.split('.')[0];
  report.swept=sweepStaleRuns();
  await mkdir('.local-backups',{recursive:true});
  const output='.local-backups/authenticated-tests.json';
  const files=['lib/content/factory/factory.live.test.ts','lib/learning/practice.live.test.ts','lib/operations/closure.live.test.ts','lib/operations/final-gates.live.test.ts','lib/operations/auth-failure.live.test.ts'];
  const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...files,'--reporter=default','--reporter=json',`--outputFile.json=${output}`],{stdio:'inherit',env:{...process.env,QB_LIVE_ACCEPTANCE:'1'}});
  const tests=JSON.parse(await readFile(output,'utf8'));
  report.passed=tests.numPassedTests;report.failed=tests.numFailedTests;report.skipped=tests.numPendingTests;report.executed=report.passed+report.failed;
  report.status=result.status===0&&report.passed>=99&&report.failed===0&&report.skipped===0?'PASS':'FAIL';
  const errors=tests.testResults.flatMap((r:any)=>[r.message,...r.assertionResults.flatMap((a:any)=>a.failureMessages)]).join(' ');
  report.category=report.status==='PASS'?'VERIFIED':/PGRST202|Could not find the function|fetch failed|ECONNREFUSED|invalid_credentials/.test(errors)?'INFRASTRUCTURE':'APPLICATION_OR_DATABASE_CONTRACT';
 }catch(error){report.reason=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'ACCEPTANCE_CONFIGURATION_UNAVAILABLE';}
 await writeFile('reports/authenticated-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
}
if(process.argv[1]?.endsWith('run-live-acceptance.ts'))runLiveAcceptance().then(r=>{if(r.status!=='PASS')process.exitCode=1;}).catch(()=>{console.error('LIVE_ACCEPTANCE_UNAVAILABLE');process.exitCode=1;});
