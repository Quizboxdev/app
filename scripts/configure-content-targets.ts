import { operatorClient,allRows } from "./operator";
async function main() {
  const client=await operatorClient(),nodes=await allRows(client,"curriculum_nodes","id,curriculum_id"),saved=await allRows(client,"content_coverage_targets");
  let configured=0;
  for(const curriculumId of new Set(nodes.map(n=>n.curriculum_id))) {
    if(saved.some(r=>r.curriculum_id===curriculumId && !r.grade_code && !r.subject_code))continue;
    const result=await client.rpc("qb_save_coverage_target",{p_curriculum_id:curriculumId,p_grade:"",p_subject:"",p_minimum:10,p_easy:3,p_medium:4,p_hard:3,p_type_mix:{SINGLE_CHOICE:8,TRUE_FALSE:2}});
    if(result.error)throw new Error("TARGET_CONFIGURATION_FAILED");configured++;
  }
  console.log(JSON.stringify({defaultsConfigured:configured,existingOverridesPreserved:true}));
}
main().catch(()=>{console.error("CONTENT_TARGETS_FAILED");process.exitCode=1;});
