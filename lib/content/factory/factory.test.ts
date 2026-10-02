import { describe, expect, it } from "vitest";
import { canTransition, isProductionAvailable, normalize, validateCandidate, validateSpec, type Candidate, type CurriculumNode, type GenerationSpec } from "./contract";
import { calculateCoverage, coverageHealth } from "./coverage";
import { duplicateWarnings, signatures, similarity } from "./duplicates";
import { buildGenerationPrompt, generateQuestions, SampleProvider } from "./generation";
const node: CurriculumNode = { id:"indicator",curriculum_id:"curriculum",parent_id:"subject",node_type:"learning_indicator",code:"B10.1.1.1.1",title:"Computing objective",grade_code:"B10",canonical_grade_code:"SHS1",source_grade_code:"B10",subject_code:"Computing",is_active:true };
const nodes = new Map([[node.id,node]]);
const q: Candidate = { external_question_id:"sample-1",curriculum_node_id:node.id,question_text:"Which device stores files?",answer_type:"SINGLE_CHOICE",option_a:"Storage drive",option_b:"Monitor",option_c:"Keyboard",option_d:"Speaker",correct_answer:"A",explanation:"A storage drive retains files.",difficulty_label:"easy",cognitive_level:"Understand",marks:1,estimated_time_seconds:60,source_type:"HUMAN_AUTHOR" };
const spec: GenerationSpec = { indicatorId:node.id,indicatorCode:node.code,indicatorTitle:node.title,curriculumId:node.curriculum_id,educationLevel:"SHS",grade:"SHS1",subject:"Computing",difficulty:"easy",cognitiveLevel:"Understand",answerType:"SINGLE_CHOICE",count:1,language:"English",marks:1,expectedSeconds:60,provenance:{source:"AI_GENERATED"} };
const resolved = {
  spec: { ...spec, content_context: { scope: "LOCAL_MARKET" as const, source_mode: "CURRICULUM_ALIGNED" as const, market_ids: ["market"], source_document_ids: ["source"], provenance: [{ id: "source", checksum: "hash", kind: "CURRICULUM", market_id: "market", curriculum_id: "curriculum", authority_id: "authority" }] } },
  documents: [{ id: "source", title: "Approved source", checksum: "hash", kind: "CURRICULUM", text: "Storage devices retain files." }],
};
const errors = (input: Candidate) => validateCandidate(input,nodes).filter((i) => i.severity==="error").map((i) => i.code);
describe("governed question factory", () => {
  it("requires human approval", () => { expect(canTransition("review","approved")).toBe(false); expect(canTransition("review","approved",true)).toBe(true); });
  it("forbids generated-to-approved shortcuts", () => expect(canTransition("generated","approved",true)).toBe(false));
  it("allows revision cycles", () => expect(canTransition("needs_revision","review")).toBe(true));
  it("requires active approved validated production content", () => { expect(isProductionAvailable({status:"active",validation_status:"approved"},true)).toBe(true); expect(isProductionAvailable({status:"inactive",validation_status:"approved"},true)).toBe(false); expect(isProductionAvailable({status:"active",validation_status:"review"},true)).toBe(false); expect(isProductionAvailable({status:"active",validation_status:"approved"},false)).toBe(false); });
  it.each(["DEV_ACCEPTANCE_FIXTURE","DEV_FACTORY_PILOT"])("excludes %s from production", (source_type) => expect(isProductionAvailable({status:"active",validation_status:"approved",source_type},true)).toBe(false));
  it("accepts a complete MCQ but always requires semantic review", () => { expect(errors(q)).toEqual([]); expect(validateCandidate(q,nodes).at(-1)?.severity).toBe("review"); });
  it.each([
    [{option_a:""}, "EMPTY_OPTION"], [{option_b:"storage drive"}, "DUPLICATE_OPTIONS"], [{correct_answer:"E"}, "INVALID_ANSWER"],
    [{explanation:""}, "MISSING_EXPLANATION"], [{marks:0}, "INVALID_MARKS"], [{marks:Infinity}, "INVALID_MARKS"],
    [{estimated_time_seconds:4}, "INVALID_DURATION"], [{estimated_time_seconds:60.5}, "INVALID_DURATION"],
    [{difficulty_label:"legendary"}, "INVALID_DIFFICULTY"], [{curriculum_node_id:"invented"}, "INVALID_INDICATOR"],
    [{question_text:"<script>alert(1)</script>"}, "UNSAFE_CONTENT"], [{question_text:"The answer is A"}, "ANSWER_LEAKAGE"],
    [{question_content:{blocks:[{type:"image",src:"https://example.test"}]}}, "UNSUPPORTED_MEDIA"],
    [{question_content:{blocks:[{type:"math",latex:"\\href{evil}{x}"}]}}, "UNSAFE_CONTENT"],
  ])("rejects invalid candidates %j", (patch, code) => expect(errors({...q,...patch} as Candidate)).toContain(code));
  it("rejects malformed objects without throwing", () => expect(errors({question_text:42} as unknown as Candidate)).toEqual(["MALFORMED_CANDIDATE"]));
  it("rejects answer-bearing keys hidden in rich content", () => expect(errors({...q,question_content:{blocks:[{type:"text",text:"Question",correct_answer:"A"}]}})).toContain("UNSAFE_CONTENT"));
  it("rejects answer leakage in rich text", () => expect(errors({...q,question_content:{blocks:[{type:"text",text:"The answer is A"}]}})).toContain("ANSWER_LEAKAGE"));
  it("requires the actual indicator title", () => expect(validateSpec({...spec,indicatorTitle:"Invented objective"},node)).toContain("SPEC_MAPPING_MISMATCH"));
  it("requires explicit matching boolean", () => { const tf={...q,answer_type:"TRUE_FALSE" as const,option_a:"True",option_b:"False",answer_spec:{boolean:true}}; expect(errors(tf)).toEqual([]); expect(errors({...tf,correct_answer:"B"})).toContain("INVALID_BOOLEAN_ANSWER"); });
  it("rejects double negatives", () => expect(errors({...q,answer_type:"TRUE_FALSE",option_a:"True",option_b:"False",answer_spec:{boolean:true},question_text:"It is not never stored."})).toContain("DOUBLE_NEGATIVE"));
  it("preserves official B10 code with canonical SHS1 spec", () => { expect(validateSpec(spec,node)).toEqual([]); expect(validateSpec({...spec,grade:"B10"},node)).toContain("SPEC_MAPPING_MISMATCH"); });
  it("bounds generation size", () => expect(validateSpec({...spec,count:101},node)).toContain("INVALID_COUNT"));
  it("normalizes Unicode punctuation and spaces", () => expect(normalize("  Ａ File—Store! ")).toBe("a file store"));
  it("matches exact normalized text hashes", () => expect(signatures({...q,question_text:"WHICH DEVICE STORES FILES!"}).text).toBe(signatures(q).text));
  it("detects option rotation without losing answer identity", () => { const rotated={...q,option_a:q.option_b,option_b:q.option_a,correct_answer:"B"}; expect(signatures(rotated).options).toBe(signatures(q).options); expect(signatures(rotated).answer).toBe(signatures(q).answer); });
  it("flags duplicates rather than deleting", () => { const other={...q,external_question_id:"sample-2"}; expect(duplicateWarnings(q,[other])).toHaveLength(1); expect(other.external_question_id).toBe("sample-2"); });
  it("uses bounded near similarity", () => { expect(similarity("one two three","one two four")).toBe(.5); expect(similarity("","")).toBe(0); });
  it("rolls coverage upward and excludes both fixture sources", () => { const subject={...node,id:"subject",parent_id:null,node_type:"subject"}; const base={curriculum_node_id:node.id,status:"active",validation_status:"approved",source_type:"HUMAN_AUTHOR",difficulty_label:"easy",answer_type:"SINGLE_CHOICE"}; const report=calculateCoverage([subject,node],[base,{...base,source_type:"DEV_ACCEPTANCE_FIXTURE"},{...base,source_type:"DEV_FACTORY_PILOT"}]); expect(report.summary.fixtureQuestions).toBe(2); expect(report.summary.productionApproved).toBe(1); expect(report.nodes.find((r)=>r.id==="subject")?.approved).toBe(1); expect(report.nodes.find((r)=>r.id===node.id)?.types.SINGLE_CHOICE).toBe(1); });
  it("detects taxonomy cycles", () => expect(() => calculateCoverage([{...node,parent_id:node.id}],[])).toThrow("CURRICULUM_CYCLE"));
  it.each([[0,"Empty"],[1,"Critical"],[4,"Thin"],[10,"Adequate"],[20,"Strong"]])("classifies density %i", (count, health) => expect(coverageHealth(Number(count))).toBe(health));
  it("grounds prompts in actual indicator and unapproved workflow", () => { expect(buildGenerationPrompt(spec)).toContain(node.code); expect(buildGenerationPrompt(spec)).toContain("human editorial review"); });
  it("supports local sample provider without claiming external AI", async () => { const output=await generateQuestions(spec,node,new SampleProvider([q]),resolved); expect(output[0].source_type).toBe("AI_GENERATED"); });
  it("rejects wrong-sized provider output", async () => await expect(generateQuestions(spec,node,new SampleProvider([]),resolved)).rejects.toThrow("INVALID_PROVIDER_OUTPUT"));
  it("rejects invented provider mapping", async () => await expect(generateQuestions(spec,node,new SampleProvider([{...q,curriculum_node_id:"invented"}]),resolved)).rejects.toThrow("PROVIDER_MAPPING_MISMATCH"));
  it("does not call a provider without resolved approved sources", async () => {
    let called = false;
    const provider = { name: "test", model: "mock", generate: async () => { called = true; return [q]; } };
    await expect(generateQuestions(spec,node,provider,{ ...resolved, documents: [] })).rejects.toThrow("AUTHORIZED_GENERATION_SOURCES_REQUIRED");
    expect(called).toBe(false);
  });
  it("grounds prompts in resolved extracts without a Ghana-only shared-service default", () => {
    const prompt = buildGenerationPrompt(resolved.spec,resolved.documents);
    expect(prompt).toContain("Storage devices retain files.");
    expect(prompt).not.toContain("Ghanaian schools");
  });
  it("rejects provider source/checksum mismatch", async () => {
    await expect(generateQuestions(spec,node,new SampleProvider([q]),{ ...resolved, documents: [{ ...resolved.documents[0], checksum: "other" }] })).rejects.toThrow("AUTHORIZED_GENERATION_SOURCES_REQUIRED");
  });
});
