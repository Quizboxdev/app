import { createClient } from "@supabase/supabase-js";

// Proves that seat allocation is safe under real parallel load. Run it ONLY against Preview, with a test partner and a test contract whose package code starts with "proof-".
//   $env:PROOF_SUPABASE_URL = "https://<preview-ref>.supabase.co"; $env:PROOF_SERVICE_KEY = "<preview service role key>"
//   $env:PROOF_PARTNER_ID = "<partner uuid>"; $env:PROOF_CONTRACT_ID = "<contract uuid>"
//   npx tsx scripts/partner/prove-parallel-seats.ts --preview
// It fires 60 allocations for 60 different people at once and 25 at once for the SAME person, then checks the contract never holds more active seats than its capacity and the repeated person got one seat.
const must = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
if (!process.argv.includes("--preview")) { console.error("Refusing to run without --preview. Use a Preview database only."); process.exit(2); }
const url = must("PROOF_SUPABASE_URL"), key = must("PROOF_SERVICE_KEY"), partner = must("PROOF_PARTNER_ID"), contract = must("PROOF_CONTRACT_ID");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const status = await db.rpc("qb_partner_licence_status", { p_partner: partner });
  if (status.error) throw new Error(`Cannot read the contract: ${status.error.message}`);
  const c = (status.data as any[]).find((r) => r.contract_id === contract);
  if (!c) throw new Error("That contract does not belong to that partner.");
  if (!String(c.package).toLowerCase().startsWith("proof-")) throw new Error('Safety stop: the contract package code must start with "proof-".');
  if (!c.active_now) throw new Error("The contract is not active right now.");
  const capacity = c.max_seats as number, before = c.allocated as number, free = capacity - before;
  console.log(`Contract capacity ${capacity}, already used ${before}, free ${free}`);

  const run = `p${Date.now()}`;
  const many = await Promise.all(Array.from({ length: 60 }, (_, i) => db.rpc("qb_partner_seat_allocate", { p_partner: partner, p_contract: contract, p_external_ref: `${run}-many-${i}`, p_user: null, p_kind: "learner" })));
  const ok = many.filter((r) => !r.error).length, full = many.filter((r) => r.error && /QB_PARTNER_SEAT_CAPACITY/.test(r.error.message)).length, other = many.filter((r) => r.error && !/QB_PARTNER_SEAT_CAPACITY/.test(r.error.message));
  console.log(`60 different people at once: ${ok} seated, ${full} refused as full, ${other.length} other errors`);

  const same = await Promise.all(Array.from({ length: 25 }, () => db.rpc("qb_partner_seat_allocate", { p_partner: partner, p_contract: contract, p_external_ref: `${run}-same`, p_user: null, p_kind: "learner" })));
  const fresh = same.filter((r) => !r.error && r.data?.duplicate === false).length, dup = same.filter((r) => !r.error && r.data?.duplicate === true).length;
  console.log(`25 calls for the same person: ${fresh} new seat, ${dup} returned the same seat, ${same.filter((r) => r.error).length} errors`);

  const after = ((await db.rpc("qb_partner_licence_status", { p_partner: partner })).data as any[]).find((r) => r.contract_id === contract);
  const problems: string[] = [];
  if (after.allocated > capacity) problems.push(`OVERSOLD: ${after.allocated} active seats for capacity ${capacity}`);
  if (ok > free) problems.push(`More seats granted (${ok}) than were free (${free})`);
  if (other.length) problems.push(`Unexpected errors: ${other.map((r) => r.error!.message).slice(0, 3).join("; ")}`);
  if (fresh > 1) problems.push(`The same person got ${fresh} seats`);
  console.log(`Active seats now ${after.allocated} of ${capacity}`);
  console.log(problems.length ? `FAILED\n- ${problems.join("\n- ")}` : "PASSED: capacity held under parallel load and repeated calls were idempotent.");
  console.log(`Clean up the test seats by revoking references starting with "${run}", or cancel the proof contract.`);
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(String(e.message ?? e)); process.exit(2); });
