# QuizBox Batch 1 — Student + Teacher + Classroom + Assessment

This is the first of the two final application-code batches for QuizBox.

## Included

### Student
- Supabase authentication
- Role-aware routing
- Dashboard
- Assessment catalogue
- Secure timed assessment runtime
- Autosave/resume through Supabase RPC
- Rich question content
- Image assets through signed Supabase Storage URLs
- KaTeX mathematics rendering
- Single choice, multiple choice, numeric, fraction, short-text and expression inputs
- Server-side submission/grading
- Results history
- Post-submission review
- Classroom membership and assignments

### Teacher
- Teacher dashboard
- Class list
- Assignment creation/list
- Question bank list
- Gradebook

## Not included in Batch 1

The following are reserved for Batch 2:
- Platform Admin
- White-label tenant console
- Marketplace UI
- Seller console
- Sponsor UI
- Interschool competition UI
- Notification operations
- Scheduled jobs / operational automation
- Payment gateway

Payment gateway integration is intentionally excluded from the current QuizBox build.

## Required Supabase backend

This frontend expects the already-installed QuizBox RPCs, including:

- `qb_start_attempt`
- `qb_get_attempt`
- `qb_save_response`
- `qb_submit_attempt`
- `qb_get_result`
- `qb_get_attempt_review`
- `qb_my_results`

The backend acceptance gate should already return `PASS` for `QB-BACKEND-FINAL-1`.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Install:
   ```bash
   npm install
   ```
4. Run:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000`.

## Authentication

This package uses Supabase email/password authentication.

QuizBox database profiles are expected to be provisioned in `profiles`, with student and teacher role records in `student_profiles` / `teacher_profiles`.

Do not place the Supabase service-role key in this frontend.

## Security

The assessment client never requests `correct_answer_snapshot` or `answer_spec_snapshot` during an active attempt.

The secure lifecycle is:

`qb_start_attempt → qb_get_attempt → qb_save_response → qb_submit_attempt → qb_get_result → qb_get_attempt_review`

Correct answers appear only in the review RPC after submission.

## Rich Questions

`QuestionRenderer.tsx` supports:
- text blocks
- LaTeX/math blocks
- private image assets using signed URLs

`AnswerInput.tsx` supports:
- SINGLE_CHOICE
- TRUE_FALSE
- MULTIPLE_CHOICE
- NUMERIC
- FRACTION
- SHORT_TEXT
- EXPRESSION

## Integration note

Teacher assignment creation is intentionally thin: it writes the existing `assignments` contract and expects the already-configured Supabase RLS to enforce teacher/tenant scope.

If your production assignment creation is moved behind an RPC later, only `lib/api/teacher.ts` needs to change; page components can remain unchanged.
