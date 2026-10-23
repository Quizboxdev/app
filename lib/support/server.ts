import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/send";
import { SITE_URL } from "@/lib/site";
import { checkFile, displayName, FILE_MESSAGES, MAX_FILES_PER_UPLOAD, type FileCheck } from "./files";

// Server helpers for support requests: storing attachments and sending the emails. Nothing here trusts the browser: files are checked by content, stored under random names in a private bucket
// and recorded through the database (which enforces the limit of 10 per request); emails never carry a signed-in person's private message, only a note that there is a reply.
export const BUCKET = "support-files";
export type SupportRequestRow = { id: string; reference: string; subject: string; category: string; requester_name: string; requester_email: string; requester_user_id: string | null; status: string };

export type Prepared = { name: string; bytes: Uint8Array; check: Extract<FileCheck, { ok: true }> };
// Check every file before anything is created or stored, so a bad file never leaves half a request behind.
export async function prepareFiles(files: File[]): Promise<{ ok: true; files: Prepared[] } | { ok: false; error: string }> {
  if (files.length > MAX_FILES_PER_UPLOAD) return { ok: false, error: `Attach at most ${MAX_FILES_PER_UPLOAD} files at a time.` };
  const out: Prepared[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer()), check = checkFile(bytes);
    if (!check.ok) return { ok: false, error: FILE_MESSAGES[check.code] };
    out.push({ name: displayName(f.name, check.ext), bytes, check });
  }
  return { ok: true, files: out };
}

export async function storeFiles(admin: SupabaseClient, requestId: string, messageId: string | null, files: Prepared[], kind: "requester" | "staff"): Promise<{ stored: number; error?: string }> {
  let stored = 0;
  for (const f of files) {
    const path = `${requestId}/${randomUUID()}.${f.check.ext}`;
    const up = await admin.storage.from(BUCKET).upload(path, f.bytes, { contentType: f.check.mime, upsert: false });
    if (up.error) return { stored, error: "We could not save a file. Please try again." };
    const rec = await admin.rpc("qb_support_file_add", { p_request: requestId, p_message: messageId, p_path: path, p_name: f.name, p_mime: f.check.mime, p_size: f.bytes.length, p_kind: kind });
    if (rec.error) { await admin.storage.from(BUCKET).remove([path]); return { stored, error: /QB_SUPPORT_TOO_MANY_FILES/.test(rec.error.message) ? "A request can have at most 10 files." : "We could not save a file. Please try again." }; }
    stored += 1;
  }
  return { stored };
}

// The support inbox address comes from Admin, Policies, Company details (support_email). If it is empty, staff are not emailed; the request is still in Admin, Tickets.
export async function supportAddress(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from("company_details").select("value").eq("key", "support_email").maybeSingle();
  return String((data as { value?: string } | null)?.value ?? "").trim();
}

const link = (path: string) => `${new URL(SITE_URL).origin}${path}`;

export async function emailStaffNew(admin: SupabaseClient, r: SupportRequestRow, replied = false): Promise<void> {
  const to = await supportAddress(admin); if (!to) return;
  await sendEmail(to, `${replied ? "New reply on" : "New support request"} ${r.reference}: ${r.subject}`.slice(0, 200),
    `${replied ? "The person replied to" : "A new request was opened:"} ${r.reference}\nSubject: ${r.subject}\nCategory: ${r.category}\nFrom: ${r.requester_name} <${r.requester_email}>\n\nOpen it: ${link("/admin/tickets")}\n`);
}

export async function emailVisitorReceived(r: SupportRequestRow): Promise<void> {
  await sendEmail(r.requester_email, `We received your message (${r.reference})`,
    `Hello ${r.requester_name},\n\nThank you for contacting QuizBox. We received your message and will reply by email, usually within 3 working days.\n\nYour reference: ${r.reference}\nSubject: ${r.subject}\n\nPlease keep this reference if you write to us again.\n\nQuizBox Solutions, Ghana\n`);
}

// A signed-in person is told there is a reply and asked to open QuizBox (the message stays inside the app). A visitor has no account, so the reply itself is emailed.
export async function emailRequesterReply(r: SupportRequestRow, replyText: string): Promise<void> {
  if (r.requester_user_id) {
    await sendEmail(r.requester_email, `A reply to your support request ${r.reference}`, `Hello ${r.requester_name},\n\nQuizBox support has replied to ${r.reference} (${r.subject}).\n\nSign in to read it: ${link(`/support/${r.id}`)}\n\nQuizBox Solutions, Ghana\n`);
  } else {
    await sendEmail(r.requester_email, `Re: ${r.subject} (${r.reference})`, `Hello ${r.requester_name},\n\n${replyText}\n\nTo continue, write to us again at ${link("/contact")} and quote your reference ${r.reference}.\n\nQuizBox Solutions, Ghana\n`);
  }
}
