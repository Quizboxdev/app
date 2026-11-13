// Choosing some of a class's learners: search narrows the list, "Select all" and "Clear" act on what the search shows, and anyone chosen
// earlier stays chosen while the search changes. Pure functions, so the rules are tested without a browser.
export type PickLearner = { user_id: string; name: string };

export function filterLearners(learners: PickLearner[], query: string): PickLearner[] {
  const q = query.trim().toLowerCase();
  return q ? learners.filter((l) => l.name.toLowerCase().includes(q)) : learners;
}

export function toggleOne(chosen: string[], id: string): string[] {
  return chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
}

export function selectAllShown(chosen: string[], shown: PickLearner[]): string[] {
  const have = new Set(chosen);
  return [...chosen, ...shown.map((l) => l.user_id).filter((id) => !have.has(id))];
}

export function clearShown(chosen: string[], shown: PickLearner[]): string[] {
  const gone = new Set(shown.map((l) => l.user_id));
  return chosen.filter((id) => !gone.has(id));
}

export function allShownChosen(chosen: string[], shown: PickLearner[]): boolean {
  return shown.length > 0 && shown.every((l) => chosen.includes(l.user_id));
}
