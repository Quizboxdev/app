import { readFile,writeFile } from "node:fs/promises";
import { operatorClient,allRows } from "./operator";
import { validateSpec,type GenerationSpec } from "../lib/content/factory/contract";

async function main() {
  const wave=JSON.parse(await readFile("reports/content-wave-1.json","utf8"));
  const client=await operatorClient(),nodes=await allRows(client,"curriculum_nodes");
  const indicators=wave.indicators.map((row:any)=>{
    const node=nodes.find(n=>n.id===row.curriculum_node_id);if(!node)throw new Error("WAVE_NODE_MISSING");
    const jobs:GenerationSpec[]=[];
    // Each job is uniform, matching the existing factory contract.
    for(const [difficulty,cognitive,count] of [["easy","Understand",row.difficulty_targets.easy],["medium","Apply",row.difficulty_targets.medium],["hard","Analyze",row.difficulty_targets.hard]] as const) {
      let trueFalse=difficulty==="hard"?0:1;
      trueFalse=Math.min(trueFalse,count);
      for(const [answerType,size] of [["TRUE_FALSE",trueFalse],["SINGLE_CHOICE",count-trueFalse]] as const) {
        if(!size)continue;
        const spec:GenerationSpec={indicatorId:node.id,indicatorCode:node.code,indicatorTitle:node.title,curriculumId:node.curriculum_id,educationLevel:node.education_level??"Ghana curriculum",grade:row.grade,subject:row.subject,difficulty,cognitiveLevel:cognitive,answerType,count:size,language:"English",marks:1,expectedSeconds:60,provenance:{source:"EDITORIAL_WAVE_1"}};
        const errors=validateSpec(spec,node);if(errors.length)throw new Error("WAVE_SPEC_INVALID");jobs.push(spec);
      }
    }
    return {...row,cognitive_targets:{Understand:row.difficulty_targets.easy,Apply:row.difficulty_targets.medium,Analyze:row.difficulty_targets.hard},jobs:jobs.map((spec,index)=>({id:`WAVE1:${node.id}:${index}`,status:"QUEUED_LOCAL_AWAITING_PROVIDER",spec}))};
  });
  await writeFile("reports/content-wave-1-production-manifest.json",JSON.stringify({createdAt:new Date().toISOString(),providerStatus:"NOT_CONFIGURED",productionGenerated:0,productionImported:0,humanApprovalRequired:true,queueLocation:"This durable local manifest; not submitted to live generation RPC",indicators},null,2));
  console.log(JSON.stringify({indicators:indicators.length,validatedJobs:indicators.reduce((n:number,r:any)=>n+r.jobs.length,0),productionGenerated:0}));
}
main().catch(()=>{console.error("PRODUCTION_MANIFEST_FAILED");process.exitCode=1;});
