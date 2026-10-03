export const RESTORE_CRITICAL_TABLES = ["auth.users", "public.profiles", "public.questions", "public.question_versions", "public.curriculum_nodes", "public.classes", "public.class_memberships", "public.assignments", "public.assignment_question_versions", "public.attempts", "public.responses", "public.assessment_results", "public.learning_events", "public.mastery_records", "public.xp_transactions"];
export const RESTORE_CRITICAL_FOREIGN_KEYS = ["public.profiles.profiles_id_fkey", "public.questions.questions_curriculum_node_id_fkey", "public.question_versions.question_versions_question_id_fkey", "public.responses.responses_attempt_id_fkey", "public.mastery_records.mastery_records_student_user_id_fkey", "public.mastery_records.mastery_records_curriculum_node_id_fkey", "public.xp_transactions.xp_transactions_attempt_id_fkey", "public.xp_transactions.xp_transactions_student_user_id_fkey"];
export function compareRestore(source: any, target: any) {
 const schemaMatched = source.schemaSignature === target.schemaSignature && JSON.stringify(source.schemaCounts) === JSON.stringify(target.schemaCounts);
 const dataMatched = JSON.stringify(source.tables) === JSON.stringify(target.tables);
 const foreignKeysVerified = source.foreignKeys?.length > 0 && target.foreignKeys?.length === source.foreignKeys.length
  && target.foreignKeys.every((f:any)=>f.validated && f.violations===0) && RESTORE_CRITICAL_FOREIGN_KEYS.every(name=>target.foreignKeys.some((f:any)=>f.name===name)) && JSON.stringify(source.foreignKeys) === JSON.stringify(target.foreignKeys);
 const criticalTablesVerified = RESTORE_CRITICAL_TABLES.every(name=>target.tables?.some((t:any)=>t.table===name))
  && ["auth.users","public.profiles","public.questions","public.curriculum_nodes"].every(name=>target.tables.find((t:any)=>t.table===name)?.rows>0);
 return {schemaMatched,dataMatched,foreignKeysVerified,criticalTablesVerified,tablesVerified:target.tables?.length??0};
}

// Restore into a platform-managed target (e.g. a fresh Supabase project): QuizBox-owned schemas must match exactly;
// platform-managed schemas (auth, storage) keep the target's own definitions, so only their row counts are compared,
// allowing for rows the target already held before the restore and excluding the platform's own migration ledgers.
export const MANAGED_SCHEMAS = ["auth", "storage"];
export const MANAGED_BOOTSTRAP_TABLES = ["auth.schema_migrations", "storage.migrations"];
const schemaOf = (table: string) => table.split(".")[0];
export function compareRestoreScoped(source: any, sourceSchema: { schemaSignatures: Record<string, string>; schemaSignaturesEffective?: Record<string, string>; schemaCounts: Record<string, number> }, target: any, preexisting: Record<string, number> = {}) {
 const owned = Object.keys(sourceSchema.schemaSignatures).filter(s => !MANAGED_SCHEMAS.includes(s));
 // Compare effective privileges when both sides carry them (a NULL ACL equals the owner's built-in default).
 const signature = (side: any, s: string) => sourceSchema.schemaSignaturesEffective && target.schemaSignaturesEffective ? side.schemaSignaturesEffective?.[s] : side.schemaSignatures?.[s];
 const schemaMismatches = owned.filter(s => signature(sourceSchema, s) !== signature(target, s) || sourceSchema.schemaCounts[s] !== target.schemaCounts?.[s]);
 const targetTables = new Map<string, any>((target.tables ?? []).map((t: any) => [t.table, t]));
 const dataMismatches: string[] = [];
 for (const t of source.tables ?? []) {
  if (MANAGED_BOOTSTRAP_TABLES.includes(t.table)) continue;
  const restored = targetTables.get(t.table);
  if (MANAGED_SCHEMAS.includes(schemaOf(t.table))) { if (t.rows > 0 && (restored?.rows ?? -1) !== t.rows + (preexisting[t.table] ?? 0)) dataMismatches.push(t.table); }
  else if (!restored || restored.rows !== t.rows || restored.checksum !== t.checksum) dataMismatches.push(t.table);
 }
 const ownedFks = (source.foreignKeys ?? []).filter((f: any) => !MANAGED_SCHEMAS.includes(schemaOf(f.name)));
 const fkMissing = ownedFks.filter((f: any) => !(target.foreignKeys ?? []).some((g: any) => g.name === f.name)).map((f: any) => f.name);
 const fkViolations = (target.foreignKeys ?? []).filter((f: any) => !f.validated || f.violations !== 0).map((f: any) => f.name);
 const foreignKeysVerified = ownedFks.length > 0 && fkMissing.length === 0 && fkViolations.length === 0 && RESTORE_CRITICAL_FOREIGN_KEYS.every(name => (target.foreignKeys ?? []).some((f: any) => f.name === name));
 const criticalTablesVerified = RESTORE_CRITICAL_TABLES.every(name => targetTables.has(name)) && ["auth.users", "public.profiles", "public.questions", "public.curriculum_nodes"].every(name => targetTables.get(name)?.rows > 0);
 return { schemaMatched: owned.length > 0 && schemaMismatches.length === 0, dataMatched: dataMismatches.length === 0, foreignKeysVerified, criticalTablesVerified, schemaMismatches, dataMismatches, fkMissing, fkViolations };
}
