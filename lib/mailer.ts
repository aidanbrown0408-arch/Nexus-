// Sending mail.
//
// Deliberately not the user's own Gmail. Sending as them would mean
// asking for the `gmail.send` scope, and lib/google.ts excludes that on
// purpose — a token that can send mail on someone's behalf is a much
// larger thing to hold than one that can only draft. A brief arriving
// from Nexus is also more honest than one that appears to be from
// yourself.
//
// Resend is the implementation, not the interface: one function, a
// provider-shaped payload, and a null return when it isn't configured.
// Swapping providers means editing this file and nothing else.

const RESEND_URL = "https://api.resend.com/emails";
const FETCH_TIMEOUT_MS = 10000;

// "unknown" is the important one. A request that timed out or died in
// transit may still have been accepted by the provider, so a caller must
// not treat it as "didn't send" and clear its duplicate guard — that is
// how someone gets the same brief twice.
export type SendOutcome = "sent" | "failed" | "unknown";

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.BRIEF_FROM_EMAIL);
}

/**
 * Send one email.
 *
 * Distinguishes "the provider said no" from "we never heard back",
 * because those call for opposite responses: the first is safe to retry,
 * the second is not.
 */
export async function sendEmail(email: Email): Promise<SendOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BRIEF_FROM_EMAIL;
  if (!apiKey || !from) {
    console.error("Mailer: RESEND_API_KEY or BRIEF_FROM_EMAIL is not set");
    return "failed";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        // A plain-text part is what keeps this out of spam folders and
        // readable on a watch. Worth the duplication.
        text: email.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Mailer: send failed ${res.status}`, detail.slice(0, 300));
      // 5xx is the provider having a bad moment and may or may not have
      // queued the message; 4xx is a definite no.
      return res.status >= 500 ? "unknown" : "failed";
    }

    await res.json().catch(() => ({}));
    return "sent";
  } catch (err) {
    console.error(
      "Mailer: send failed",
      err instanceof Error ? err.message : String(err)
    );
    // A timeout or a dropped connection tells us nothing about whether
    // the provider accepted it.
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}
