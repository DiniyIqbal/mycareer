// Checks the Gmail SMTP settings in .env.local by sending one email.
// Usage: npm run email:test -- you@example.com
import nodemailer from "nodemailer";

const to = process.argv[2];
const { GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_FROM } = process.env;

if (!to) {
  console.error("Usage: npm run email:test -- recipient@example.com");
  process.exit(1);
}
if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local first.");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
});

try {
  await transporter.verify();
  const info = await transporter.sendMail({
    from: EMAIL_FROM || GMAIL_USER,
    to,
    subject: "MyCareer test email",
    text: "If you can read this, Gmail SMTP is configured correctly.",
  });
  console.log(`Sent to ${to} (message id ${info.messageId})`);
} catch (err) {
  console.error(`Failed: ${err.message}`);
  if (/Username and Password not accepted|535/.test(err.message)) {
    console.error("Use an App Password (not your normal password); it needs 2-Step Verification on.");
  }
  process.exit(1);
}
