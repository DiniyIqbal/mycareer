"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { renderTemplate, sendEmail } from "@/lib/email";
import {
  BODY_MAX, sampleVariables, SUBJECT_MAX, SYSTEM_TEMPLATES, TEMPLATE_KEYS, unknownVariables,
} from "@/lib/messages/templates";
import { createClient } from "@/lib/supabase/server";

export type TemplateResult = { ok: true; message: string } | { ok: false; error: string };

const templateInput = z.object({
  key: z.enum(TEMPLATE_KEYS),
  locale: z.enum(["en", "ms"]),
  subject: z.string().trim().min(1, "Add a subject line").max(SUBJECT_MAX, `Keep the subject under ${SUBJECT_MAX} characters`),
  body: z.string().trim().min(1, "Write the email text").max(BODY_MAX, `Keep the email under ${BODY_MAX} characters`),
});

async function requireHr() {
  const m = await requireMembership();
  return isHr(m) ? m : null;
}

/**
 * HR-08: save a system email template. Queued emails are rendered when they
 * are sent, so the new wording also applies to ones already waiting.
 */
export async function saveTemplate(input: z.input<typeof templateInput>): Promise<TemplateResult> {
  const m = await requireHr();
  if (!m) return { ok: false, error: "Only recruiters and admins can edit email templates." };
  const parsed = templateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const { key, locale, subject, body } = parsed.data;

  const unknown = unknownVariables(`${subject}\n${body}`);
  if (unknown.length) {
    return { ok: false, error: `Unknown placeholder ${unknown.map((u) => `{{${u}}}`).join(", ")}. Use only the ones listed.` };
  }

  const supabase = await createClient();
  const name = SYSTEM_TEMPLATES.find((t) => t.key === key)!.label;
  const { error } = await supabase
    .from("message_templates")
    .upsert({ org_id: m.orgId, key, locale, channel: "email", name, subject, body }, { onConflict: "org_id,key,locale,channel" });
  if (error) {
    console.error("[templates] save failed:", error);
    return { ok: false, error: "The template could not be saved. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "template.update", entity: "message_template",
    metadata: { key, locale } });
  refresh();
  return { ok: true, message: "Saved." };
}

/** Remove a Malay version; Malay-speaking candidates then get the English one. */
export async function removeTranslation(input: { key: string }): Promise<TemplateResult> {
  const m = await requireHr();
  if (!m) return { ok: false, error: "Only recruiters and admins can edit email templates." };
  const key = z.enum(TEMPLATE_KEYS).safeParse(input.key);
  if (!key.success) return { ok: false, error: "Unknown template." };

  const supabase = await createClient();
  const { error } = await supabase.from("message_templates").delete()
    .eq("org_id", m.orgId).eq("key", key.data).eq("locale", "ms").eq("channel", "email");
  if (error) return { ok: false, error: "Could not remove the translation. Please try again." };
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "template.delete", entity: "message_template",
    metadata: { key: key.data, locale: "ms" } });
  refresh();
  return { ok: true, message: "Malay version removed." };
}

const automationInput = z.object({
  key: z.enum(TEMPLATE_KEYS),
  active: z.boolean(),
  delayHours: z.number().int().min(0, "Delay cannot be negative").max(720, "Delay can be at most 30 days (720 hours)"),
});

/** Turn a stage email on or off, and set how long after the move it goes out. */
export async function saveAutomation(input: z.input<typeof automationInput>): Promise<TemplateResult> {
  const m = await requireHr();
  if (!m) return { ok: false, error: "Only recruiters and admins can change automatic emails." };
  const parsed = automationInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid setting." };
  const { key, active, delayHours } = parsed.data;
  const stageKind = SYSTEM_TEMPLATES.find((t) => t.key === key)?.stageKind;
  if (!stageKind) return { ok: false, error: "This email cannot be turned off." };

  const supabase = await createClient();
  // Organisation-wide rule for that stage (job-specific overrides come later).
  const { data: rule } = await supabase.from("automation_rules").select("id")
    .eq("org_id", m.orgId).is("job_id", null).eq("trigger_stage_kind", stageKind).eq("action", "send_template").maybeSingle();
  const values = { active, delay_minutes: delayHours * 60, template_key: key };
  const { error } = rule
    ? await supabase.from("automation_rules").update(values).eq("id", rule.id)
    : await supabase.from("automation_rules").insert({ org_id: m.orgId, trigger_stage_kind: stageKind, action: "send_template", ...values });
  if (error) {
    console.error("[templates] automation save failed:", error);
    return { ok: false, error: "The setting could not be saved. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "automation.update", entity: "automation_rule",
    entityId: rule?.id, metadata: { key, active, delay_hours: delayHours } });
  refresh();
  return { ok: true, message: active ? "Saved. Applies to candidates moved from now on." : "Turned off for candidates moved from now on." };
}

/** Sends the current draft, filled with sample data, to the signed-in user. */
export async function sendTestEmail(input: z.input<typeof templateInput>): Promise<TemplateResult> {
  const m = await requireHr();
  if (!m) return { ok: false, error: "Only recruiters and admins can send test emails." };
  const parsed = templateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };

  const supabase = await createClient();
  const { data: me } = await supabase.from("members").select("email").eq("org_id", m.orgId).eq("user_id", m.userId).single();
  if (!me?.email) return { ok: false, error: "Your account has no email address." };

  const vars = sampleVariables(m.orgName);
  try {
    await sendEmail({
      to: me.email,
      subject: `[Test] ${renderTemplate(parsed.data.subject, vars)}`,
      text: renderTemplate(parsed.data.body, vars),
    });
  } catch (e) {
    console.error("[templates] test email failed:", e);
    return { ok: false, error: "The test email could not be sent. Check the email settings." };
  }
  return { ok: true, message: `Test sent to ${me.email}.` };
}
