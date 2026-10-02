import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { compareRestore, RESTORE_CRITICAL_FOREIGN_KEYS } from "../lib/operations/restore";
const sourceProject="fmgccmqxfjppqydkhaiu";
const schemas="('public','quizbox_private','auth','storage')";
const ident=(value:string)=>'"'+value.replace(/"/g,'""')+'"';
const literal=(value:string)=>"'"+value.replace(/'/g,"''")+"'";
function privatePath(value:string) {const resolved=path.resolve(value),root=path.resolve(".local-backups")+path.sep;if(!resolved.startsWith(root))throw new Error("PRIVATE_RESTORE_ARTIFACT_REQUIRED");return resolved;}
function sql(query:string) {
 try {return JSON.parse(execFileSync("psql",["-X","-q","-t","-A","-v","ON_ERROR_STOP=1","--host",process.env.PGHOST!,"--username",process.env.PGUSER!,"--dbname","postgres"],{input:"begin isolation level repeatable read read only;\nset local timezone='UTC';\n"+query+";\ncommit;",encoding:"utf8",stdio:["pipe","pipe","pipe"],maxBuffer:32*1024*1024,env:{...process.env,PGSSLMODE:"require"}}).trim());}
 catch {throw new Error("RESTORE_READONLY_DATABASE_QUERY_FAILED");}
}
async function capture(project:string) {
 if(process.env.PGHOST!==`db.${project}.supabase.co`||process.env.PGDATABASE!=="postgres"||!process.env.PGUSER||!process.env.PGPASSFILE||process.env.PGSERVICE||process.env.PGSERVICEFILE||process.env.PGOPTIONS)throw new Error("RESTORE_CONNECTION_CONFIGURATION_INVALID");
 await access(process.env.PGPASSFILE);
 const metadata=sql(`select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and c.relkind in ('r','p')),'foreignKeys',(select jsonb_agg(jsonb_build_object('name',k.conname,'schema',n.nspname,'table',c.relname,'refSchema',rn.nspname,'refTable',rc.relname,'validated',k.convalidated,'match',k.confmatchtype,'columns',(select jsonb_agg(a.attname order by x.i) from unnest(k.conkey) with ordinality x(num,i) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=x.num),'refColumns',(select jsonb_agg(a.attname order by x.i) from unnest(k.confkey) with ordinality x(num,i) join pg_attribute a on a.attrelid=k.confrelid and a.attnum=x.num)) order by n.nspname,c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace join pg_class rc on rc.oid=k.confrelid join pg_namespace rn on rn.oid=rc.relnamespace where k.contype='f' and n.nspname in ${schemas}))`);
 const tables=metadata.tables.map((t:any)=>`select ${literal(t.schema+'.'+t.name)} as "table",count(*)::integer as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as checksum from ${ident(t.schema)}.${ident(t.name)} t`).join(" union all ");
 const foreignKeys=metadata.foreignKeys.map((f:any)=>{
  const present=f.columns.map((c:string)=>`c.${ident(c)} is not null`).join(' and '),anyPresent=f.columns.map((c:string)=>`c.${ident(c)} is not null`).join(' or ');
  const join=f.columns.map((c:string,i:number)=>`r.${ident(f.refColumns[i])}=c.${ident(c)}`).join(' and ');
  const bad=`((${present}) and not exists(select 1 from ${ident(f.refSchema)}.${ident(f.refTable)} r where ${join}))`+(f.match==='f'?` or ((${anyPresent}) and not (${present}))`:"");
  return `select ${literal(f.schema+'.'+f.table+'.'+f.name)} as name,${f.validated?'true':'false'} as validated,count(*)::integer as violations from ${ident(f.schema)}.${ident(f.table)} c where ${bad}`;
 }).join(" union all ");
 // Hash structural definitions, including privileges and RLS; no Auth rows or function bodies leave psql.
 const descriptors=`select 'column:'||n.nspname||'.'||c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') as definition from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname in ${schemas} and a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v')
 union all select 'constraint:'||n.nspname||'.'||c.relname||':'||k.conname||':'||pg_get_constraintdef(k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas}
 union all select 'function:'||n.nspname||':'||pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,'')||':'||pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ${schemas} and p.prokind in ('f','p')
 union all select 'table:'||n.nspname||'.'||c.relname||':'||c.relrowsecurity||':'||c.relforcerowsecurity||':'||coalesce(c.relacl::text,'')||':'||pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and c.relkind in ('r','p','v')
 union all select 'enum:'||n.nspname||'.'||t.typname||':'||e.enumlabel||':'||e.enumsortorder from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in ${schemas}
 union all select 'index:'||schemaname||':'||indexdef from pg_indexes where schemaname in ${schemas}
 union all select 'policy:'||schemaname||'.'||tablename||':'||policyname||':'||roles::text||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname in ${schemas}
 union all select 'trigger:'||n.nspname||'.'||c.relname||':'||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and not t.tgisinternal
 union all select 'view:'||schemaname||'.'||viewname||':'||definition from pg_views where schemaname in ${schemas}`;
 const snapshot=sql(`select jsonb_build_object('schemaSignature',(select md5(string_agg(definition,E'\\n' order by definition)) from (${descriptors}) d),'schemaCounts',(select jsonb_object_agg(schema,count) from (select n.nspname as schema,count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and c.relkind in ('r','p') group by n.nspname) x),'tables',(select jsonb_agg(to_jsonb(x) order by x."table") from (${tables}) x),'foreignKeys',(select jsonb_agg(to_jsonb(x) order by x.name) from (${foreignKeys}) x))`);
 return {project,checkedAt:new Date().toISOString(),...snapshot};
}
async function main(){
 const args=process.argv.slice(2),option=(name:string)=>args[args.indexOf(name)+1];
 if(args.includes('--capture')){
  if(process.env.QB_ENVIRONMENT!=='backup')throw new Error('PRIVATE_BACKUP_ENVIRONMENT_REQUIRED');
  const snapshot=await capture(sourceProject);await writeFile(privatePath(option('--output')),JSON.stringify(snapshot,null,2),{mode:0o600});console.log('PRIVATE_SOURCE_FINGERPRINT_CAPTURED');return;
 }
 if(args.includes('--seal')) {
  if(process.env.QB_ENVIRONMENT!=='backup')throw new Error('PRIVATE_BACKUP_ENVIRONMENT_REQUIRED');
  const archive=privatePath(option('--archive')),directory=path.dirname(archive);
  const before=JSON.parse(await readFile(path.join(directory,'source-before.json'),'utf8')),after=await capture(sourceProject),checks=compareRestore(before,after);
  if(!checks.schemaMatched||!checks.dataMatched||!checks.foreignKeysVerified||!checks.criticalTablesVerified)throw new Error('BACKUP_SOURCE_CHANGED_OR_INTEGRITY_FAILED');
  const archiveSha256=createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(path.join(directory,'source-verification.json'),JSON.stringify({...after,archiveSha256,stableCapture:true},null,2),{mode:0o600});console.log('CONSISTENT_ARCHIVE_BASELINE_SEALED');return;
 }
 const target=process.env.QB_RESTORE_PROJECT_REF;
 if(process.env.QB_ENVIRONMENT!=='restore'||!target||!process.env.QB_PRODUCTION_PROJECT_REF||target===sourceProject||target===process.env.QB_PRODUCTION_PROJECT_REF)throw new Error('RESTORE_TARGET_IS_NOT_ISOLATED');
 const archive=privatePath(option('--archive')), baseline=JSON.parse(await readFile(path.join(path.dirname(archive),'source-verification.json'),'utf8'));
 const sha256=createHash('sha256').update(await readFile(archive)).digest('hex'),expected=(await readFile(archive+'.sha256','utf8')).trim().toLowerCase();
 if(sha256!==expected||baseline.project!==sourceProject||baseline.archiveSha256!==sha256||baseline.stableCapture!==true)throw new Error('RESTORE_BASELINE_OR_ARCHIVE_MISMATCH');
 const execution=JSON.parse(await readFile(path.join(path.dirname(archive),'restore-execution.json'),'utf8'));
 if(execution.targetProject!==target||execution.archiveSha256!==sha256||execution.sourceProject!==sourceProject||execution.status!=='EXECUTED')throw new Error('ISOLATED_RESTORE_EXECUTION_RECEIPT_REQUIRED');
 const snapshot=await capture(target),checks=compareRestore(baseline,snapshot),storageBinariesVerified=args.includes('--confirm-storage-verified');
 const report={checkedAt:new Date().toISOString(),sourceProject,targetProject:target,archiveSha256:sha256,...checks,storageBinariesVerified,storageVerification:storageBinariesVerified?'Explicit operator download/checksum attestation':'MANUAL VERIFICATION REQUIRED',schemaCounts:snapshot.schemaCounts,representativeRows:snapshot.tables.filter((t:any)=>['auth.users','public.profiles','public.questions','public.curriculum_nodes','public.learning_events','public.mastery_records','public.xp_transactions'].includes(t.table)),criticalForeignKeys:snapshot.foreignKeys.filter((f:any)=>RESTORE_CRITICAL_FOREIGN_KEYS.includes(f.name)),foreignKeyCount:snapshot.foreignKeys.length,status:Object.entries(checks).filter(([k])=>k!=='tablesVerified').every(([,v])=>v)&&storageBinariesVerified?'PASS':'FAIL'};
 await writeFile('reports/restore-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.status!=='PASS')process.exitCode=1;
}
main().catch(async error=>{const reason=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RESTORE_VERIFICATION_UNAVAILABLE';if(!process.argv.includes('--capture')&&!process.argv.includes('--seal'))await writeFile('reports/restore-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),sourceProject,targetProject:process.env.QB_RESTORE_PROJECT_REF??null,status:'FAIL',reason},null,2));console.error(reason);process.exitCode=1;});
