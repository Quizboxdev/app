import Link from "next/link";
import { getLibraryStats, listPublicChallenges } from "@/lib/challenges/server";
import { CONTENT_TYPES } from "@/lib/challenges/content-types";
import { FORMATS, type Format } from "@/lib/challenges/types";
import OpenCatalogue from "@/components/challenges/OpenCatalogue";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 48;

// The catalogue returns one page at a time; its cursor is only an offset into live public campaigns.
export default async function OpenPage({ searchParams }: { searchParams: Promise<{ format?: string; page?: string }> }) {
  const params = await searchParams;
  const format: Format = params.format === "competition" ? "COMPETITION" : "CHALLENGE";
  const f = FORMATS[format];
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, 1000)) : 1;
  const [pageRows, stats] = await Promise.all([listPublicChallenges(format, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE), getLibraryStats()]);
  const items = pageRows.slice(0, PAGE_SIZE), hasNext = pageRows.length > PAGE_SIZE;
  const library = stats.documents > 0 ? CONTENT_TYPES.filter((t) => stats.by_type[t.id]).map((t) => `${stats.by_type[t.id]} ${t.plural}`).join(" · ") : "";

  return <>
    <div className="qb-page-head">
      <div>
        <h1>{format === "COMPETITION" ? "Open competitions" : "Open challenges"}</h1>
        <p>{format === "COMPETITION" ? "Find an open competition, see when it closes and take part in each round." : "Browse live quizzes, find one that interests you and see how many learners have taken part."}</p>
      </div>
      <nav aria-label="Choose a kind" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className={`qb-btn${format === "CHALLENGE" ? "" : " qb-btn-secondary"}`} href="/open">Challenges</Link>
        <Link className={`qb-btn${format === "COMPETITION" ? "" : " qb-btn-secondary"}`} href="/open?format=competition">Competitions</Link>
        <Link className="qb-btn qb-btn-secondary" href="/creator">Create one</Link>
      </nav>
    </div>
    {library && <p className="qb-muted" style={{ marginBottom: 12 }}><strong>On QuizBox now:</strong> {library}. Read the material, then take the quiz.</p>}
    {items.length === 0
      ? <div className="qb-card"><h2>No open {f.plural} right now</h2><p className="qb-muted">New ones appear here when they go live. You can run your own and share the link: <Link className="qb-link" href="/creator">Create and share</Link>.</p></div>
      : <OpenCatalogue items={items} format={format} page={page} hasNext={hasNext} />}
  </>;
}
