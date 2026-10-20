// Sends one plain-text email through Resend (https://resend.com) when RESEND_API_KEY and EMAIL_FROM are set; otherwise it does nothing and says so.
// Server only. Never logs the address or the message. Swap the provider here and nothing else changes.
export type EmailResult = "sent" | "skipped" | "failed";

export async function sendEmail(to: string, subject: string, text: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!key || !from) return "skipped";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return "failed";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: subject.slice(0, 200), text: text.slice(0, 5000) }), signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "sent" : "failed";
  } catch { return "failed"; }
}
