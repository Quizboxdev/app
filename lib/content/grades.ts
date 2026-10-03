// Client-safe grade helpers. Market grades and their aliases are configured per market
// (markets.configuration.grades[].canonical). This table only covers legacy rows imported
// before market grade data existed (Ghana "B10" was stored for SHS 1).
export const LEGACY_GRADE_ALIASES: Readonly<Record<string, string>> = { B10: "SHS1" };
export const canonicalFilterGrade = (code?: string) => (code ? LEGACY_GRADE_ALIASES[code] ?? code : code);
