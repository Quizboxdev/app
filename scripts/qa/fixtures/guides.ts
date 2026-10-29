import type { QaFixture } from "../fixture-server";
import type { HelpMeta } from "../../../lib/help/categories";
import { buildStudentFixture } from "./student";
import { buildTeacherFixture } from "./teacher";

// Synthetic records used only by the local browser harness.
export function buildGuidesFixture(): QaFixture {
  const base = process.env.QA_GUIDES_ROLE === "teacher" ? buildTeacherFixture() : buildStudentFixture();
  const scenario = process.env.QA_GUIDES_SCENARIO;
  const label = process.env.QA_GUIDES_ROLE === "teacher" ? "QA Teacher" : "QA Student";
  const guides: HelpMeta[] = [
    { slug: "qa-everyone", title: "QA fixture: account guide", summary: "Synthetic guide for every audience; this is not published content.", category: "account", audiences: ["everyone"] },
    { slug: "qa-learner", title: "QA fixture: learner guide", summary: "Synthetic learner guide for responsive layout and keyboard checks.", category: "practise", audiences: ["student"] },
    { slug: "qa-teacher", title: "QA fixture: teacher guide", summary: "Synthetic teacher guide for role-filter verification.", category: "classes", audiences: ["teacher"] },
    { slug: "qa-school", title: "QA fixture: school guide", summary: "Synthetic school guide for role-filter verification.", category: "assignments", audiences: ["school"] },
    { slug: "qa-sponsor", title: "QA fixture: sponsor guide", summary: "Synthetic sponsor guide for role-filter verification.", category: "safety", audiences: ["sponsor"] },
  ];
  let transientSearches = 0;
  const list = (audience: string | null) => guides.filter(g => !audience || g.audiences.includes("everyone") || g.audiences.includes(audience));
  return { ...base, user: { ...base.user, email: "guides-qa@example.invalid" }, routes: [{ path: "/guides", label: "guides" }], tables: { ...base.tables,
    profiles: base.tables.profiles.map(profile => ({ ...profile, full_name: label, email: "guides-qa@example.invalid" })),
    platform_settings: scenario === "off" ? [] : [{ key: "flags.design_v02_help", value: true, scope_type: "global", scope_id: null }],
  }, rpc: { ...base.rpc,
    qb_help_list: async (args: { p_audience: string | null }) => { if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 20000)); if (scenario === "error") throw new Error("QA_GUIDES_FAILURE"); return scenario === "empty" ? [] : list(args.p_audience); },
    qb_help_search: (args: { p_audience: string | null; p_query: string }) => { if (args.p_query === "qa-error") throw new Error("QA_SEARCH_FAILURE"); if (args.p_query === "qa-retry") { if (transientSearches++ === 0) throw new Error("QA_TRANSIENT_SEARCH_FAILURE"); return list(args.p_audience); } return list(args.p_audience).filter(g => `${g.title} ${g.summary}`.toLowerCase().includes(args.p_query.toLowerCase())); },
    qb_help_get: (args: { p_slug: string }) => {
      const guide = guides.find(g => g.slug === args.p_slug);
      return guide ? { article: { ...guide, updated_at: "", body: `# ${guide.title}\n\n## QA fixture section\n\nSynthetic article content for checking the existing in-app reader.\n\n1. Synthetic step one.\n2. Synthetic step two.` }, related: [] } : null;
    },
    qb_help_track: () => ({ ok: true }),
  } };
}
