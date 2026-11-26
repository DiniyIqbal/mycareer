"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { endOfDayInZone } from "@/lib/dates";
import { careersTag } from "@/lib/jobs/queries";
import { JOB_STATUSES, jobInput, publishProblems, STATUS_TRANSITIONS, type JobStatus } from "@/lib/jobs/schema";
import { createClient } from "@/lib/supabase/server";

export type SaveJobState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  message?: string;
};

export type StatusState = { error?: string; problems?: string[]; message?: string };

const uuid = z.uuid();

async function requireHr() {
  const m = await requireMembership();
  if (!isHr(m)) throw new Error("Only Org Admins and Recruiters can manage jobs.");
  return m;
}

/** Find or create a department by name; returns its id. */
async function resolveDepartment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  name: string | undefined,
) {
  if (!name) return null;
  const { data, error } = await supabase
    .from("departments")
    .upsert({ org_id: orgId, name }, { onConflict: "org_id,name" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function saveJob(_: SaveJobState, formData: FormData): Promise<SaveJobState> {
  const m = await requireHr();
  const parsed = jobInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }
  const input = parsed.data;
  const jobIdRaw = formData.get("job_id");
  const jobId = typeof jobIdRaw === "string" && jobIdRaw ? uuid.parse(jobIdRaw) : null;

  const supabase = await createClient();
  const departmentId = await resolveDepartment(supabase, m.orgId, input.department);

  const row = {
    title: input.title,
    department_id: departmentId,
    description: input.description,
    location: input.location || [input.address_locality, input.address_region].filter(Boolean).join(", "),
    address_locality: input.address_locality ?? null,
    address_region: input.address_region ?? null,
    address_country: input.address_country,
    workplace_type: input.workplace_type,
    employment_type: input.employment_type,
    salary_min: input.salary_min ?? null,
    salary_max: input.salary_max ?? null,
    salary_currency: input.salary_currency,
    salary_period: input.salary_period ?? null,
    closes_at: input.closes_on ? endOfDayInZone(input.closes_on, m.orgTimezone) : null,
    screening_questions: input.screening_questions,
  };

  if (!jobId) {
    const { data, error } = await supabase
      .from("jobs")
      .insert({ ...row, org_id: m.orgId, created_by: m.userId })
      .select("id")
      .single();
    if (error) return { error: "Could not save the job. Please try again." };
    await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "job.create", entity: "job", entityId: data.id });
    redirect(`/app/jobs/${data.id}?created=1`);
  }

  const { data: current } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .eq("org_id", m.orgId)
    .maybeSingle();
  if (!current) return { error: "Job not found." };

  // A live job must stay publishable, or the careers page would show a
  // posting Google rejects. Check before saving, not after.
  if (current.status === "published") {
    const problems = publishProblems(row);
    if (problems.length) {
      return { error: `Not saved — this job is live and the change would break it. ${problems.join(" ")}` };
    }
  }

  const { error } = await supabase.from("jobs").update(row).eq("id", jobId).eq("org_id", m.orgId);
  if (error) return { error: "Could not save the job. Please try again." };
  if (current.status === "published") updateTag(careersTag(m.orgId));
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "job.update", entity: "job", entityId: jobId });
  refresh();
  return { message: "Saved." };
}

export async function changeJobStatus(_: StatusState, formData: FormData): Promise<StatusState> {
  const m = await requireHr();
  const jobId = uuid.safeParse(formData.get("job_id"));
  const to = z.enum(JOB_STATUSES).safeParse(formData.get("to"));
  if (!jobId.success || !to.success) return { error: "Invalid request." };

  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, status, title, description, workplace_type, address_locality, closes_at, published_at")
    .eq("id", jobId.data)
    .eq("org_id", m.orgId)
    .maybeSingle();
  if (error || !job) return { error: "Job not found." };

  const from = job.status as JobStatus;
  if (!STATUS_TRANSITIONS[from].some((t) => t.to === to.data)) {
    return { error: `A ${from} job cannot be moved to ${to.data}.` };
  }

  if (to.data === "published") {
    const problems = publishProblems(job);
    if (problems.length) return { error: "This job is not ready to publish yet.", problems };
  }

  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      status: to.data,
      // Keep the original posting date when reopening (Google's datePosted).
      ...(to.data === "published" && !job.published_at ? { published_at: new Date().toISOString() } : {}),
    })
    .eq("id", job.id)
    .eq("status", from); // guard against a concurrent change
  if (updateError) return { error: "Could not update the job. Please try again." };

  // Published, closed and archived all change what the careers page shows.
  if (from === "published" || to.data === "published") updateTag(careersTag(m.orgId));

  await writeAudit({
    orgId: m.orgId,
    actorId: m.userId,
    action: `job.${to.data === "published" ? (from === "closed" ? "reopen" : "publish") : to.data === "draft" ? "restore" : to.data === "closed" ? "close" : "archive"}`,
    entity: "job",
    entityId: job.id,
    metadata: { from, to: to.data },
  });

  const messages: Record<JobStatus, string> = {
    published: "Published. The job is now on your careers page.",
    closed: "Closed. The job is off the careers page and new applications are blocked.",
    archived: "Archived.",
    draft: "Restored as a draft.",
  };
  refresh();
  return { message: messages[to.data] };
}
