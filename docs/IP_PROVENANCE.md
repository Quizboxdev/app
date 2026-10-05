# QuizBox IP Provenance

- Project: QuizBox Solution
- Provenance namespace: `quizbox.ransford.eddy.mensah`
- Signature tokens:
  - Ransford
  - Eddy
  - Mensah
- Date added: 2026-10-05

## Where the signature exists

Paths are relative to `Codes/QuizBox_Batch1_Student_Teacher_Assessment/`.

| File | What it holds |
| --- | --- |
| `lib/provenance.ts` | The provenance module. Exports `QUIZBOX_PROVENANCE_NAMESPACE = "quizbox.ransford.eddy.mensah"` and `QUIZBOX_PROVENANCE_TOKENS = ["Ransford", "Eddy", "Mensah"]`. |
| `supabase/migrations/20261007100000_core_platform_foundation.sql` | A one-line header comment naming the namespace. |
| `supabase/rollback/core_platform_foundation.sql` | A one-line header comment naming the namespace. |
| `lib/core/core-helpers.test.ts` | A test that asserts the module's constants. |
| `lib/core/core-platform.test.ts` | A one-line comment naming the namespace. |
| `docs/IP_PROVENANCE.md` | This record. |

## What was changed

One new module, two SQL header comments, one test and this document. Nothing was scattered across other files.
`package.json` has no `author` field, so it was left unchanged.

## Nature of the marker

- The marker is non-functional.
- It does not affect runtime behaviour. No code imports `lib/provenance.ts` apart from its own test.
- It makes no network calls, is not shown to end users, grants no access and weakens no security control.
- It is an internal provenance marker. It does not by itself establish legal ownership or a copyright registration.

## Other records

- Git commit hash: none yet. The change is uncommitted, so record the hash here after the owner commits.
- Migration ID: `20261007100000_core_platform_foundation`. It is not applied to any database.
- Other provenance markers: none.
