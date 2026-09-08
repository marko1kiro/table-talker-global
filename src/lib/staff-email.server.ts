// Outbound email for staff invitations and Super Admin recovery. The only
// supported transport is the Resend HTTP API, configured via RESEND_API_KEY +
// STAFF_EMAIL_FROM. If either is missing the transport is UNAVAILABLE and
// every caller must fail closed: nothing sensitive is created or sent, and
// the user-facing flow reports a generic error. No secrets are ever logged.

export type EmailSendResult =
  | { ok: true }
  | { ok: false; code: "EMAIL_UNAVAILABLE" | "EMAIL_SEND_FAILED" };

export function emailTransportConfigured(): boolean {
  return (
    typeof process.env.RESEND_API_KEY === "string" &&
    process.env.RESEND_API_KEY.length > 0 &&
    typeof process.env.STAFF_EMAIL_FROM === "string" &&
    process.env.STAFF_EMAIL_FROM.length > 0
  );
}

export async function sendStaffEmail(
  to: string,
  subject: string,
  text: string,
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.STAFF_EMAIL_FROM;
  if (!emailTransportConfigured() || !apiKey || !from) {
    return { ok: false, code: "EMAIL_UNAVAILABLE" };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok) return { ok: false, code: "EMAIL_SEND_FAILED" };
    return { ok: true };
  } catch {
    return { ok: false, code: "EMAIL_SEND_FAILED" };
  }
}
