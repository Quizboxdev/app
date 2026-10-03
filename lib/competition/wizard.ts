export const WIZARD_STEPS = ["Basics", "Audience", "Market scope", "Source mode", "Sources", "Assessment", "Review", "Preview", "Save draft"] as const;
export type WizardConfig = {
  title: string; description: string; startsAt: string; endsAt: string;
  registrationOpensAt: string; registrationClosesAt: string;
  audience: string; access: string; grades: string; institutions: string;
  minAge: string; maxAge: string; scope: string; marketIds: string[]; sourceMode: string; sourceIds: string[];
  totalQuestions: number; questionsPerAttempt: number; durationSeconds: number; attemptLimit: number;
  easy: number; medium: number; hard: number; randomizeQuestions: boolean; randomizeAnswers: boolean;
  scoring: string; negativeMarking: number; passMark: string; tieBreak: string;
  answerVisibility: string; explanationVisibility: string; leaderboard: string; topN: string;
  seniorReviewRequired: boolean; step: number;
  publishAt: string; leaderboardShowInstitution: boolean;
  provider: string; model: string; instructions: string;
};
// Settings the current assessment engine cannot honour; shown disabled in the wizard.
export const UNSUPPORTED_SETTINGS = ["randomizeQuestions", "randomizeAnswers"] as const;
export function newWizardConfig(): WizardConfig {
  return { publishAt: "", leaderboardShowInstitution: false, title: "", description: "", startsAt: "", endsAt: "", registrationOpensAt: "", registrationClosesAt: "", audience: "student", access: "public", grades: "", institutions: "", minAge: "", maxAge: "", scope: "LOCAL_MARKET", marketIds: [], sourceMode: "SPONSOR_SOURCE", sourceIds: [], totalQuestions: 10, questionsPerAttempt: 10, durationSeconds: 600, attemptLimit: 1, easy: 30, medium: 50, hard: 20, randomizeQuestions: false, randomizeAnswers: false, scoring: "points", negativeMarking: 0, passMark: "", tieBreak: "completion_time", answerVisibility: "after_close", explanationVisibility: "after_close", leaderboard: "after_close", topN: "", seniorReviewRequired: true, step: 0, provider: "", model: "", instructions: "" };
}
export function wizardIssues(config: WizardConfig, step: number): string[] {
  const errors: string[] = [];
  if (step === 0) {
    if (!config.title.trim()) errors.push("Competition title is required.");
    const dates = [config.registrationOpensAt, config.registrationClosesAt, config.startsAt, config.endsAt].map(Date.parse);
    if (dates.some(n => !Number.isFinite(n)) || dates[0] > dates[1] || dates[1] > dates[2] || dates[2] >= dates[3]) errors.push("Set valid registration and competition dates in order.");
    if (config.publishAt && (!Number.isFinite(Date.parse(config.publishAt)) || Date.parse(config.publishAt) > dates[0])) errors.push("The visible-from time must be on or before registration opens.");
  }
  if (step === 1 && [config.minAge, config.maxAge].some(v => v !== "" && (!Number.isInteger(Number(v)) || Number(v) < 0))) errors.push("Age limits must be non-negative whole numbers.");
  if (step === 1 && config.minAge !== "" && config.maxAge !== "" && Number(config.minAge) > Number(config.maxAge)) errors.push("Minimum age cannot exceed maximum age.");
  if (step === 2 && (config.scope === "LOCAL_MARKET" && config.marketIds.length !== 1 || config.scope === "MULTI_MARKET" && config.marketIds.length < 2 || config.scope === "GLOBAL" && config.marketIds.length !== 0)) errors.push("Select the markets required by this scope.");
  if (step === 4 && !config.sourceIds.length) errors.push("Select approved source documents before generation.");
  if (step === 5) {
    if (![config.totalQuestions, config.questionsPerAttempt, config.durationSeconds, config.attemptLimit].every(n => Number.isSafeInteger(n) && n > 0) || config.questionsPerAttempt > config.totalQuestions) errors.push("Check question counts, duration and attempt limit.");
    if (![config.easy, config.medium, config.hard].every(n => Number.isFinite(n) && n >= 0) || config.easy + config.medium + config.hard !== 100) errors.push("Difficulty percentages must total 100.");
    if (!Number.isFinite(config.negativeMarking) || config.negativeMarking < 0 || config.passMark !== "" && (!Number.isFinite(Number(config.passMark)) || Number(config.passMark) < 0 || Number(config.passMark) > 100)) errors.push("Check negative marking and pass mark.");
    if (config.topN !== "" && (!Number.isInteger(Number(config.topN)) || Number(config.topN) < 1)) errors.push("Leaderboard limit must be a positive whole number.");
  }
  return errors;
}
export function resumeWizardConfig(saved: Record<string, unknown>): WizardConfig {
  const config = { ...newWizardConfig(), ...saved } as WizardConfig;
  config.step = Number.isInteger(config.step) ? Math.max(0, Math.min(8, config.step)) : 0;
  // The assessment engine does not support randomization yet; older drafts are normalized so they stay publishable.
  config.randomizeQuestions = false; config.randomizeAnswers = false;
  return config;
}
