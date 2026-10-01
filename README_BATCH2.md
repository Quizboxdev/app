# QuizBox Batch 2 — Admin + Tenant + Marketplace + Competition + Sponsor

This is the second and final application-code batch.

It is designed to be merged into the Batch 1 Next.js project.

## Included

- Platform Admin dashboard
- Content health
- Marketplace metrics
- Competition metrics
- Operations/support health
- Tenant dashboard
- Tenant branding/settings viewer
- Marketplace catalogue
- Seller dashboard
- Seller products
- Seller earnings/payout view
- Manual entitlement granting for admins
- Interschool competition management
- School registration
- Team creation
- Team roster management
- Competition leaderboard
- Sponsor dashboard
- Competition sponsorship view
- Support ticket list
- Feature flags
- Analytics refresh server route
- Updated navigation shell

## Explicitly excluded

- Paystack
- Flutterwave
- Stripe
- card processing
- mobile money processing
- payment webhooks
- automatic checkout settlement

Existing payment-related database tables remain dormant.

## Merge

Copy the contents of this ZIP into the root of the Batch 1 project.

Allow Batch 2 to replace:

- `components/AppShell.tsx`

Batch 2 adds routes under:

- `app/(app)/admin`
- `app/(app)/tenant`
- `app/(app)/marketplace`
- `app/(app)/seller`
- `app/(app)/competition`
- `app/(app)/sponsor`
- `app/api/ops/refresh-analytics`

and API modules under:

- `lib/api/admin.ts`
- `lib/api/marketplace.ts`
- `lib/api/competition.ts`
- `lib/api/tenant.ts`
- `lib/api/sponsor.ts`

## Additional environment variable

For the optional server-only analytics refresh endpoint, add:

SUPABASE_SERVICE_ROLE_KEY=...

This key must NEVER be prefixed with NEXT_PUBLIC_ and must NEVER be used in browser code.

If you do not want to configure a service-role key yet, the rest of Batch 2 still works. The analytics refresh endpoint will remain unavailable until configured.

## Run

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Backend assumptions

The already-completed Supabase backend is expected to expose:

- `qb_admin_platform_overview`
- `qb_admin_content_health`
- `qb_admin_marketplace_metrics`
- `qb_admin_competition_metrics`
- `qb_admin_operations_health`
- `qb_tenant_dashboard`
- `qb_tenant_learning_metrics`
- `qb_admin_event_summary`
- `qb_get_daily_metrics`
- `qb_refresh_daily_metrics`
- `qb_refresh_learning_metrics`
- `qb_seller_dashboard`
- `qb_seller_balance`
- `qb_request_payout`
- `qb_register_competition_school`
- `qb_create_competition_team`
- `qb_add_team_member`
- `qb_verify_team_member`
- `qb_record_competition_result`
- `qb_finalize_competition_leaderboard`
- `qb_competition_leaderboard`
- `qb_attach_competition_sponsor`
- `qb_competition_funding_summary`

## Important

This batch does not require further database redesign.
