import { writeFile } from "node:fs/promises";
import { operatorClient, allRows } from "./operator";
import { calculateCoverage } from "../lib/content/factory/coverage";
import { resolveTarget } from "../lib/content/factory/targets";
import { pilotBatch, PILOT_CODES } from "../lib/content/factory/pilot";
import { generateQuestions, SampleProvider } from "../lib/content/factory/generation";
export async function prepareWave() {
  const client=await operatorClient(), nodes=await allRows(client,"curriculum_nodes"), questions=await allRows(client,"questions","id,curriculum_node_id,status,validation_status,source_type,difficulty_label,answer_type,duplicate_group_id"), overrides=await allRows(client,"content_coverage_targets");
  const coverage=calculateCoverage(nodes,questions,10,overrides);
  // Operational priority: supported subjects, tested grades and objective-friendly source wording.
  const selected:any[]=[];
  for (const subject of ["Computing","Mathematics","Science"]) {
    const matches=nodes.filter((n)=>n.is_active && n.node_type==="learning_indicator" && n.subject_code===subject && ["B7","B8","B9","SHS1"].includes(n.canonical_grade_code ?? n.grade_code));
    matches.sort((a,b)=>Number(!/fraction|cell|internet|number|structure|data/i.test(a.title))-Number(!/fraction|cell|internet|number|structure|data/i.test(b.title)) || a.code.localeCompare(b.code));
    for (const n of matches.slice(0,3)) {const approved=coverage.nodes.find((r)=>r.id===n.id)?.approved ?? 0,target=resolveTarget(n,overrides);selected.push({curriculum_node_id:n.id,curriculum_id:n.curriculum_id,indicator_code:n.code,indicator_title:n.title,subject,grade:n.canonical_grade_code ?? n.grade_code,approved_count:approved,target_count:target.minimum,required_new_candidates:Math.max(0,target.minimum-approved),difficulty_targets:{easy:target.easy,medium:target.medium,hard:target.hard},type_mix:target.type_mix,priority_reason:"Coverage gap; supported subject/grade; source objective retained; human alignment review required"});}
  }
  let verified=0;
  for(const n of nodes.filter((n)=>n.code===({Computing:PILOT_CODES[0],Mathematics:PILOT_CODES[1],Science:PILOT_CODES[2]} as Record<string,string>)[n.subject_code])) {
    const batch=pilotBatch(n),candidates=batch.candidates.slice(0,2),spec={...batch.spec,count:2};
    await generateQuestions(spec,n,new SampleProvider(candidates));verified+=candidates.length;
  }
  const report={generatedAt:new Date().toISOString(),mode:"priority-and-local-sample-verification",externalProviderConfigured:false,productionCandidatesGenerated:0,newCandidatesImported:0,pipelineSamplesVerified:verified,indicators:selected};
  await writeFile("reports/content-wave-1.json",JSON.stringify(report,null,2));console.log(JSON.stringify({selected:selected.length,pipelineSamplesVerified:verified,productionCandidatesGenerated:0,newCandidatesImported:0}));return report;
}
if(process.argv[1]?.endsWith("content-wave-1.ts")) prepareWave().catch(()=>{console.error("CONTENT_WAVE_FAILED");process.exitCode=1;});
