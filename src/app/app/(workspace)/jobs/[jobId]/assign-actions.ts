"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { memberName } from "@/lib/notes/mentions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AssignResult = { ok: true; message: string } | { ok: false; error: string };
const input = z.object({ jobId: z.uuid(), userId: z.uuid() });

/**
 * Gives a hiring manager access to a job and its candidates (PRD §3). They
 * get an in-app notification and an email with a link to the pipeline.
 */
export async function assignHiringManager(raw: { jobId: string; userId: string }): Promise<AssignResult> {
  const m = await requireMembership();
  if (!isHr(m)) return { ok: false, error: "Only recruiters and admins can assign hiring managers." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { jobId, userId } = parsed.data;

  const supabase = await createClient();
  const [{ data: job }, { data: member }, { data: me }] = await Promise.all([
    supabase.from("jobs").select("id, title").eq("id", jobId).eq("org_id", m.orgId).maybeSingle(),
    supabase.from("members").select("user_id, role, full_name, email").eq("org_id", m.orgId).eq("user_id", userId).maybeSingle(),
    supabase.from("members").select("full_name, email").eq("org_id", m.orgId).eq("user_id", m.userId).maybeSingle(),
  ]);
  if (!job) return { ok: false, error: "This job no longer exists." };
  if (!member || member.role !== "hiring_manager") {
    return { ok: false, error: "Only hiring managers need to be assigned. Recruiters and admins already see every job." };
  }

  const { error } = await supabase.from("job_assignments").insert({ org_id: m.orgId, job_id: jobId, user_id: userId });
  if (error?.code === "23505") return { ok: true, message: `${memberName(member)} is already assigned.` };
  if (error) {
    console.error("[assign] failed:", error);
    return { ok: false, error: "Could not assign. Please try again." };
  }

  const by = me ? memberName(me) : "A colleague";
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "job.assign", entity: "job", entityId: jobId,
    metadata: { user_id: userId, email: member.email } });
  const { error: notifyError } = await createAdminClient().from("notifications").insert({
    org_id: m.orgId, user_id: userId, kind: "job_assigned",
    payload: { job_id: jobId, job_title: job.title, author_name: by },
  });
  if (notifyError) console.error("[assign] notification failed:", notifyError);
  try {
    await sendEmail({
      to: member.email,
      subject: `You have been added to the hiring team for ${job.title}`,
      text: `Hi ${memberName(member)},\n\n${by} added you to the hiring team for ${job.title} at ${m.orgName}. You can now see its candidates and add notes:\n\n${publicEnv.siteUrl()}/app/jobs/${jobId}/pipeline\n`,
    });
  } catch (e) {
    console.error("[assign] email failed:", e);
  }

  refresh();
  return { ok: true, message: `${memberName(member)} can now see this job's candidates.` };
}

export async function unassignHiringManager(raw: { jobId: string; userId: string }): Promise<AssignResult> {
  const m = await requireMembership();
  if (!isHr(m)) return { ok: false, error: "Only recruiters and admins can change the hiring team." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("job_assignments").delete()
    .eq("org_id", m.orgId).eq("job_id", parsed.data.jobId).eq("user_id", parsed.data.userId).select("user_id");
  if (error || !data?.length) return { ok: false, error: "Could not remove. Refresh and try again." };
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "job.unassign", entity: "job", entityId: parsed.data.jobId,
    metadata: { user_id: parsed.data.userId } });
  refresh();
  return { ok: true, message: "Removed from the hiring team." };
}
