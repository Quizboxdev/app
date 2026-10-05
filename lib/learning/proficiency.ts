import { GHANA_CCP_BANDS, classifyByBands, type ProficiencyBand } from "@/lib/core/config";

export type Proficiency = "Highly Proficient" | "Proficient" | "Approaching Proficiency" | "Developing" | "Emerging";

// Bands default to Ghana CCP and are overridable per curriculum via platform_settings ("proficiency.bands").
export function classifyProficiency(percentage: number, bands: readonly ProficiencyBand[] = GHANA_CCP_BANDS): Proficiency {
  return classifyByBands(percentage, bands).label as Proficiency;
}

