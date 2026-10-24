# Evidence manifest

| File | What it is | Produced by |
|---|---|---|
| evidence/baseline-typecheck.log | `tsc --noEmit` output | Command run 2026-10-21 |
| evidence/baseline-lint.log | ESLint output | Command run |
| evidence/baseline-vitest.json / .log | Full vitest results (1,305 tests) | Command run |
| evidence/npm-audit.json | `npm audit --json` | Command run |
| evidence/live-headers.txt | Response headers of quizbox.io, www, /pricing, /challenges | `curl -D` against the public site |
| evidence/console-home.txt | Browser console warnings/errors on the home page | Playwright |
| evidence/qbank-validation-main.json, -load.json | Per-file deterministic question checks | `scripts/audit/qb_validate.py` (run: `python -I scripts/audit/qb_validate.py "Questions Bank" out.json`) |
| ../user-guides/screenshots/public-home-desktop-1366.png | Live home page, desktop | Playwright, www.quizbox.io, build 05b437f, 2026-10-21 |
| ../user-guides/screenshots/public-pricing-desktop-1366.png | Live pricing page, full page | same |
| ../user-guides/screenshots/public-pricing-mobile-390.png | Live pricing page at phone width | same |

Not captured (BLOCKED): any signed-in screen. Screenshots contain only public pages and no personal data.
