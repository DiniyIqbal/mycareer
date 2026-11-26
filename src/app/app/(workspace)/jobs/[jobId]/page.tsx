import Link from "next/link";
import { notFound } from "next/navigation";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { dateInZone } from "@/lib/dates";
import { publicEnv } from "@/lib/env";
import type { JobStatus, ScreeningQuestion } from "@/lib/jobs/schema";
import { createClient } from "@/lib/supabase/server";
import { JobForm, type JobFormValues } from "../job-form";
import { StatusPanel } from "../status-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobPage(props: PageProps<"/app/jobs/[jobId]">) {
  const { jobId } = await props.params;
  const { created } = await props.searchParams;
  if (!UUID.test(jobId)) notFound();

  const m = await requireMembership();
  const supabase = await createClient();
  const [{ data: job, error }, { data: departments }] = await Promise.all([
    supabase.from("jobs").select("*, departments(name)").eq("id", jobId).eq("org_id", m.orgId).maybeSingle(),
    supabase.from("departments").select("name").eq("org_id", m.orgId).order("name"),
  ]);
  if (error) throw error;
  if (!job) notFound(); // also covers jobs a hiring manager is not assigned to (RLS)

  const canManage = isHr(m);
  const str = (v: unknown) => (v == null ? "" : String(v));
  const initial: JobFormValues = {
    id: job.id,
    title: job.title,
    department: (job.departments as { name: string } | null)?.name ?? "",
    description: job.description,
    location: job.location,
    address_locality: str(job.address_locality),
    address_region: str(job.address_region),
    address_country: job.address_country,
    workplace_type: job.workplace_type,
    employment_type: job.employment_type,
    salary_min: str(job.salary_min),
    salary_max: str(job.salary_max),
    salary_currency: job.salary_currency,
    salary_period: str(job.salary_period),
    closes_on: job.closes_at ? dateInZone(job.closes_at, m.orgTimezone) : "",
    screening_questions: (job.screening_questions ?? []) as ScreeningQuestion[],
  };

  return (
    <main className="max-w-3xl space-y-6">
      <div>
        <Link href="/app/jobs" className="text-sm text-zinc-500 hover:underline">← Jobs</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{job.title}</h1>
        {created && (
          <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-500">
            Draft saved. Publish it when you are ready for applicants.
          </p>
        )}
      </div>
      <StatusPanel
        jobId={job.id}
        status={job.status as JobStatus}
        canManage={canManage}
        publicUrl={`${publicEnv.siteUrl()}/careers/${m.orgSlug}/jobs/${job.id}`}
      />
      {/* Archived jobs are read-only until restored. */}
      <JobForm
        initial={initial}
        departments={(departments ?? []).map((d) => d.name)}
        readOnly={!canManage || job.status === "archived"}
      />
    </main>
  );
}
