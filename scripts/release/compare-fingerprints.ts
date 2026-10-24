// Usage:
//   npx tsx scripts/release/compare-fingerprints.ts <production-results.txt> <preview-results.txt> [--record "note"]
// Each file holds the result tables (part A and part B) copied from the Supabase SQL editor for that project.
// --record adds a dated line to docs/release/FINGERPRINT_HISTORY.md.
import { appendFileSync, readFileSync } from "node:fs";
import { compareFingerprints, formatComparison, historyLine, parseFingerprint } from "../../lib/release/fingerprint";

const [prodFile, prevFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!prodFile || !prevFile) {
  console.error("Give the Production results file and the Preview results file.");
  process.exit(2);
}
const c = compareFingerprints(parseFingerprint(readFileSync(prodFile, "utf8")), parseFingerprint(readFileSync(prevFile, "utf8")));
if (c.versions === 0) {
  console.error("No fingerprint rows found. Paste the result tables (they start with | version | checks | found | status | missing |).");
  process.exit(2);
}
console.log(formatComparison(c));
const rec = process.argv.indexOf("--record");
if (rec >= 0) {
  const note = process.argv[rec + 1] && !process.argv[rec + 1].startsWith("--") ? process.argv[rec + 1] : "";
  const line = historyLine(c, new Date().toISOString().slice(0, 10), note);
  appendFileSync("docs/release/FINGERPRINT_HISTORY.md", line + "\n");
  console.log("\nRecorded in docs/release/FINGERPRINT_HISTORY.md:\n" + line);
}
process.exit(c.identical ? 0 : 1);
