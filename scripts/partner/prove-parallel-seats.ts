import { createClient } from "@supabase/supabase-js";

// Proves that seat allocation is safe under real parallel load. Run it ONLY against Preview, with a test partner and a test contract whose package code starts with "proof-".
//   $env:PROOF_SUPABASE_URL = "https://<preview-ref>.supabase.co"; $env:PROOF_SERVICE_KEY = "<preview service role key>"
//   $env:PROOF_PARTNER_ID = "<partner uuid>"; $env:PROOF_CONTRACT_ID = "<contract uuid>"
//   npx tsx scripts/partner/prove-parallel-seats.ts --preview
// Test A (while seats are free): 25 simultaneous allocations for the SAME person must create exactly one seat and return it 24 times, with no errors.
// Test B: 60 simultaneous allocations for 60 different people must fill exactly the remaining free seats, refuse the rest as full, and never pass capacity.
// The script removes its own test seats afterwards, and any left by an earlier run, so the proof contract can be reused.
const must = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
if (!process.argv.includes("--preview")) { console.error("Refusing to run without --preview. Use a Preview database only."); process.exit(2); }
const url = must("PROOF_SUPABASE_URL"), key = must("PROOF_SERVICE_KEY"), partner = must("PROOF_PARTNER_ID"), contract = must("PROOF_CONTRACT_ID");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const OURS = /^p\d{10,}-(many-\d+|same)$/;

const contractRow = async () => {
  const status = await db.rpc("qb_partner_licence_status", { p_partner: partner });
  if (status.error) throw new Error(`Cannot read the contract: ${status.error.message}`);
  const c = (status.data as any[]).find((r) => r.contract_id === contract);
  if (!c) throw new Error("That contract does not belong to that partner.");
  return c;
};
const revokeProofSeats = async (match: (ref: string) => boolean) => {
  const list = await db.rpc("qb_partner_seat_list", { p_partner: partner, p_contract: contract, p_limit: 500 });
  if (list.error) throw new Error(`Cannot list seats: ${list.error.message}`);
  const refs = (list.data as any[]).filter((s) => s.status === "active" && match(String(s.external_ref))).map((s) => String(s.external_ref));
  for (const ref of refs) { const r = await db.rpc("qb_partner_seat_revoke", { p_partner: partner, p_external_ref: ref, p_reason: "parallel-seat proof cleanup" }); if (r.error) throw new Error(`Cleanup failed for ${ref}: ${r.error.message}`); }
  return refs.length;
};

async function main() {
  let c = await contractRow();
  if (!String(c.package).toLowerCase().startsWith("proof-")) throw new Error('Safety stop: the contract package code must start with "proof-".');
  if (!c.active_now) throw new Error("The contract is not active right now.");
  const leftovers = await revokeProofSeats((ref) => OURS.test(ref));
  if (leftovers) { console.log(`Removed ${leftovers} test seats left by an earlier run.`); c = await contractRow(); }
  const capacity = c.max_seats as number, before = c.allocated as number, free = capacity - before;
  console.log(`Contract capacity ${capacity}, already used ${before}, free ${free}`);
  if (free < 2) throw new Error("Need at least 2 free seats for a meaningful proof. Cancel and recreate the proof contract, or amend its seats.");

  const run = `p${Date.now()}`;
  const problems: string[] = [];

  // Test A: the same person, many times at once, while there is room.
  const same = await Promise.all(Array.from({ length: 25 }, () => db.rpc("qb_partner_seat_allocate", { p_partner: partner, p_contract: contract, p_external_ref: `${run}-same`, p_user: null, p_kind: "learner" })));
  const fresh = same.filter((r) => !r.error && r.data?.duplicate === false).length, dup = same.filter((r) => !r.error && r.data?.duplicate === true).length, sameErr = same.filter((r) => r.error);
  console.log(`A. 25 calls for the same person: ${fresh} new seat, ${dup} returned the same seat, ${sameErr.length} errors`);
  if (fresh !== 1 || dup !== 24 || sameErr.length) problems.push(`Same person: expected 1 new + 24 repeats + 0 errors, got ${fresh} + ${dup} + ${sameErr.length}${sameErr[0] ? ` (${sameErr[0].error!.message})` : ""}`);

  // Test B: 60 different people at once; only the free seats may be granted.
  const freeNow = free - Math.min(fresh, 1);
  const many = await Promise.all(Array.from({ length: 60 }, (_, i) => db.rpc("qb_partner_seat_allocate", { p_partner: partner, p_contract: contract, p_external_ref: `${run}-many-${i}`, p_user: null, p_kind: "learner" })));
  const ok = many.filter((r) => !r.error).length, full = many.filter((r) => r.error && /QB_PARTNER_SEAT_CAPACITY/.test(r.error.message)).length, other = many.filter((r) => r.error && !/QB_PARTNER_SEAT_CAPACITY/.test(r.error.message));
  console.log(`B. 60 different people at once: ${ok} seated, ${full} refused as full, ${other.length} other errors (free seats were ${freeNow})`);
  if (freeNow >= 60) problems.push("Not a real overflow test: there were at least 60 free seats. Use a smaller proof contract.");
  if (ok !== freeNow) problems.push(`Expected exactly ${freeNow} people seated, got ${ok}`);
  if (full !== 60 - freeNow) problems.push(`Expected ${60 - freeNow} refused as full, got ${full}`);
  if (other.length) problems.push(`Unexpected errors: ${other.map((r) => r.error!.message).slice(0, 3).join("; ")}`);

  const after = await contractRow();
  console.log(`Active seats now ${after.allocated} of ${capacity}`);
  if (after.allocated > capacity) problems.push(`OVERSOLD: ${after.allocated} active seats for capacity ${capacity}`);
  if (after.allocated !== capacity && ok === freeNow) problems.push(`Seat count ${after.allocated} does not match capacity ${capacity} after filling`);

  const removed = await revokeProofSeats((ref) => ref.startsWith(`${run}-`));
  const finalRow = await contractRow();
  console.log(`Cleanup: revoked ${removed} test seats; active seats back to ${finalRow.allocated} (before the proof: ${before}).`);
  if (finalRow.allocated !== before) problems.push(`Cleanup left ${finalRow.allocated} active seats, expected ${before}`);

  console.log(problems.length ? `FAILED\n- ${problems.join("\n- ")}` : "PASSED: capacity held under parallel load, and 25 simultaneous calls for one person created exactly one seat.");
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(String(e.message ?? e)); process.exit(2); });
