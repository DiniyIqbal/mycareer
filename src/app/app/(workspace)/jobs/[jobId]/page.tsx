import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { dateInZone } from "@/lib/dates";
import { publicEnv } from "@/lib/env";
import type { JobStatus, ScreeningQuestion } from "@/lib/jobs/schema";
import { memberName } from "@/lib/notes/mentions";
import { createClient } from "@/lib/supabase/server";
import { JobForm, type JobFormValues } from "../job-form";
import { HiringTeam } from "./hiring-team";
import { StatusPanel } from "../status-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = PageProps<"/app/jobs/[jobId]">;

export default function JobPage(props: Props) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading job…</p>}>
      <Job params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Job(props: Pick<Props, "params" | "searchParams">) {
  const { jobId } = await props.params;
  const { created } = await props.searchParams;
  if (!UUID.test(jobId)) notFound();

  const m = await requireMembership();
  const supabase = await createClient();
  const [{ data: job, error }, { data: departments }, { data: managers }, { data: assignments }] = await Promise.all([
    supabase.from("jobs").select("*, departments(name), applications(count)").eq("id", jobId).eq("org_id", m.orgId).maybeSingle(),
    supabase.from("departments").select("name").eq("org_id", m.orgId).order("name"),
    supabase.from("members").select("user_id, full_name, email").eq("org_id", m.orgId).eq("role", "hiring_manager"),
    supabase.from("job_assignments").select("user_id").eq("org_id", m.orgId).eq("job_id", jobId),
  ]);
  if (error) throw error;
  if (!job) notFound(); // also covers jobs a hiring manager is not assigned to (RLS)

  const assignedIds = new Set((assignments ?? []).map((a) => a.user_id));
  const people = (managers ?? []).map((x) => ({ id: x.user_id, name: memberName(x), email: x.email }));

  const canManage = isHr(m);
  const applicants = (job.applications as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
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
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          <span className="flex gap-4 text-sm font-medium">
            <Link href={`/app/jobs/${job.id}/pipeline`} className="underline">Pipeline</Link>
            <Link href={`/app/candidates?job=${job.id}`} className="underline">
              {applicants} {applicants === 1 ? "candidate" : "candidates"} →
            </Link>
          </span>
        </div>
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
      <HiringTeam
        jobId={job.id}
        assigned={people.filter((p) => assignedIds.has(p.id))}
        available={people.filter((p) => !assignedIds.has(p.id))}
        canManage={canManage}
        isAdmin={m.role === "admin"}
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
