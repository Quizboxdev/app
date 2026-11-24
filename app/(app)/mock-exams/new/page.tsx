"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import AccessGate from "@/components/mock/AccessGate";
import ExamForm from "@/components/mock/ExamForm";

// Step 1: the exam's name, purpose, target year and rules. Rounds are added on the next screen.
export default function NewMockExamPage() {
  const router = useRouter();
  return (
    <AccessGate>{() => <>
      <div className="qb-page-head"><div><p className="qb-small"><Link className="qb-link" href="/mock-exams">← Mock exams</Link></p><h1>New mock exam</h1>
        <p>Tell us what the exam is for and who takes it. Next you add rounds: a year, a subject, a topic and a number of questions each, until the exam reaches its size.</p></div></div>
      <ExamForm onSaved={(e) => router.push(`/mock-exams/${e.id}`)} />
    </>}</AccessGate>
  );
}
