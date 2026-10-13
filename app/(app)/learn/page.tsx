import { redirect } from "next/navigation";

// Learn used to walk the whole curriculum tree (education level, grade, subject, strand, sub-strand, standard, indicator). Learners and
// teachers do not need those stages: they choose a subject, then a random mix or ticked topics, then how many questions. That single flow
// lives on Practise; the hierarchy stays in the database for assignments and reporting.
export default function LearnPage() { redirect("/practise"); }
