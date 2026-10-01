export const XP_RULES = Object.freeze({
  correctAnswer: 5,
  assignmentCompletion: 20,
  firstPassHighProficiency: 25,
});

export function levelFromXp(totalXp: number) {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const levelStart = (level - 1) ** 2 * 100;
  const nextLevel = level ** 2 * 100;
  return { level, totalXp: xp, currentLevelXp: xp - levelStart, nextLevelXp: nextLevel - levelStart };
}

export function calculateAttemptXp(correct: number, completed: boolean, percentage: number, isFirstPass: boolean) {
  return Math.max(0, correct) * XP_RULES.correctAnswer +
    (completed ? XP_RULES.assignmentCompletion : 0) +
    (isFirstPass && percentage >= 80 ? XP_RULES.firstPassHighProficiency : 0);
}

