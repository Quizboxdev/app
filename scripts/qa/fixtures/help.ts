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
  } };
}
