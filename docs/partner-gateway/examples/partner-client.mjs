// Example partner integration (Node 18+). Set QUIZBOX_PARTNER_KEY (qbpk_...) and QUIZBOX_BASE (default https://www.quizbox.io).
const BASE = process.env.QUIZBOX_BASE ?? "https://www.quizbox.io";
const KEY = process.env.QUIZBOX_PARTNER_KEY;

async function call(method, path, body, attempt = 1) {
  const res = await fetch(`${BASE}/api/partner/v1${path}`, { method, headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {                      // retry with backoff; POST /seats is idempotent so this is safe
    await new Promise((r) => setTimeout(r, Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250));
    return call(method, path, body, attempt + 1);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json;
}

const { data: contracts } = await call("GET", "/licences");
const active = contracts.find((c) => c.active_now && c.remaining > 0);
if (!active) throw new Error("No active contract with free seats.");
console.log("Seating on", active.package, "- remaining", active.remaining);
console.log(await call("POST", "/seats", { contract_id: active.contract_id, external_ref: "student-2041" }));   // repeat it: same seat, duplicate: true
console.log(await call("GET", "/members/student-2041"));
// console.log(await call("DELETE", "/seats/student-2041?reason=left%20school"));
