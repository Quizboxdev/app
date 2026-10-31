// Sends one signed event (Node 18+). Set QUIZBOX_PARTNER_ID, QUIZBOX_EVENT_SECRET (whsec_...), QUIZBOX_BASE (default https://www.quizbox.io).
// Usage: node send-event.mjs revoke student-2041
import { createHmac } from "node:crypto";
const BASE = process.env.QUIZBOX_BASE ?? "https://www.quizbox.io";
const [, , action = "revoke", ref = "student-2041"] = process.argv;
const body = JSON.stringify({ id: `evt_${action}_${ref}_${new Date().toISOString().slice(0, 10)}`, type: action === "revoke" ? "partner.seat.revoked" : "partner.member.updated", data: action === "revoke" ? { external_ref: ref } : { external_ref: ref, active: false } });
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac("sha256", process.env.QUIZBOX_EVENT_SECRET).update(`${t}.${body}`).digest("hex");   // sign the exact bytes you send
const res = await fetch(`${BASE}/api/partner/v1/events`, { method: "POST", body, headers: { "content-type": "application/json", "x-quizbox-partner": process.env.QUIZBOX_PARTNER_ID, "x-quizbox-signature": `t=${t},v1=${v1}` } });
console.log(res.status, await res.json());
