// Usage:  npx tsx scripts/ops/csp-triage.ts <saved-log-file.txt>      (or pipe the text in)
import { readFileSync } from "node:fs";
import { formatCspTriage, parseCspLines, triageCsp } from "../../lib/security/csp-triage";

const file = process.argv[2];
const text = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
console.log(formatCspTriage(triageCsp(parseCspLines(text))));
