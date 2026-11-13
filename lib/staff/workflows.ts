// Connected workflows a super admin can give a colleague. Each is a bundle of admin tabs that work together, and stands for a staff capability the database already enforces on every action
// (content_admin, sme_support, finance_admin), so the screen can never give more than those capabilities allow. The database holds the mapping from workflow to capability; this file holds what each one is called and which tabs it opens.
export type WorkflowId = "content" | "support" | "finance";
export type NavTab = [href: string, label: string];
export type Workflow = { id: WorkflowId; label: string; summary: string; sensitive: boolean; tabs: NavTab[] };

export const WORKFLOWS: Workflow[] = [
  {
    id: "content", label: "Content team", sensitive: false,
    summary: "Loads and prepares questions and curriculum content, and manages the reviewers' work.",
    tabs: [["/admin/content-factory", "Content Factory"], ["/admin/question-loading", "Load Questions"], ["/admin/topics", "Topics for Teachers"], ["/admin/sme-workforce", "SME Workforce"], ["/review", "SME Reviews"], ["/review/policy", "Reviewer Policy"], ["/admin/exports", "Export data"]],
  },
  {
    id: "support", label: "Support desk", sensitive: false,
    summary: "Answers learners' and teachers' questions, handles enquiries and keeps the help guides.",
    tabs: [["/admin/inbox", "Enquiry Inbox"], ["/admin/tickets", "Support requests"], ["/admin/help", "Help guides"], ["/admin/reviewer-applications", "Reviewer Applications"], ["/admin/exports", "Export data"]],
  },
  {
    id: "finance", label: "Finance", sensitive: true,
    summary: "Reviewer pay, payouts and payment checks. These show money and payment records.",
    tabs: [["/admin/sme-performance", "SME Performance"], ["/admin/payouts", "Payouts"], ["/admin/payment-checks", "Payment checks"], ["/admin/affiliates", "Affiliates"], ["/admin/exports", "Export data"]],
  },
];

export const workflowLabel = (id: string) => WORKFLOWS.find((w) => w.id === id)?.label ?? id;

// The tabs a person's workflows open, once each, in workflow order. Unknown ids open nothing.
export function tabsFor(ids: string[]): NavTab[] {
  const seen = new Set<string>();
  const out: NavTab[] = [];
  for (const w of WORKFLOWS) {
    if (!ids.includes(w.id)) continue;
    for (const tab of w.tabs) if (!seen.has(tab[0])) { seen.add(tab[0]); out.push(tab); }
  }
  return out;
}
