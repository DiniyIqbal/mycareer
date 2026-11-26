"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireMembership } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";

export type PrivacyResult = { ok: true; message: string } | { ok: false; error: string };
const NOT_ADMIN: PrivacyResult = { ok: false, error: "Only Org Admins can change privacy settings." };

/** How long candidate data is kept after their last role closes. */
export async function saveRetention(input: { months: number }): Promise<PrivacyResult> {
  const m = await requireMembership();
  if (m.role !== "admin") return NOT_ADMIN;
  const months = z.number().int().min(1, "At least 1 month").max(120, "At most 120 months (10 years)").safeParse(input.months);
  if (!months.success) return { ok: false, error: months.error.issues[0]?.message ?? "Invalid period." };

  const supabase = await createClient();
  const { error } = await supabase.from("organisations").update({ retention_months: months.data }).eq("id", m.orgId);
  if (error) {
    console.error("[privacy] retention save failed:", error);
    return { ok: false, error: "Could not save. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "retention.update", entity: "organisation",
    entityId: m.orgId, metadata: { months: months.data } });
  refresh();
  return { ok: true, message: `Saved. Candidate data is now deleted ${months.data} months after their last role closes. Make sure your privacy notice says the same.` };
}

/**
 * Publishes a new version of the privacy notice. Old versions are kept, so
 * each consent record still points at the exact text the candidate agreed to.
 */
export async function publishNotice(input: { locale: string; body: string }): Promise<PrivacyResult> {
  const m = await requireMembership();
  if (m.role !== "admin") return NOT_ADMIN;
  const parsed = z.object({
    locale: z.enum(["en", "ms"]),
    body: z.string().trim().min(100, "The notice is too short to be meaningful (at least 100 characters)").max(10000),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid notice." };
  const { locale, body } = parsed.data;

  const supabase = await createClient();
  const { data: latest } = await supabase.from("consent_notices").select("version, body")
    .eq("org_id", m.orgId).eq("purpose", "application").eq("locale", locale)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (latest?.body === body) return { ok: false, error: "No changes to publish." };
  const version = (latest?.version ?? 0) + 1;

  const { error } = await supabase.from("consent_notices")
    .insert({ org_id: m.orgId, purpose: "application", locale, version, body });
  if (error) {
    console.error("[privacy] notice publish failed:", error);
    return { ok: false, error: error.code === "23505" ? "Someone else just published a version. Refresh and try again." : "Could not publish. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "notice.publish", entity: "consent_notice",
    metadata: { locale, version } });
  updateTag(`consent:${m.orgId}`); // careers pages and the apply form show it at once
  refresh();
  return { ok: true, message: `Version ${version} published. New applicants agree to this text; earlier consents keep the version they saw.` };
}
