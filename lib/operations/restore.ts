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
