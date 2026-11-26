import "server-only";
import { Resend } from "resend";
import { requireEnv, type EmailProvider } from "./types";

export function resendProvider(): EmailProvider {
  const resend = new Resend(requireEnv("RESEND_API_KEY"));
  const from = requireEnv("EMAIL_FROM");

  return {
    name: "resend",
    async send({ to, subject, text, html, replyTo }) {
      const { data, error } = await resend.emails.send({ from, to, subject, text, html, replyTo });
      if (error) throw new Error(`Resend: ${error.message}`);
      return { providerMessageId: data!.id };
    },
  };
}
