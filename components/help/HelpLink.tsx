import Link from "next/link";
import { CircleHelp } from "lucide-react";

// A small "How do I...?" link for the top of a screen, pointing at the matching guide inside the app. Plain markup, works on server and client pages.
export default function HelpLink({ slug, label = "How does this work?" }: { slug: string; label?: string }) {
  return <Link className="qb-link qb-small" href={`/guides/${slug}`} style={{ display: "inline-flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}><CircleHelp size={14} aria-hidden="true" />{label}</Link>;
}
