import { describe,it,expect } from 'vitest';
import { credentialDigest,credentialEvidenceValid,restoreEvidenceValid } from './release-evidence';
import { releaseGates,releaseBlocked } from './release';
import { compareRestore,compareRestoreScoped,RESTORE_CRITICAL_TABLES } from './restore';
import { filterReviewRows,reviewPage } from '../content/factory/review';
const now=Date.now(),project='unit';
const accounts=['admin','student','student2','teacher','sponsor','seller'].map(role=>({email:role+'.test@quizbox.local',password:role+'-unit-only-rotated'}));
const receipt={project,checkedAt:new Date(now).toISOString(),accounts:accounts.map(a=>({...a,password:undefined,salt:'unit-salt',credentialDigest:credentialDigest(a.password,'unit-salt'),replacementLoginVerified:true,oldPasswordRejected:true,oldRefreshRejected:true,oldAccessTokensExpireAfter:new Date(now-60000).toISOString()}))};
describe('P0 release evidence',()=>{
 it('accepts current six verified distinct rotated credentials',()=>expect(credentialEvidenceValid(receipt,project,accounts,now)).toBe(true));
 it('rejects old credentials even with a successful rotation receipt',()=>expect(credentialEvidenceValid(receipt,project,accounts.map(a=>({...a,password:'old-unit-only'})),now)).toBe(false));
 it('rejects stale or wrong-project rotation evidence',()=>{expect(credentialEvidenceValid(receipt,'other',accounts,now)).toBe(false);expect(credentialEvidenceValid(receipt,project,accounts,now+86400001)).toBe(false);});
 it('waits for old JWT expiry and demands refresh rejection',()=>{expect(credentialEvidenceValid({...receipt,accounts:receipt.accounts.map(r=>({...r,oldAccessTokensExpireAfter:new Date(now+1).toISOString()}))},project,accounts,now)).toBe(false);expect(credentialEvidenceValid({...receipt,accounts:receipt.accounts.map(r=>({...r,oldRefreshRejected:false}))},project,accounts,now)).toBe(false);});
 it('can turn every gate green only with all verified evidence',()=>{const input={approved:45,anonUnexpected:0,rlsDisabled:0,signup:true,dependencyHigh:0,applicationPassed:true,authenticatedPassed:true,credentialsPresent:true,passwordProtectionVerified:true,credentialsVerified:true,restoreVerified:true};expect(releaseBlocked(releaseGates(input))).toBe(false);for(const key of ['passwordProtectionVerified','credentialsVerified','restoreVerified','authenticatedPassed'] as const)expect(releaseBlocked(releaseGates({...input,[key]:false}))).toBe(true);expect(releaseBlocked(releaseGates({...input,approved:0}))).toBe(true);});
 it('rejects production-target or incomplete restore evidence',()=>{const proof={status:'PASS',sourceProject:project,targetProject:'isolated',archiveSha256:'a'.repeat(64),schemaMatched:true,dataMatched:true,foreignKeysVerified:true,criticalTablesVerified:true,storageBinariesVerified:true,tablesVerified:29,checkedAt:new Date(now).toISOString()};expect(restoreEvidenceValid(proof,project)).toBe(true);expect(restoreEvidenceValid({...proof,targetProject:project},project)).toBe(false);expect(restoreEvidenceValid({...proof,storageBinariesVerified:false},project)).toBe(false);});
 it('compares real restore table checksums and FK integrity',()=>{const data={schemaSignature:'schema',schemaCounts:{public:14,auth:1},tables:RESTORE_CRITICAL_TABLES.map(table=>({table,rows:1,checksum:'hash'})),foreignKeys:[{name:'profile-user',validated:true,violations:0}]};expect(compareRestore(data,data).dataMatched).toBe(true);expect(compareRestore(data,{...data,tables:data.tables.map(t=>({...t,checksum:'wrong'}))}).dataMatched).toBe(false);expect(compareRestore(data,{...data,foreignKeys:[{name:'profile-user',validated:true,violations:1}]}).foreignKeysVerified).toBe(false);});
 it('preserves review filter totals and handles the last page shrinking',()=>{const rows=[{status:'inactive',editorial_metadata:{warnings:['warning']}},{status:'active',editorial_metadata:{warnings:[]}}];expect(filterReviewRows(rows,{reviewStatus:'inactive',validation:'flagged'})).toHaveLength(1);expect(filterReviewRows(rows,{validation:'clear'})).toHaveLength(1);expect(reviewPage(2,25)).toBe(1);expect(reviewPage(2,0)).toBe(1);});
 it('includes legacy structural validation errors in flagged reviews',()=>expect(filterReviewRows([{status:'inactive',validation_errors:['INVALID_INDICATOR']}],{validation:'flagged'})).toHaveLength(1));
});

describe('scoped restore into a platform-managed target', () => {
 const fks = ['public.profiles.profiles_id_fkey','public.questions.questions_curriculum_node_id_fkey','public.question_versions.question_versions_question_id_fkey','public.responses.responses_attempt_id_fkey','public.mastery_records.mastery_records_student_user_id_fkey','public.mastery_records.mastery_records_curriculum_node_id_fkey','public.xp_transactions.xp_transactions_attempt_id_fkey','public.xp_transactions.xp_transactions_student_user_id_fkey'].map(name=>({name,validated:true,violations:0}));
 const tables = [...RESTORE_CRITICAL_TABLES.map(table=>({table,rows:2,checksum:'h-'+table})),{table:'storage.buckets',rows:1,checksum:'b'},{table:'auth.schema_migrations',rows:70,checksum:'m'}];
 const source = { tables, foreignKeys: [...fks, { name: 'auth.identities.identities_user_id_fkey', validated: true, violations: 0 }] };
 const schema = { schemaSignatures: { public: 'p', quizbox_private: 'q', auth: 'old-auth' }, schemaCounts: { public: 10, quizbox_private: 2, auth: 20 } };
 const target = { schemaSignatures: { public: 'p', quizbox_private: 'q', auth: 'new-auth' }, schemaCounts: { public: 10, quizbox_private: 2, auth: 23 },
  tables: tables.map(t => t.table === 'auth.users' ? { ...t, checksum: 'newer-columns' } : t.table === 'storage.buckets' ? { ...t, rows: 2 } : t.table === 'auth.schema_migrations' ? { ...t, rows: 82 } : t), foreignKeys: fks };
 it('accepts a newer managed auth/storage schema with pre-existing target rows', () => {
  expect(compareRestoreScoped(source, schema, target, { 'storage.buckets': 1 })).toMatchObject({ schemaMatched: true, dataMatched: true, foreignKeysVerified: true, criticalTablesVerified: true });
 });
 it('treats an explicit owner-only ACL and a NULL default ACL as the same effective privileges', () => {
  const effectiveSchema = { ...schema, schemaSignaturesEffective: { public: 'pe', quizbox_private: 'qe', auth: 'x' } };
  const restored = { ...target, schemaSignatures: { ...target.schemaSignatures, quizbox_private: 'null-acl' }, schemaSignaturesEffective: { public: 'pe', quizbox_private: 'qe', auth: 'y' } };
  expect(compareRestoreScoped(source, effectiveSchema, restored, { 'storage.buckets': 1 }).schemaMatched).toBe(true);
  expect(compareRestoreScoped(source, effectiveSchema, { ...restored, schemaSignaturesEffective: { ...restored.schemaSignaturesEffective, quizbox_private: 'anon-granted' } }, { 'storage.buckets': 1 }).schemaMismatches).toEqual(['quizbox_private']);
 });
 it('still fails on any QuizBox-owned schema, data or FK difference', () => {
  expect(compareRestoreScoped(source, schema, { ...target, schemaSignatures: { ...target.schemaSignatures, public: 'x' } }, { 'storage.buckets': 1 }).schemaMismatches).toEqual(['public']);
  expect(compareRestoreScoped(source, schema, { ...target, tables: target.tables.map(t => t.table === 'public.questions' ? { ...t, checksum: 'x' } : t) }, { 'storage.buckets': 1 }).dataMismatches).toEqual(['public.questions']);
  expect(compareRestoreScoped(source, schema, target, {}).dataMismatches).toEqual(['storage.buckets']);
  expect(compareRestoreScoped(source, schema, { ...target, foreignKeys: fks.map((f, i) => i === 0 ? { ...f, violations: 3 } : f) }, { 'storage.buckets': 1 }).foreignKeysVerified).toBe(false);
 });
});
