import type { QaFixture } from "../fixture-server";
import type { HelpMeta } from "../../../lib/help/categories";
import { buildStudentFixture } from "./student";

// Synthetic QA-only records. Never imported by an application route.
export function buildHelpFixture(): QaFixture {
  const base = buildStudentFixture();
  const scenario = process.env.QA_HELP_SCENARIO;
  const guides: HelpMeta[] = [
    { slug: "qa-getting-started", title: "QA fixture: getting started", summary: "Synthetic test article for responsive layout checks.", category: "getting-started", audiences: ["everyone"], views: 8 },
    { slug: "qa-account", title: "QA fixture: account recovery", summary: "Synthetic test article with a longer title and summary for wrapping checks.", category: "account", audiences: ["everyone"], views: 4 },
    { slug: "qa-safety", title: "QA fixture: safety and privacy", summary: "Synthetic test article for keyboard navigation checks.", category: "safety", audiences: ["everyone"], views: 0 },
  ];
  return { ...base, routes: [{ path: "/help", label: "help" }], tables: { ...base.tables,
    platform_settings: scenario === "off" ? [] : [{ key: "flags.design_v02_help", value: true, scope_type: "global", scope_id: null }],
  }, rpc: { ...base.rpc,
    qb_help_list: () => { if (scenario === "error") throw new Error("QA_HELP_FAILURE"); return scenario === "empty" ? [] : guides; },
    qb_help_search: (args: { p_query: string }) => { if (args.p_query === "qa-error") throw new Error("QA_SEARCH_FAILURE"); return guides.filter(g => `${g.title} ${g.summary}`.toLowerCase().includes(args.p_query.toLowerCase())); },
    qb_help_get: (args: { p_slug: string }) => {
      if (scenario === "error") throw new Error("QA_ARTICLE_FAILURE");
      const article = guides.find(g => g.slug === args.p_slug);
      return !article || scenario === "empty" ? null : { article: { ...article, updated_at: "", body: `# ${article.title}\n\n## QA fixture: first section\n\nSynthetic article body for layout and keyboard checks. This is test content, never published content.\n\n## QA fixture: second section\n\nA longer paragraph checks wrapping on narrow devices. [Read the related test article](help:qa-getting-started).\n\n- Synthetic list item one\n- Synthetic list item two` }, related: guides.filter(g => g.slug !== article.slug).map(g => ({ slug: g.slug, title: g.title, summary: g.summary })) };
    },
    qb_help_track: () => ({ ok: true }),
  } };
}
