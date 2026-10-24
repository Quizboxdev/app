# 05 - Admin and operations workflow audit

**Evidence level: CODE-ONLY.** The admin area needs a signed-in owner or admin account. None was available, so no admin screen was opened in a browser. Everything below is read from source, plus a scripted scan of the 35 admin pages, and is a prediction to confirm. The scan is regex-based and indicative (it can miss a filter built in a shared component).

## 1. Inventory

33 admin page routes.

| Page | Lines (incl. imported components) | Tables | Confirm before action | Export | Filters | Paging | Whole-page error only |
|---|---|---|---|---|---|---|---|
| /admin | 243 | 0 | - | - | - | - | - |
| /admin/access | 107 | 2 | - | yes | yes | yes | - |
| /admin/challenge-reports | 52 | 0 | yes | yes | - | - | - |
| /admin/compensation | 130 | 1 | - | - | yes | yes | - |
| /admin/competitions | 101 | 0 | - | yes | yes | - | **yes** |
| /admin/competitions/assignments | 68 | 1 | - | - | yes | - | - |
| /admin/competitions/oversight | 21 | 0 | - | - | - | - | - |
| /admin/content | 304 | 2 | - | - | yes | yes | - |
| /admin/content-factory | 356 | 3 | yes | - | yes | yes | - |
| /admin/curriculum-sources | 125 | 4 | yes | - | yes | yes | - |
| /admin/curriculum-structure | 71 | 0 | yes | - | yes | - | - |
| /admin/exports | 95 | 1 | - | - | yes | yes | - |
| /admin/help | 87 | 1 | yes | yes | yes | - | - |
| /admin/inbox | 87 | 0 | yes | - | - | - | - |
| /admin/market-setup | 107 | 4 | - | - | yes | - | - |
| /admin/marketplace | 169 | 1 | - | yes | yes | - | - |
| /admin/markets | 130 | 1 | - | - | yes | yes | - |
| /admin/operations | 66 | 3 | yes | yes | yes | yes | - |
| /admin/payment-checks | 86 | 1 | - | - | yes | - | - |
| /admin/payouts | 130 | 1 | - | - | yes | yes | - |
| /admin/policies | 120 | 0 | yes | yes | - | - | - |
| /admin/pricing | 144 | 0 | - | yes | yes | - | - |
| /admin/quality | 52 | 1 | - | yes | - | - | - |
| /admin/question-batches | 106 | 1 | - | yes | - | - | - |
| /admin/question-loading | 120 | 1 | yes | yes | yes | - | - |
| /admin/refunds | 115 | 2 | - | yes | yes | - | - |
| /admin/reviewer-applications | 85 | 0 | - | - | - | - | - |
| /admin/reviewers | 130 | 1 | - | - | yes | yes | - |
| /admin/sme-performance | 130 | 1 | - | - | yes | yes | - |
| /admin/sme-workforce | 135 | 3 | yes | - | yes | yes | - |
| /admin/support | 119 | 2 | - | - | - | - | **yes** |
| /admin/tickets | 131 | 1 | yes | yes | yes | - | - |
| /admin/young-learners | 97 | 2 | yes | - | - | - | - |

## 2. Findings

**Efficiency**
- Menu size: an admin sees up to 7 groups and up to 39 links; the "Operations" group alone has 12 (UX-017). Capability filtering helps finance and support staff; owners see everything. A task-first home (what needs me today) would cut navigation: the Payment checks screen and the Exports hub already work this way.
- Reporting: 13 screens now carry an Export link (they could not export before the export work), and `/admin/exports` offers 31 datasets filtered by date range and category (delivered earlier, tested against the real database).
- Bulk operations: question batches, curriculum sources and the content factory are built for bulk work; support tickets, reviewer applications, refunds and payouts act on one record at a time (code). Whether that is slow in practice depends on volume, which is not known yet. Hypothesis, not a defect.

**Safety and recovery**
- Irreversible actions with a confirmation cue: content factory, curriculum sources and structure, young-learners erase, policies, tickets, operations. Without a cue in the scan: payouts, refunds, marketplace reverse/switch, payment settle. These screens use deliberate steps in their own forms (for example "Mark paid" requires a reference), so this needs a manual look once signed in. Marked NOT TESTED.
- Failure handling: two admin screens (`/admin/support`, `/admin/competitions`) replace the whole page with the error text alone, no retry (UX-014).

**Workflow continuity**
- Content path: Curriculum sources -> Curriculum structure -> Load questions -> Approve batches -> Content quality -> (Marketplace review for sold sets). Each is a separate menu item in different groups ("Content & curriculum" holds eight, "Competitions" holds the reports). A guided "next step" strip showing the batch state would remove the need to know the order. Enhancement.
- Money path: Payments (Paystack) -> Payment checks -> Refunds -> Payouts. Present, and Payment checks was built after a real missed payment. Good.

**Audit trail**
- Exports record `export.run`; manual payment settlement records `payment.settle_manual`; policy and marketplace actions write to the audit log. The audit log is exportable (People and audit group). Not verified in a running system.

## 3. What to test first once an owner session exists

1. Open every admin page at 390 px and 1440 px (sweep tool) and record console errors and axe results.
2. Walk the content path with a 20-question synthetic batch on Preview.
3. Walk the money path with Paystack test keys and a test refund.
4. Confirm each irreversible control shows a confirmation or a deliberate second step.
5. Check the menu for each capability: finance admin, support, content admin, reviewer.
