import { Suspense } from "react";
import Link from "next/link";
import { requireMembership } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";

// HR-01: totals come straight from the database on every request, scoped by
// RLS (hiring managers only see their assigned jobs and candidates).
export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading dashboard…</p>}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const m = await requireMembership();
  const supabase = await createClient();

  const [candidates, jobs] = await Promise.all([
    supabase.from("candidates").select("id", { count: "exact", head: true }).eq("org_id", m.orgId),
    supabase
      .from("jobs")
      .select("id, title, location, applications(count)")
      .eq("org_id", m.orgId)
      .eq("status", "published")
      .order("published_at", { ascending: false }),
  ]);
  if (candidates.error) throw candidates.error;
  if (jobs.error) throw jobs.error;

  const activeJobs = jobs.data.map((j) => ({
    ...j,
    applicants: (j.applications as unknown as { count: number }[])[0]?.count ?? 0,
  }));

  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>
      <dl className="mb-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <dt className="text-sm text-zinc-500">Total candidates</dt>
          <dd className="text-3xl font-semibold tabular-nums">{candidates.count ?? 0}</dd>
        </div>
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <dt className="text-sm text-zinc-500">Active jobs</dt>
          <dd className="text-3xl font-semibold tabular-nums">{activeJobs.length}</dd>
        </div>
      </dl>

      <h2 className="mb-3 font-medium">Active jobs</h2>
      {activeJobs.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No published jobs yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {/* Will link to the job's candidate list once that page exists (HR-04). */}
          {activeJobs.map((job) => (
            <li key={job.id}>
              <Link href={`/app/jobs/${job.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <div>
                  <p className="font-medium">{job.title}</p>
                  <p className="text-sm text-zinc-500">{job.location}</p>
                </div>
                <span className="text-sm tabular-nums">{job.applicants} applicants</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
