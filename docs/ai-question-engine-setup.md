# AI question engine: setup (Google Gemini)

Content Factory generates draft questions through an adapter at `/api/generation/curriculum` (`lib/generation/adapter.ts`).
The adapter relays the factory's prompt, which already contains the server-authorised source text, to Gemini and returns a JSON
array of exactly the requested count. Every candidate enters human review; nothing is auto-approved or published.

What is sent to Google: curriculum source text, the indicator and the instructions. No learner data. Google Search grounding
and all tools are off, so questions can only come from the supplied sources.

## One-time setup (owner)

1. **Create a key** in Google AI Studio (aistudio.google.com) via the key icon. Check **Dashboard > Usage & billing**: a project on
   the free tier has low limits and different data terms; a paid-tier project is what you want for real runs.
   Use a **separate key for Preview and for Production**, and set a spending cap or budget alert.
2. **Pick a stable model** (not a `-preview` model) from the AI Studio model list. Preview models can change or be retired.
3. **Vercel > Settings > Environment Variables** (never paste keys in chat). Add, per environment:

| Variable | Value |
|---|---|
| `QUIZBOX_GENERATION_PROVIDER` | `google` |
| `QUIZBOX_GENERATION_MODEL` | the model id, e.g. the stable Flash model you chose |
| `QUIZBOX_GENERATION_ENDPOINT` | `https://www.quizbox.io/api/generation/curriculum` (use the Preview URL for Preview) |
| `QUIZBOX_GENERATION_API_KEY` | a long random secret you make up (e.g. 40+ random characters). Callers must present it; it is not the Google key |
| `GEMINI_API_KEY` | the Google AI Studio key |

4. Redeploy. In Content Factory the campaign's provider/model must equal `google` and the model id above (the run is refused on mismatch).

## First run

Create a small campaign: one indicator, 5 questions. Press **Run**, then review the candidates under Content Operations.
Failures show readable codes (for example `GENERATION_PROVIDER_RATE_LIMITED`, `GENERATION_PROVIDER_TRUNCATED`).

## Notes

- The factory run route allows up to 300 s; each Gemini call is limited to 80 s.
- Another provider (Anthropic) can be added behind the same route; the contract does not change.
- Sponsor-engine generation uses a different request shape (`{input, chunks}`) and is a separate adapter (tracker F2).
