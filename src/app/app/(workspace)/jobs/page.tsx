import Link from "next/link";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate } from "@/lib/dates";
import type { JobStatus } from "@/lib/jobs/schema";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "./status-panel";

const TABS = [
  { key: "active", label: "Active", statuses: ["draft", "published", "closed"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
] as const;

export default async function JobsPage(props: PageProps<"/app/jobs">) {
  const m = await requireMembership();
  const { tab: tabParam } = await props.searchParams;
  const tab = TABS.find((t) => t.key === tabParam) ?? TABS[0];

  const supabase = await createClient();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, title, status, location, updated_at, closes_at, departments(name), applications(count)")
    .eq("org_id", m.orgId)
    .in("status", [...tab.statuses])
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return (
    <main>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        {isHr(m) && (
          <Link href="/app/jobs/new"
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-zinc-900">
            New job
          </Link>
        )}
      </div>

      <nav aria-label="Job status" className="mb-4 flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "active" ? "/app/jobs" : `/app/jobs?tab=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-1 pb-2 text-sm aria-[current=page]:border-zinc-900 aria-[current=page]:font-medium dark:aria-[current=page]:border-white">
            {t.label}
          </Link>
        ))}
      </nav>

      {jobs.length === 0 ? (
        <p className="py-8 text-zinc-600 dark:text-zinc-400">
          {tab.key === "active"
            ? isHr(m) ? "No jobs yet. Create your first job to start receiving applications." : "No jobs are assigned to you yet."
            : "No archived jobs."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {jobs.map((job) => {
            const applicants = (job.applications as unknown as { count: number }[])[0]?.count ?? 0;
            const department = (job.departments as unknown as { name: string } | null)?.name;
            return (
              <li key={job.id}>
                <Link href={`/app/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{job.title}</p>
                    <p className="text-sm text-zinc-500">
                      {[department, job.location, job.closes_at && `Closes ${formatDate(job.closes_at, m.orgTimezone)}`]
                        .filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{applicants} applicants</span>
                    <StatusBadge status={job.status as JobStatus} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
