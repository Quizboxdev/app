// Helpers shared by every role fixture: ids, the AppShell chrome calls, and one small curriculum tree.
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const DAY = 864e5;

type Shell = { role: "school_owner" | "teacher" | "student" | "platform_admin"; institution?: { id: string; name: string } };

// Everything AppShell, the workspace chip and the market control request, whatever the role.
export function shellRpc({ role, institution }: Shell): Record<string, (args: any) => unknown> {
  const market = { id: uid(41), name: "Ghana", country_id: uid(42), locale: "en-GH", timezone: "Africa/Accra" };
  return {
    qb_sme_context: () => ({ reviewer: false, content_admin: false, super_admin: false, finance_admin: false }),
    qb_notifications: () => ({ unread: 0, live: [], items: [] }),
    qb_list_content_markets: () => [market],
    qb_content_market_context: () => ({ scope: "single", source_mode: "approved", market_ids: [market.id], source_document_ids: [], locale: market.locale, timezone: market.timezone }),
    qb_my_roles: () => ({
      roles: [role], institutions: institution ? [{ institution_id: institution.id, name: institution.name, role: "owner" }] : [],
      context: { active_role: role, active_institution_id: institution?.id ?? null, last_app: role }, onboarding_completed: true,
    }),
  };
}

export const baseTables = () => ({ platform_settings: [], marketplace_sellers: [], teacher_profiles: [] as unknown[] });

export function profileRow(id: string, role: "STUDENT" | "TEACHER" | "ADMIN", fullName: string) {
  return { id, role, status: "active", full_name: fullName, email: `${fullName.split(" ")[0].toLowerCase()}@qa.example.invalid`, onboarding_completed_at: "2026-01-02T00:00:00Z", country: "Ghana" };
}

// Ghana-style hierarchy: level > grade > subject > strand > sub-strand > content standard > learning indicator.
export function curriculumFixture() {
  const curriculumId = uid(500);
  const node = (n: number, parent: number | null, node_type: string, title: string, extra: Record<string, unknown> = {}) =>
    ({ id: uid(n), curriculum_id: curriculumId, parent_id: parent ? uid(parent) : null, node_type, code: null, title, source_terminology: null, education_level: "JHS", grade_code: null, subject_code: null, sort_order: n, is_active: true, ...extra });
  const m = { grade_code: "B7", subject_code: "MATH" }, s = { grade_code: "B7", subject_code: "SCI" };
  const nodes = [
    node(501, null, "education_level", "Junior High School"),
    node(502, 501, "grade", "B7", { grade_code: "B7" }),
    node(503, 502, "subject", "Mathematics", m), node(504, 502, "subject", "Integrated Science", s),
    node(510, 503, "strand", "Number", m), node(511, 510, "sub_strand", "Fractions", m), node(512, 511, "content_standard", "Add and subtract fractions", { ...m, code: "B7.1.1.1" }),
    node(513, 512, "learning_indicator", "Add fractions with unlike denominators", { ...m, code: "B7.1.1.1.1" }),
    node(514, 512, "learning_indicator", "Subtract fractions with unlike denominators", { ...m, code: "B7.1.1.1.2" }),
    node(520, 504, "strand", "Diversity of matter", s), node(521, 520, "sub_strand", "Materials", s), node(522, 521, "content_standard", "Classify materials", { ...s, code: "B7.2.1.1" }),
    node(523, 522, "learning_indicator", "Describe properties of metals", { ...s, code: "B7.2.1.1.1" }),
  ];
  return {
    curriculum: { id: curriculumId, code: "GH-CCP", name: "Ghana Common Core Programme", version: "2020", country: "Ghana", status: "ACTIVE" },
    nodes, ids: { curriculumId, mathSubject: uid(503), indicator: uid(513) },
    // Question counts per node: leaves have questions, containers show a total.
    availability: (ids: string[]) => ids.map((id) => ({ curriculum_node_id: id, approved_count: nodes.find((n) => n.id === id)?.node_type === "learning_indicator" ? 12 : 40, easy_count: 4, medium_count: 5, hard_count: 3 })),
  };
}
