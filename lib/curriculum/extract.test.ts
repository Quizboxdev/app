import { describe, expect, it } from "vitest";
import { extractCurriculum, type CurriculumPage } from "./extract";

const page = (n: number, ...lines: string[]): CurriculumPage => ({ n, text: lines.join("\n") });
const header = (printed: string) => `${printed}\t� NaCCA, Ministry of Education 2021`;

describe("curriculum extraction", () => {
  it("reads strand, sub-strand, content standard, indicator, exemplars, and the page of each indicator", () => {
    const { rows, anomalies } = extractCurriculum([page(39, header("2"),
      "STRAND 1: DIVERSITY OF MATTER", "SUB-STRAND 1: MATERIALS", "CONTENT STANDARD \tINDICATORS AND EXEMPLARS \tCORE COMPETENCIES",
      "B7.1.1.1 Recognise", "materials as important", "resources for providing", "human needs",
      "B7.1.1.1.1 Classify materials into liquids, solids and gases", "Exemplars:",
      "1. Create and complete a table to record the texture,", "appearance and colour.", "2. Group materials into liquids, solids and gases.",
      "Creativity and Innovation (CI), Critical", "Thinking and Problem solving (CP)", "CI 5.2: Ability to merge ideas")]);
    expect(anomalies).toEqual([]);
    expect(rows).toEqual([{ grade: "B7", strandNo: 1, strand: "DIVERSITY OF MATTER", subStrandNo: 1, subStrand: "MATERIALS", contentStandardCode: "B7.1.1.1",
      contentStandard: "Recognise materials as important resources for providing human needs", indicatorCode: "B7.1.1.1.1", indicator: "Classify materials into liquids, solids and gases",
      exemplars: ["Create and complete a table to record the texture, appearance and colour.", "Group materials into liquids, solids and gases."], pagePhysical: 39, pagePrinted: "2" }]);
  });

  it("repairs the typos found in the official documents", () => {
    const { rows } = extractCurriculum([page(26, header("24"), "STRAND 1: ENVIRONMENT", "Sub-Strand 1: Environmental Issues",
      "B7.1.1.1 Demonstrate skills in dealing with environmental challenges", "B7.1.1.2 Examine the sources of energy",
      "B7.1.1.1.1. Examine ways of dealing with sanitation challenges", "Exemplars", "1. Explain sanitation",
      "B7 1.1.2.1. Examine the sources of energy", "Exemplars", "1. Explain energy"),
      page(101, header("65"), "STRAND 1: SYSTEMS", "SUB-STRAND 1: THE HUMAN BODY SYSTEM", "B8. 3.1.1 Demonstrate knowledge of teeth", "B8.3.1.1.1 Identify parts of a tooth", "Exemplars:", "1. Label a tooth")]);
    expect(rows.map((r) => r.indicatorCode)).toEqual(["B7.1.1.1.1", "B7.1.1.2.1", "B8.3.1.1.1"]);
    expect(rows[2].contentStandardCode).toBe("B8.3.1.1");
  });

  it("reads Mathematics-style exemplars (E.g.1:, E.g.2, E.g. 1) with competencies before and between them", () => {
    const { rows } = extractCurriculum([page(43, header("2"), "STRAND 1: NUMBER", "Sub-strand 2: Number Operations",
      "B7.1.2.3 Demonstrate understanding of powers", "B7.1.2.3.1 Illustrate with examples the meaning of repeated factors", "using counting objects such as bottle tops.",
      "Creativity and Innovation", "(CI)", "E.g.1: \tModel repeated factors using counters.", "i. 3×3×3 is repeated factors.",
      "Critical thinking and", "Problem Solving (CP)", "` \tE.g.2 Explain what is meant by a power of a number.", "E.g.3 Explain the features of the power 23",
      "B7.1.2.3.2 Express a given number as a product of powers", "E.g. 1 i. 32 = 2×2×2×2×2")]);
    expect(rows).toHaveLength(2);
    expect(rows[0].indicator).toBe("Illustrate with examples the meaning of repeated factors using counting objects such as bottle tops.");
    expect(rows[0].exemplars).toEqual(["Model repeated factors using counters. i. 3×3×3 is repeated factors.", "Explain what is meant by a power of a number.", "Explain the features of the power 23"]);
    expect(rows[1].exemplars).toEqual(["i. 32 = 2×2×2×2×2"]);
  });

  it("resumes the exemplars when the numbered list continues after a core-competencies block on the next page", () => {
    const { rows } = extractCurriculum([
      page(26, header("24"), "STRAND 1: ENVIRONMENT", "Sub-Strand 1: Environmental Issues", "B7.1.1.2 Examine the sources of energy", "B7.1.1.2.1 Examine the sources of energy", "Exemplars",
        "1. Explain energy", "2. Describe the sources of energy in Ghana", "Critical thinking and Problem", "solving", "-Ability to combine Information and", "ideas from several sources", "Communication and", "Collaboration", "-Identify words or sentences"),
      page(27, header("25"), "3. In groups categorise sources of energy.", "4. Discuss why Ghana sometimes imports energy.", "-Demonstrate behaviour and skills", "Digital Literacy", "-Use digital tools to create novel things")]);
    expect(rows[0].exemplars).toEqual(["Explain energy", "Describe the sources of energy in Ghana", "In groups categorise sources of energy.", "Discuss why Ghana sometimes imports energy."]);
  });

  it("does not turn cross-references, introduction examples or contents lines into indicators", () => {
    const { rows, anomalies } = extractCurriculum([
      page(22, header("20"), "Example: Social Studies: B7.1.1.2.1", "B7. \tBasic Year 7"),
      page(5, "STRAND 5: HUMANS AND THE ENVIRONMENT ............................ 114"),
      page(112, header("75"), "STRAND 4: FORCES AND ENERGY", "SUB-STRAND 4: MACHINES", "B8.4.4.2 Demonstrate understanding of complex machines", "B8.4.4.2.1 Identify complex machines", "Exemplars:",
        "1. Recap what simple machines are from B7.4.4.2.1", "2. Carry out an activity using knowledge acquired in", "indicator B8.4.4.2.1 in their communities.", "3. Explain the functions of a machine.")]);
    expect(rows.map((r) => r.indicatorCode)).toEqual(["B8.4.4.2.1"]);
    expect(rows[0].exemplars).toHaveLength(3);
    expect(rows[0].exemplars[1]).toContain("in their communities.");
    expect(anomalies).toEqual([]);
  });

  it("merges an indicator repeated with the same wording and reports a code used for two different indicators", () => {
    const base = (n: number, text: string) => page(n, header(String(n)), "STRAND 5: HEALTH", "SUB-STRAND 2: DISEASES", "B9.5.2.2 Demonstrate knowledge of diseases", `B9.5.2.2.1 ${text}`, "Exemplars:", "1. Explain it.");
    const same = extractCurriculum([base(153, "Explain the concepts of health and disease"), base(154, "Explain the concepts of health and disease")]);
    expect(same.rows).toHaveLength(1);
    expect(same.anomalies).toEqual(["REPEATED_INDICATOR_MERGED B9.5.2.2.1"]);
    const different = extractCurriculum([base(153, "Explain the concepts of health and disease"), base(154, "Explain the nature of fungal diseases")]);
    expect(different.rows).toHaveLength(2);
    expect(different.anomalies[0]).toContain("SOURCE_DUPLICATE_CODE B9.5.2.2.1");
  });

  it("reports what it could not complete, so gaps are visible", () => {
    const { anomalies } = extractCurriculum([page(40, header("3"), "STRAND 1: NUMBER", "Sub-strand 1: Counting", "B7.1.1.1 Demonstrate counting", "B7.1.1.1.1 Count to ten", "B7.1.1.1.2 Count to a hundred", "Exemplars:", "1. Count aloud.")]);
    expect(anomalies).toEqual(["NO_EXEMPLARS B7.1.1.1.1"]);
  });
});
