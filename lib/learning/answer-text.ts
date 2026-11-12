// Shows an answer the way a learner reads it: the option letter with its text ("B. Photosynthesis"), not the letter alone.
// Option text comes from the question's options (the review carries `options` as { option_key, content.blocks[].text }) or from option_a to option_d when the question has those.
// Several keys (multiple choice kept as a JSON list, or an array) are joined with commas; anything that is not an option key is shown as it is.
type Question = { options?: { option_key?: string; content?: { blocks?: { text?: string }[] } }[] | null; [key: string]: unknown };

export function optionText(question: Question, key: string): string | null {
  const fromOptions = question.options?.find((o) => o.option_key === key)?.content?.blocks?.map((b) => b.text ?? "").join(" ").trim();
  const flat = question[`option_${key.toLowerCase()}`];
  const text = fromOptions || (typeof flat === "string" ? flat.trim() : "");
  return text && text !== key ? text : null;
}

export function describeAnswer(question: Question, raw: unknown, empty = "No answer"): string {
  if (raw == null || raw === "") return empty;
  let keys: unknown[] = [raw];
  if (typeof raw === "string" && raw.trim().startsWith("[")) { try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) keys = parsed; } catch { /* keep the raw text */ } }
  else if (Array.isArray(raw)) keys = raw;
  return keys.map((key) => { const k = String(key), text = optionText(question, k); return text ? `${k}. ${text}` : k; }).join(", ");
}
