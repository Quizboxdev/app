/* eslint-disable @typescript-eslint/no-require-imports -- a standalone Node helper, not part of the app */
// Serves parsed test accounts on 127.0.0.1 only, for the audit session. Stop it when the audit ends.
const http = require("http"), fs = require("fs"), path = require("path");
const accounts = JSON.parse(fs.readFileSync(path.join(process.env.QB_AUDIT_SCRATCH || path.join(require("os").tmpdir(), "qb-audit"), "creds.json"), "utf8"));
http.createServer((req, res) => {
  const m = req.url.match(/^\/acct\/([A-Z]+)\/(\d+)$/);
  const list = m ? accounts.filter((a) => a.role === m[1]) : [];
  const a = m && list[Number(m[2])];
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(a ? { email: a.email, passwords: a.passwords, count: list.length } : { error: "none" }));
}).listen(3199, "127.0.0.1", () => console.log("cred server ready"));
