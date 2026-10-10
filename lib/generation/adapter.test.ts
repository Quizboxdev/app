import { describe, expect, it, vi } from "vitest";
import { authorizeCaller, callGoogle, CANDIDATE_SCHEMA, generateCurriculum, normaliseCandidates, parseRequest } from "./adapter";
import { configuredFactoryProvider } from "../content/factory/campaign";
import { generateQuestions, type ResolvedGenerationSources } from "../content/factory/generation";
import { validateCandidate, type Candidate, type CurriculumNode, type GenerationSpec } from "../content/factory/contract";
import { POST } from "../../app/api/generation/curriculum/route";

const env = { QUIZBOX_GENERATION_PROVIDER: "google", QUIZBOX_GENERATION_MODEL: "gemini-test-model", QUIZBOX_GENERATION_API_KEY: "caller-secret", GEMINI_API_KEY: "upstream-secret" };
const node: CurriculumNode = { id: "node-1", curriculum_id: "cur-1", parent_id: null, node_type: "learning_indicator", code: "B10.2.4.1.1", title: "Use spreadsheet validation", grade_code: "SHS1", canonical_grade_code: "SHS1", subject_code: "COMPUTING", education_level: "SHS", is_active: true };
const spec: GenerationSpec = { indicatorId: "node-1", indicatorCode: node.code, indicatorTitle: node.title, curriculumId: "cur-1", educationLevel: "SHS", grade: "SHS1", subject: "COMPUTING", difficulty: "easy", cognitiveLevel: "Understand", answerType: "SINGLE_CHOICE", count: 2, language: "English", marks: 1, expectedSeconds: 45, provenance: { source: "AI_GENERATED", provider: "google", model: "gemini-test-model" } };
const resolved: ResolvedGenerationSources = { spec: { ...spec, content_context: { scope: "LOCAL_MARKET", source_mode: "CURRICULUM_ALIGNED", market_ids: ["m1"], source_document_ids: ["d1"], provenance: [{ id: "d1", checksum: "abc", kind: "CURRICULUM", market_id: "m1", curriculum_id: "cur-1", authority_id: "a1" }] } }, documents: [{ id: "d1", title: "NaCCA SHS1 Computing", checksum: "abc", kind: "CURRICULUM", text: "A validation list restricts entries to permitted values." }] };
const mcq = (n: number): Record<string, unknown> => ({ external_question_id: `model-${n}`, curriculum_node_id: "wrong", question_text: `Which feature restricts entries to listed values? (${n})`, answer_type: "SINGLE_CHOICE", option_a: "A font colour", option_b: "A data-validation list", option_c: "A page margin", option_d: "A chart legend", correct_answer: "B", explanation: "A validation list permits only listed entries.", difficulty_label: "easy", cognitive_level: "Understand", marks: 1, estimated_time_seconds: 45, source_type: "AI_GENERATED", tags: ["spreadsheets"] });
const gemini = (rows: unknown[], over: Record<string, unknown> = {}) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(rows) }] } }], ...over });
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const failureOf = async (run: Promise<unknown>) => run.then(() => "no error", (e: Error) => e.message);

describe("caller authorisation", () => {
  it("fails closed without a configured secret, and rejects missing or wrong bearer tokens", () => {
    expect(() => authorizeCaller("Bearer x", {})).toThrow("GENERATION_ADAPTER_NOT_CONFIGURED");
    expect(() => authorizeCaller(null, env)).toThrow("AUTH_REQUIRED");
    expect(() => authorizeCaller("Bearer wrong", env)).toThrow("AUTH_REQUIRED");
    expect(() => authorizeCaller("Basic caller-secret", env)).toThrow("AUTH_REQUIRED");
    expect(() => authorizeCaller("Bearer caller-secret", env)).not.toThrow();
  });
});

describe("request validation", () => {
  it("accepts the factory contract and rejects everything else", () => {
    expect(parseRequest({ kind: "curriculum", prompt: "p", spec: { count: 5, indicatorId: "n" } })).toEqual({ prompt: "p", spec: { count: 5, indicatorId: "n" } });
    for (const bad of [null, {}, { kind: "sponsor", prompt: "p", spec: { count: 1, indicatorId: "n" } }, { kind: "curriculum", prompt: "", spec: { count: 1, indicatorId: "n" } },
      { kind: "curriculum", prompt: "p", spec: { count: 0, indicatorId: "n" } }, { kind: "curriculum", prompt: "p", spec: { count: 101, indicatorId: "n" } }, { kind: "curriculum", prompt: "p", spec: { count: 1.5, indicatorId: "n" } }, { kind: "curriculum", prompt: "p", spec: { count: 1 } }])
      expect(() => parseRequest(bad)).toThrow("INVALID_GENERATION_REQUEST");
  });
});

describe("Google Gemini call", () => {
  it("sends the key in a header, forces JSON output with a schema, and enables no tools", async () => {
    const request = reply(gemini([mcq(1)]));
    await callGoogle(env, "the prompt", request as never);
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
    expect(url).not.toContain("upstream-secret");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("upstream-secret");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].text).toBe("the prompt");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseSchema: CANDIDATE_SCHEMA });
    expect(body).not.toHaveProperty("tools");
    expect(JSON.stringify(body)).not.toMatch(/google_?search|code_?execution|functionDeclarations/i);
    expect(init.redirect).toBe("error");
  });
  it("refuses an unsafe model name and an unconfigured key", async () => {
    expect(await failureOf(callGoogle({ ...env, QUIZBOX_GENERATION_MODEL: "x/../../v1/other" }, "p", reply({}) as never))).toBe("INVALID_GENERATION_MODEL");
    expect(await failureOf(callGoogle({ ...env, GEMINI_API_KEY: undefined }, "p", reply({}) as never))).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
  });
  it.each([
    ["rate limited", reply({}, 429), "GENERATION_PROVIDER_RATE_LIMITED"],
    ["server error", reply({}, 500), "GENERATION_PROVIDER_FAILED"],
    ["blocked prompt", reply({ promptFeedback: { blockReason: "SAFETY" } }), "GENERATION_PROVIDER_BLOCKED"],
    ["truncated output", reply(gemini([mcq(1)]).candidates && { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "[" }] } }] }), "GENERATION_PROVIDER_TRUNCATED"],
    ["safety stop", reply({ candidates: [{ finishReason: "SAFETY" }] }), "GENERATION_PROVIDER_BLOCKED"],
    ["no candidates", reply({}), "INVALID_PROVIDER_OUTPUT"],
    ["empty text", reply({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }] }), "INVALID_PROVIDER_OUTPUT"],
  ])("maps a %s to a safe code", async (_name, request, code) => { expect(await failureOf(callGoogle(env, "p", request as never))).toBe(code); });
  it("maps a network failure to a safe code", async () => {
    expect(await failureOf(callGoogle(env, "p", (async () => { throw new TypeError("fetch failed"); }) as never))).toBe("GENERATION_PROVIDER_UNREACHABLE");
  });
});

describe("candidate normalisation", () => {
  it("pins the target indicator and gives every candidate a fresh unique id", () => {
    const rows = normaliseCandidates(JSON.stringify([mcq(1), mcq(2)]), { count: 2, indicatorId: "node-1" }) as Array<Record<string, string>>;
    expect(rows.map((r) => r.curriculum_node_id)).toEqual(["node-1", "node-1"]);
    expect(new Set(rows.map((r) => r.external_question_id)).size).toBe(2);
    expect(rows[0].external_question_id).toMatch(/^QBGEN-[0-9a-f-]{36}$/);
  });
  it("rejects wrong counts, non-arrays and non-object rows", () => {
    for (const text of [JSON.stringify([mcq(1)]), JSON.stringify({ a: 1 }), "not json", JSON.stringify([mcq(1), "x"])])
      expect(() => normaliseCandidates(text, { count: 2, indicatorId: "node-1" })).toThrow("INVALID_PROVIDER_OUTPUT");
  });
});

describe("contract with Content Factory", () => {
  it("serves configuredFactoryProvider + generateQuestions end to end and produces candidates that pass validation", async () => {
    const upstream = reply(gemini([mcq(1), mcq(2)]));
    // Route the factory's own provider request into the adapter handler (server to server), with a mocked Gemini behind it.
    const through = vi.fn(async (_url: unknown, init: RequestInit) => {
      const request = new Request("https://www.quizbox.io/api/generation/curriculum", { method: "POST", headers: init.headers as HeadersInit, body: init.body as string });
      const original = globalThis.fetch; globalThis.fetch = upstream as never;
      try { Object.assign(process.env, env); return await POST(request); } finally { globalThis.fetch = original; }
    });
    const provider = configuredFactoryProvider({ ...env, QUIZBOX_GENERATION_ENDPOINT: "https://www.quizbox.io/api/generation/curriculum" }, through as never);
    const candidates = await generateQuestions(spec, node, provider, resolved);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.curriculum_node_id === "node-1" && c.source_type === "AI_GENERATED")).toBe(true);
    const nodes = new Map([[node.id, node]]);
    for (const c of candidates) expect(validateCandidate(c as Candidate, nodes).filter((i) => i.severity === "error")).toEqual([]);
    const sent = JSON.parse(String((upstream.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.contents[0].parts[0].text).toContain("server-authorized source extracts");
    expect(sent.contents[0].parts[0].text).toContain("A validation list restricts entries");
  });
  it("answers a wrong secret with 401 and never calls the provider", async () => {
    const upstream = reply(gemini([]));
    const original = globalThis.fetch; globalThis.fetch = upstream as never;
    try {
      Object.assign(process.env, env);
      const response = await POST(new Request("https://x.test/api/generation/curriculum", { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json" }, body: "{}" }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "AUTH_REQUIRED" });
    } finally { globalThis.fetch = original; }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not use a provider other than google", async () => {
    expect(await failureOf(generateCurriculum({ ...env, QUIZBOX_GENERATION_PROVIDER: "other" }, { kind: "curriculum", prompt: "p", spec: { count: 1, indicatorId: "n" } }, reply({}) as never))).toBe("GENERATION_PROVIDER_NOT_CONFIGURED");
  });
});
