import { evidenceNote, masteryLevel, type MasteryLevel } from "@/lib/learning/mastery";

const TONE: Record<MasteryLevel, string> = { Mastered: "success", Proficient: "", Developing: "amber", "Needs Work": "danger" };

// QuizBox mastery (practice-driven) label. Distinct from official CCP proficiency, which uses classifyProficiency.
// `evidence` (answered questions) stops a thin sample from reading as Mastered; the qualifier is spelled out, never colour-only.
export default function MasteryBadge({ percentage, evidence }: { percentage: number; evidence?: number }) {
  const level = masteryLevel(percentage, evidence);
  const note = evidenceNote(percentage, evidence);
  return <><span className={`qb-pill ${TONE[level]}`.trim()}>{level}</span>{note && <span className="qb-muted qb-small"> {note}</span>}</>;
}
