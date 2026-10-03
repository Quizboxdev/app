import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { compareRestore, compareRestoreScoped, RESTORE_CRITICAL_FOREIGN_KEYS } from "../lib/operations/restore";
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
 const directHost=process.env.PGHOST===`db.${project}.supabase.co`&&process.env.PGUSER==="postgres",poolerHost=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(process.env.PGHOST??"")&&process.env.PGUSER===`postgres.${project}`;
 if(!(directHost||poolerHost)||process.env.PGDATABASE!=="postgres"||!process.env.PGUSER||!process.env.PGPASSFILE||process.env.PGSERVICE||process.env.PGSERVICEFILE||process.env.PGOPTIONS)throw new Error("RESTORE_CONNECTION_CONFIGURATION_INVALID");
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
 const effective=descriptors.replace("coalesce(p.proacl::text,'')","coalesce(p.proacl,acldefault('f',p.proowner))::text").replace("coalesce(c.relacl::text,'')","coalesce(c.relacl,acldefault('r',c.relowner))::text");
 const snapshot=sql(`select jsonb_build_object('schemaSignaturesEffective',(select jsonb_object_agg(s,sig) from (select substring(definition from '^[a-z]+:([a-z_]+)[.:]') s,md5(string_agg(definition,E'\\n' order by definition)) sig from (${effective}) d group by 1) x),'schemaSignature',(select md5(string_agg(definition,E'\\n' order by definition)) from (${descriptors}) d),'schemaSignatures',(select jsonb_object_agg(s,sig) from (select substring(definition from '^[a-z]+:([a-z_]+)[.:]') s,md5(string_agg(definition,E'\\n' order by definition)) sig from (${descriptors}) d group by 1) x),'schemaCounts',(select jsonb_object_agg(schema,count) from (select n.nspname as schema,count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and c.relkind in ('r','p') group by n.nspname) x),'tables',(select jsonb_agg(to_jsonb(x) order by x."table") from (${tables}) x),'foreignKeys',(select jsonb_agg(to_jsonb(x) order by x.name) from (${foreignKeys}) x))`);
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
 if(args.includes('--capture-schema')) {
  // Read-only: per-schema production signatures, valid for the backup only if the full signature is unchanged since the seal.
  if(process.env.QB_ENVIRONMENT!=='backup')throw new Error('PRIVATE_BACKUP_ENVIRONMENT_REQUIRED');
  const archive=privatePath(option('--archive')),directory=path.dirname(archive),sealed=JSON.parse(await readFile(path.join(directory,'source-verification.json'),'utf8')),now=await capture(sourceProject);
  if(now.schemaSignature!==sealed.schemaSignature||JSON.stringify(now.schemaCounts)!==JSON.stringify(sealed.schemaCounts))throw new Error('PRODUCTION_SCHEMA_CHANGED_SINCE_BACKUP');
  await writeFile(path.join(directory,'source-schema.json'),JSON.stringify({project:sourceProject,checkedAt:now.checkedAt,baselineSignatureMatched:true,schemaSignatures:now.schemaSignatures,schemaSignaturesEffective:now.schemaSignaturesEffective,schemaCounts:now.schemaCounts},null,2),{mode:0o600});console.log('PRODUCTION_SCHEMA_SIGNATURES_CAPTURED');return;
 }
 const target=process.env.QB_RESTORE_PROJECT_REF;
 if(process.env.QB_ENVIRONMENT!=='restore'||!target||!process.env.QB_PRODUCTION_PROJECT_REF||target===sourceProject||target===process.env.QB_PRODUCTION_PROJECT_REF)throw new Error('RESTORE_TARGET_IS_NOT_ISOLATED');
 const archive=privatePath(option('--archive')), baseline=JSON.parse(await readFile(path.join(path.dirname(archive),'source-verification.json'),'utf8'));
 const sha256=createHash('sha256').update(await readFile(archive)).digest('hex'),expected=(await readFile(archive+'.sha256','utf8')).trim().toLowerCase();
 if(sha256!==expected||baseline.project!==sourceProject||baseline.archiveSha256!==sha256||baseline.stableCapture!==true)throw new Error('RESTORE_BASELINE_OR_ARCHIVE_MISMATCH');
 const execution=JSON.parse(await readFile(path.join(path.dirname(archive),'restore-execution.json'),'utf8'));
 if(execution.targetProject!==target||execution.archiveSha256!==sha256||execution.sourceProject!==sourceProject||execution.status!=='EXECUTED')throw new Error('ISOLATED_RESTORE_EXECUTION_RECEIPT_REQUIRED');
 const snapshot=await capture(target),directory=path.dirname(archive);
 let checks:any,schemaScope='full';
 if(execution.managedSchemas?.length){
  // Platform-managed target: QuizBox schemas must match exactly; auth/storage are compared by restored row counts.
  const sourceSchema=JSON.parse(await readFile(path.join(directory,'source-schema.json'),'utf8'));
  if(sourceSchema.project!==sourceProject||sourceSchema.baselineSignatureMatched!==true)throw new Error('SOURCE_SCHEMA_BASELINE_REQUIRED');
  checks=compareRestoreScoped(baseline,sourceSchema,snapshot,execution.preexistingRows??{});schemaScope='quizbox-owned';
 } else checks=compareRestore(baseline,snapshot);
 // Owned sequences must not point behind the restored keys.
 const sequencesBehind=sql(`select coalesce(jsonb_agg(q.name),'[]') from (select n.nspname||'.'||c.relname||'.'||a.attname as name,seq.last_value,c.oid as rel,a.attname from pg_depend d join pg_class sq on sq.oid=d.objid and sq.relkind='S' join pg_namespace sn on sn.oid=sq.relnamespace join pg_class c on c.oid=d.refobjid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=d.refobjsubid join pg_sequences seq on seq.schemaname=sn.nspname and seq.sequencename=sq.relname where d.deptype in ('a','i') and n.nspname in ${schemas}) q where coalesce((xpath('/row/m/text()',query_to_xml(format('select max(%I)::text as m from %s',q.attname,q.rel::regclass),false,true,'')))[1]::text::numeric,0)>coalesce(q.last_value,0)`) as string[];
 // Storage binaries: exported files must match the manifest hashes, and every manifest object must exist in restored metadata.
 let storageBinariesVerified=false,storageDetail='MANUAL VERIFICATION REQUIRED';
 try {
  const manifest=JSON.parse(await readFile(path.join(directory,'storage-manifest.json'),'utf8'));
  if(manifest.project!==sourceProject)throw new Error('STORAGE_MANIFEST_PROJECT_MISMATCH');
  const bad:string[]=[];
  for(const o of manifest.objects){const file=path.join(directory,'storage',o.bucket,...String(o.path).split('/'));let ok=false;try{const buf=await readFile(file);ok=buf.length===o.bytes&&createHash('sha256').update(buf).digest('hex')===o.sha256;}catch{ok=false;}if(!ok)bad.push(`${o.bucket}/${o.path}`);}
  const restored=sql(`select coalesce(jsonb_agg(bucket_id||'/'||name),'[]') from storage.objects`) as string[];
  const missing=manifest.objects.filter((o:any)=>!restored.includes(`${o.bucket}/${o.path}`)).map((o:any)=>`${o.bucket}/${o.path}`);
  storageBinariesVerified=bad.length===0&&missing.length===0;
  storageDetail=storageBinariesVerified?`${manifest.objects.length} exported objects match manifest SHA-256 and restored storage.objects metadata`:`hash/file failures: ${bad.join(', ')||'none'}; missing metadata: ${missing.join(', ')||'none'}`;
 } catch(error) { storageDetail=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'STORAGE_MANIFEST_UNAVAILABLE'; }
 if(!storageBinariesVerified&&args.includes('--confirm-storage-verified')){storageBinariesVerified=true;storageDetail='Explicit operator download/checksum attestation';}
 const core={schemaMatched:checks.schemaMatched,dataMatched:checks.dataMatched,foreignKeysVerified:checks.foreignKeysVerified,criticalTablesVerified:checks.criticalTablesVerified};
 const sequencesVerified=Array.isArray(sequencesBehind)&&sequencesBehind.length===0;
 const status=Object.values(core).every(Boolean)&&sequencesVerified&&storageBinariesVerified?'PASS':'FAIL';
 const rowSummary=Object.fromEntries(snapshot.tables.filter((t:any)=>['auth.users','public.profiles','public.questions','public.curriculum_nodes','public.assessments','public.assignments','public.attempts','public.assessment_results','public.responses','storage.buckets','storage.objects'].includes(t.table)).map((t:any)=>[t.table,t.rows]));
 const report={checkedAt:new Date().toISOString(),sourceProject,targetProject:target,archiveSha256:sha256,schemaScope,...core,mismatches:{schema:checks.schemaMismatches??[],data:checks.dataMismatches??[],fkMissing:checks.fkMissing??[],fkViolations:checks.fkViolations??[]},sequencesVerified,sequencesBehind,storageBinariesVerified,storageVerification:storageDetail,schemaCounts:snapshot.schemaCounts,representativeRows:rowSummary,criticalForeignKeys:snapshot.foreignKeys.filter((f:any)=>RESTORE_CRITICAL_FOREIGN_KEYS.includes(f.name)),foreignKeyCount:snapshot.foreignKeys.length,tablesVerified:snapshot.tables.length,status};
 await writeFile('reports/restore-verification.json',JSON.stringify(report,null,2));
 // The restore receipt exists only after checksum, restore execution, integrity, sequence and storage verification all pass.
 if(status==='PASS')await writeFile(path.join(directory,'restore-receipt.json'),JSON.stringify({status:'PASS',restoreProjectRef:target,sourceProject,backupSha256:sha256,verifiedAt:report.checkedAt,restoredSchemas:execution.restoredSchemas??['public','quizbox_private','auth','storage'],managedSchemasDataOnly:execution.managedSchemas??[],rowCounts:rowSummary,storageVerification:storageDetail},null,2),{mode:0o600});
 console.log(JSON.stringify({status,...core,sequencesVerified,storageBinariesVerified,mismatches:report.mismatches,rowSummary}));if(status!=='PASS')process.exitCode=1;
}
main().catch(async error=>{const reason=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RESTORE_VERIFICATION_UNAVAILABLE';if(!process.argv.includes('--capture')&&!process.argv.includes('--seal'))await writeFile('reports/restore-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),sourceProject,targetProject:process.env.QB_RESTORE_PROJECT_REF??null,status:'FAIL',reason},null,2));console.error(reason);process.exitCode=1;});
