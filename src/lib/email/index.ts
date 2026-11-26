import "server-only";
import { gmailProvider } from "./gmail";
import { resendProvider } from "./resend";
import type { EmailMessage, EmailProvider, SendResult } from "./types";

export type { EmailMessage, SendResult } from "./types";
export { renderTemplate } from "./render";

/**
 * Single entry point for outbound email. Callers never know which provider
 * is used: switch with EMAIL_PROVIDER=gmail (testing) | resend (production).
 */
export function getEmailProvider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? "gmail";
  switch (name) {
    case "gmail":
      return gmailProvider();
    case "resend":
      return resendProvider();
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${name}". Use "gmail" or "resend".`);
  }
}

export function sendEmail(message: EmailMessage): Promise<SendResult> {
  return getEmailProvider().send(message);
}
