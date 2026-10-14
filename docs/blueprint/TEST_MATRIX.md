# Test matrix

## A. Education regression (green on every phase)
| Area | Existing coverage |
|---|---|
| Learner practice flow, grade scoping | `quick-practice-sql`, `student-scope`, `free-allowance-sql` (PGlite) |
| Attempt start and complete, assignment publish | `throttle-and-duplicates`, contracts tests |
| Curriculum import, level guard, identity | `lib/curriculum/*`, structure import tests |
| Source immutability, market readiness | source and market tests |
| Reviewer pool, earnings, policy file | `lib/sme/*` tests |
| Public RPC allow-list, visibility file | `public-rpc-allowlist`, visibility tests |
| Live acceptance on Preview | `npm run acceptance:live` (101+ tests); **not run since the latest migrations** (tracker G2) |

## B. New capability (written with each phase)
| Blueprint criterion (section 21) | Test to write | Phase |
|---|---|---|
| Anonymous discovery without an education role | anonymous request returns 200, no role prompt | 2 |
| Deep-link auth return | login with a campaign `next` lands on the campaign | 2 |
| Private and invitation campaigns absent from search and sitemap | anonymous query returns 0 rows; noindex header | 2 |
| Share metadata and QR | OG tags only for Public and Unlisted | 2 |
| Campaign creation by authorised creator only | negative test per role | 3 |
| Lifecycle transitions server-validated | client cannot publish or advance; idempotent replay | 3, 5 |
| Content versioning | replacing a source makes a new version; completed rounds unchanged | 3, 4 |
| Question grounding | no competitive question without evidence and review status | 4 |
| Deterministic server scoring bound to versions | replay yields equal scores | 5 |
| Tenant isolation | tenant A cannot read tenant B campaigns, assets or chunks | every phase |
| Analytics reconciliation | dashboard totals equal raw events | 7 |
| White-label without forking | brand change leaves logic untouched | 8 |

## C. Standing rules (blueprint 20.1)
Every new public route gets an anonymous, SEO and leakage test. Every permission change gets a negative test. Every migration gets a rollback test (the PGlite pattern already used).
