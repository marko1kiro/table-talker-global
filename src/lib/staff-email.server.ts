// Outbound email for staff invitations and Super Admin recovery. The only
// supported transport is the Resend HTTP API, configured via RESEND_API_KEY +
// STAFF_EMAIL_FROM. If either is missing the transport is UNAVAILABLE and
// every caller must fail closed: nothing sensitive is created or sent, and
// the user-facing flow reports a generic error. No secrets are ever logged —
// except one-time invite/recovery tokens, which are designed to travel in the
// emailed HTTPS link (single-use, hashed-at-rest, short-lived).
import { getRequest } from "@tanstack/react-start/server";

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

/**
 * Absolute HTTPS origin used in emailed links. STAFF_EMAIL_APP_URL wins;
 * otherwise the current request's own origin is used (server fns always run
 * inside a request). Empty string means "cannot build a safe link" and
 * callers must fail closed.
 */
export function staffAppOrigin(): string {
  const configured = process.env.STAFF_EMAIL_APP_URL;
  if (typeof configured === "string" && configured.trim() !== "") {
    return configured.trim().replace(/\/+$/, "");
  }
  try {
    const url = new URL(getRequest().url);
    if (url.protocol === "https:" || process.env.NODE_ENV !== "production") {
      return url.origin;
    }
  } catch {
    // outside a request context
  }
  return "";
}

/** One-time accept link for a Super Admin invite / bootstrap activation. */
export function staffAcceptLink(staffId: string, rawToken: string): string {
  return `${staffAppOrigin()}/super-admin/accept?staff_id=${encodeURIComponent(staffId)}&token=${encodeURIComponent(rawToken)}`;
}

/** One-time recovery link for Super Admin password recovery. */
export function staffRecoveryLink(staffId: string, rawToken: string): string {
  return `${staffAppOrigin()}/super-admin/recovery?staff_id=${encodeURIComponent(staffId)}&token=${encodeURIComponent(rawToken)}`;
}

export function staffLinkEmailBody(link: string, validity: string): string {
  return [
    "Buka tautan berikut untuk melanjutkan (tautan hanya berlaku sekali):",
    "",
    link,
    "",
    `Tautan ini ${validity}. Jika Anda tidak mengharapkan email ini, abaikan.`,
  ].join("\n");
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
