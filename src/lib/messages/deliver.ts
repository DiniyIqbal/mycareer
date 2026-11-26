import "server-only";
import { renderTemplate, sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextSendTime } from "./quiet-hours";

const MAX_ATTEMPTS = 5;
const CLOCK_SKEW_MS = 60_000;

type Loaded = {
  id: string;
  org_id: string;
  status: string;
  attempts: number;
  to_address: string;
  template_key: string | null;
  subject: string | null;
  body: string | null;
  respect_quiet_hours: boolean;
  send_after: string;
  applications: {
    candidates: { full_name: string; locale: string; timezone: string | null } | null;
    jobs: { title: string; organisations: { name: string; timezone: string } | null } | null;
  } | null;
};

export type DeliveryOutcome = "sent" | "deferred" | "retry" | "failed" | "skipped";

/**
 * Sends one queued email from the `messages` table and records the outcome.
 *
 * Called straight after an application (confirmation, AP-04) or a stage move
 * (automations), and by the scheduled run for delayed ones. Messages that
 * respect quiet hours wait until 8am–9pm in the candidate's time zone (their
 * organisation's if unknown). Failures go back on the queue with a backoff,
 * up to 5 tries.
 */
export async function deliverMessage(messageId: string): Promise<DeliveryOutcome> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("messages")
    .select(
      `id, org_id, status, attempts, to_address, template_key, subject, body, respect_quiet_hours, send_after,
       applications(candidates(full_name, locale, timezone), jobs(title, organisations(name, timezone)))`,
    )
    .eq("id", messageId)
    .maybeSingle<Loaded>();
  if (error) throw error;
  if (!data || data.status !== "queued") return "skipped";
  // send_after comes from the database clock; allow for drift with this server.
  if (Date.parse(data.send_after) > Date.now() + CLOCK_SKEW_MS) return "skipped";

  if (data.respect_quiet_hours) {
    const tz = data.applications?.candidates?.timezone || data.applications?.jobs?.organisations?.timezone || "Asia/Kuala_Lumpur";
    const later = nextSendTime(new Date(), tz);
    if (later) {
      await db.from("messages").update({ send_after: later }).eq("id", data.id).eq("status", "queued");
      return "deferred";
    }
  }

  // Claim it: the status/attempts guard stops two senders sending twice.
  const attempt = data.attempts + 1;
  const { data: claimed, error: claimError } = await db
    .from("messages")
    .update({ status: "sending", attempts: attempt })
    .eq("id", data.id)
    .eq("status", "queued")
    .eq("attempts", data.attempts)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return "skipped";

  try {
    const { subject, text } = await renderMessage(db, data);
    const result = await sendEmail({ to: data.to_address, subject, text });
    await db
      .from("messages")
      .update({
        status: "sent",
        subject,
        body: text,
        sent_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId,
        last_error: null,
      })
      .eq("id", data.id);
    return "sent";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const giveUp = attempt >= MAX_ATTEMPTS;
    await db
      .from("messages")
      .update({
        status: giveUp ? "failed" : "queued",
        last_error: message.slice(0, 1000),
        // 5, 10, 20, 40 minutes
        send_after: new Date(Date.now() + 5 * 60_000 * 2 ** (attempt - 1)).toISOString(),
      })
      .eq("id", data.id);
    console.error(`[messages] send ${data.id} failed (attempt ${attempt}):`, message);
    return giveUp ? "failed" : "retry";
  }
}

/** Sends every queued message that is due now for one application. */
export async function deliverDueForApplication(applicationId: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("application_id", applicationId)
    .eq("status", "queued")
    .lte("send_after", new Date(Date.now() + CLOCK_SKEW_MS).toISOString());
  if (error) throw error;
  for (const m of data ?? []) await deliverMessage(m.id);
}

/**
 * The queue worker's batch: sends up to `limit` due messages, oldest first.
 * Run it on a schedule (see /api/cron/messages).
 */
export async function deliverDueMessages(limit = 50) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("status", "queued")
    .lte("send_after", new Date().toISOString())
    .order("send_after")
    .limit(limit);
  if (error) throw error;
  const tally: Record<DeliveryOutcome, number> = { sent: 0, deferred: 0, retry: 0, failed: 0, skipped: 0 };
  for (const m of data ?? []) {
    try {
      tally[await deliverMessage(m.id)]++;
    } catch (e) {
      tally.retry++;
      console.error(`[messages] ${m.id}:`, e);
    }
  }
  return tally;
}

async function renderMessage(db: ReturnType<typeof createAdminClient>, m: Loaded) {
  if (m.subject && m.body) return { subject: m.subject, text: m.body };
  if (!m.template_key) throw new Error("Message has neither a body nor a template");

  const locale = m.applications?.candidates?.locale ?? "en";
  const { data: templates, error } = await db
    .from("message_templates")
    .select("locale, subject, body")
    .eq("org_id", m.org_id)
    .eq("key", m.template_key)
    .eq("channel", "email")
    .in("locale", [locale, "en"]);
  if (error) throw error;
  const template = templates?.find((t) => t.locale === locale) ?? templates?.find((t) => t.locale === "en");
  if (!template) throw new Error(`No "${m.template_key}" email template for this organisation`);

  const vars = {
    candidate_name: m.applications?.candidates?.full_name,
    job_title: m.applications?.jobs?.title,
    company_name: m.applications?.jobs?.organisations?.name,
  };
  return {
    subject: renderTemplate(template.subject ?? m.template_key, vars),
    text: renderTemplate(template.body, vars),
  };
}
