import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { requireEnv, type EmailProvider } from "./types";

// For testing only. Gmail limits sending (~500 recipients/day on a personal
// account) and rewrites From to the signed-in address. Use Resend in production.
let transporter: Transporter | undefined;

export function gmailProvider(): EmailProvider {
  const user = requireEnv("GMAIL_USER");
  transporter ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: requireEnv("GMAIL_APP_PASSWORD").replace(/\s+/g, "") },
  });
  const from = process.env.EMAIL_FROM || user;

  return {
    name: "gmail",
    async send({ to, subject, text, html, replyTo }) {
      const info = await transporter!.sendMail({ from, to, subject, text, html, replyTo });
      return { providerMessageId: info.messageId };
    },
  };
}
