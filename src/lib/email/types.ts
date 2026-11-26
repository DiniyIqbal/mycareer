export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type SendResult = { providerMessageId: string };

export interface EmailProvider {
  readonly name: "gmail" | "resend";
  send(message: EmailMessage): Promise<SendResult>;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. See .env.example.`);
  return value;
}
