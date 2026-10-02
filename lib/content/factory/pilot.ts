import type { Candidate, CurriculumNode, GenerationSpec } from "./contract";
// Controlled local samples, not AI output or production academic approval.
export const PILOT_CODES = ["B10.1.1.1.1", "B7.1.3.2.2", "B7.1.2.1.1"];
export function pilotBatch(node: CurriculumNode) {
  const spec: GenerationSpec = { indicatorId:node.id,indicatorCode:node.code,indicatorTitle:node.title,curriculumId:node.curriculum_id,
    educationLevel:node.education_level!,grade:node.canonical_grade_code ?? node.grade_code!,subject:node.subject_code!,
    difficulty:"easy",cognitiveLevel:"Understand",answerType:"SINGLE_CHOICE",count:4,language:"English",marks:1,expectedSeconds:60,
    provenance:{source:"DEV_FACTORY_PILOT",provider:"local-sample",model:"controlled-v1",sourceVersion:"factory-pilot-v1"} };
  const samples: Record<string, Array<[string,string[],string,string]>> = {
    Computing: [
      ["Which example illustrates the Internet of Things?",["A sensor sending measurements over a network","An unplugged keyboard","A paper notebook","A non-electronic ruler"],"A","Connected sensors exchange data over networks."],
      ["Network-connected sensors can exchange measurements with other devices.",["True","False","Not applicable","Not applicable"],"A","The Internet of Things includes connected devices that exchange data."],
    ],
    Mathematics: [
      ["What is one half plus one quarter?",["Three quarters","One quarter","Two eighths","One eighth"],"A","One half is two quarters; two quarters plus one quarter is three quarters."],
      ["Three quarters minus one quarter equals one half.",["True","False","Not applicable","Not applicable"],"A","Three quarters minus one quarter is two quarters, which simplifies to one half."],
    ],
    Science: [
      ["Which cell structure controls many cell activities?",["Nucleus","Cell wall","Vacuole","Cell membrane"],"A","The nucleus contains genetic material and controls many cell activities."],
      ["A cell membrane helps control substances entering and leaving a cell.",["True","False","Not applicable","Not applicable"],"A","The cell membrane regulates the movement of substances across it."],
    ],
  };
  if (!samples[node.subject_code!]) throw new Error("UNSUPPORTED_PILOT_SUBJECT");
  const candidates: Candidate[] = samples[node.subject_code!].map(([question_text,options,correct_answer,explanation], i) => ({
    external_question_id:"DEV_FACTORY_PILOT_"+node.subject_code!.toUpperCase()+"_"+(i+1),curriculum_node_id:node.id,
    question_text:"[DEV FACTORY PILOT] "+question_text,option_a:options[0],option_b:options[1],option_c:options[2],option_d:options[3],
    correct_answer,explanation,answer_type:i===1?"TRUE_FALSE":"SINGLE_CHOICE",answer_spec:i===1?{boolean:true}:{},
    difficulty_label:i===1?"medium":"easy",cognitive_level:"Understand",marks:1,estimated_time_seconds:60,source_type:"DEV_FACTORY_PILOT",
  }));
  candidates.push({...candidates[0],external_question_id:candidates[0].external_question_id+"_DUPLICATE",difficulty_label:"hard"});
  candidates.push({...candidates[0],external_question_id:candidates[0].external_question_id+"_INVALID",option_a:""});
  return {spec,candidates};
}
