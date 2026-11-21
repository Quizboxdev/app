// What a sponsor is told about their verification, in plain words. The status values come from the database in capitals (PENDING, VERIFIED, REJECTED).
export type VerificationView = { tone: "ok" | "info" | "bad"; label: string; message: string };

export function verificationView(status: unknown, note?: unknown): VerificationView {
  const s = String(status ?? "PENDING").toUpperCase();
  if (s === "VERIFIED") return { tone: "ok", label: "Verified", message: "QuizBox has verified your organisation." };
  if (s === "REJECTED") {
    const why = typeof note === "string" && note.trim() ? ` Reason: ${note.trim()}` : "";
    return { tone: "bad", label: "Not verified", message: `We could not verify your organisation.${why} Contact QuizBox if you think this is a mistake.` };
  }
  return { tone: "info", label: "Waiting for verification", message: "We check who is behind a sponsor before an organisation's name is shown next to work for children. You can keep using your workspace while we check." };
}
