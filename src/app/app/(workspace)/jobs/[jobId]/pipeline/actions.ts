"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate } from "@/lib/dates";
import { deliverDueForApplication } from "@/lib/messages/deliver";
import { createClient } from "@/lib/supabase/server";

export type MoveResult =
  | { ok: true; notice: string | null }
  | { ok: false; error: string };

const moveInput = z.object({
  applicationId: z.uuid(),
  fromStageId: z.uuid(),
  toStageId: z.uuid(),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional(),
});

const EMAIL_LABEL: Record<string, string> = {
  interview_invite: "Interview invitation",
  offer_pending: "Offer update",
  rejected: "Rejection",
};

/**
 * Moves an application to another stage (HR-06). Only HR can move (RLS
 * enforces it too). The database trigger records history, cancels emails
 * still waiting from the previous stage (the undo window) and queues the new
 * stage's automations; due ones are sent after the response.
 */
export async function moveApplication(input: z.input<typeof moveInput>): Promise<MoveResult> {
  const m = await requireMembership();
  if (!isHr(m)) return { ok: false, error: "Only recruiters and admins can move candidates." };

  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid move." };
  const { applicationId, fromStageId, toStageId, reason } = parsed.data;
  if (fromStageId === toStageId) return { ok: true, notice: null };

  const supabase = await createClient();
  const { data: stage, error: stageError } = await supabase
    .from("pipeline_stages")
    .select("kind, name")
    .eq("id", toStageId)
    .eq("org_id", m.orgId)
    .maybeSingle();
  if (stageError) throw stageError;
  if (!stage) return { ok: false, error: "That stage no longer exists. Refresh the page." };

  // Guard on the current stage so two people moving the same candidate at
  // once cannot silently overwrite each other.
  const { data: moved, error } = await supabase
    .from("applications")
    .update({ stage_id: toStageId, rejection_reason: stage.kind === "rejected" ? reason || null : null })
    .eq("id", applicationId)
    .eq("org_id", m.orgId)
    .eq("stage_id", fromStageId)
    .select("id");
  if (error) {
    console.error("[pipeline] move failed:", error);
    return { ok: false, error: "The candidate could not be moved. Please try again." };
  }
  if (!moved?.length) {
    refresh();
    return { ok: false, error: "Someone else moved this candidate first. The board has been updated." };
  }

  // What the move queued, so HR knows what the candidate will receive.
  const { data: queued } = await supabase
    .from("messages")
    .select("template_key, send_after")
    .eq("application_id", applicationId)
    .eq("status", "queued")
    .not("automation_rule_id", "is", null);

  after(async () => {
    try {
      await deliverDueForApplication(applicationId);
    } catch (e) {
      console.error("[pipeline] sending stage emails failed:", e);
    }
  });
  refresh();

  const notice = (queued ?? [])
    .map((q) => {
      const label = EMAIL_LABEL[q.template_key ?? ""] ?? "An email";
      return Date.parse(q.send_after) > Date.now() + 60_000
        ? `${label} email will be sent on ${formatDate(q.send_after, m.orgTimezone)}. Move the candidate back before then to cancel it.`
        : `${label} email is being sent to the candidate.`;
    })
    .join(" ");
  return { ok: true, notice: notice || null };
}
