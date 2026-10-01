export type Proficiency = "Highly Proficient" | "Proficient" | "Approaching Proficiency" | "Developing" | "Emerging";

export function classifyProficiency(percentage: number): Proficiency {
  if (percentage >= 80) return "Highly Proficient";
  if (percentage >= 68) return "Proficient";
  if (percentage >= 54) return "Approaching Proficiency";
  if (percentage >= 40) return "Developing";
  return "Emerging";
}

