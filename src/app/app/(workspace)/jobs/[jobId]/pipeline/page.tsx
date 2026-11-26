import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { Board, type BoardCard } from "./board";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

type Props = PageProps<"/app/jobs/[jobId]/pipeline">;

type Row = {
  id: string;
  candidate_id: string;
  stage_id: string;
  submitted_at: string;
  stage_changed_at: string;
  candidates: unknown;
};

/** Request-time data (this page is dynamic): days in stage are as of now. */
function toCards(rows: Row[], timeZone: string): BoardCard[] {
  const now = Date.now();
  return rows.map((a) => {
    const c = a.candidates as { full_name: string; email: string } | null;
    return {
      id: a.id,
      candidateId: a.candidate_id,
      stageId: a.stage_id,
      name: c?.full_name ?? "Unknown",
      email: c?.email ?? "",
      applied: formatDate(a.submitted_at, timeZone),
      daysInStage: Math.max(0, Math.floor((now - Date.parse(a.stage_changed_at)) / DAY)),
    };
  });
}

export default function PipelinePage(props: Props) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading pipeline…</p>}>
      <Pipeline params={props.params} />
    </Suspense>
  );
}

async function Pipeline({ params }: Pick<Props, "params">) {
  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();

  const m = await requireMembership();
  const supabase = await createClient();
  const [jobRes, stagesRes, appsRes] = await Promise.all([
    supabase.from("jobs").select("id, title, status, automations_paused").eq("id", jobId).eq("org_id", m.orgId).maybeSingle(),
    supabase.from("pipeline_stages").select("id, name, kind").eq("org_id", m.orgId).order("position"),
    supabase
      .from("applications")
      .select("id, candidate_id, stage_id, submitted_at, stage_changed_at, candidates(full_name, email)")
      .eq("job_id", jobId)
      .eq("org_id", m.orgId)
      .order("stage_changed_at", { ascending: true })
      .limit(2000),
  ]);
  for (const r of [jobRes, stagesRes, appsRes]) if (r.error) throw r.error;
  const job = jobRes.data;
  if (!job) notFound(); // also covers jobs a hiring manager is not assigned to

  const cards = toCards(appsRes.data ?? [], m.orgTimezone);

  return (
    <main>
      <Link href={`/app/jobs/${job.id}`} className="text-sm text-zinc-500 hover:underline">← Job details</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}: pipeline</h1>
        <Link href={`/app/candidates?job=${job.id}`} className="text-sm underline">List view</Link>
      </div>
      {job.automations_paused && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          Automatic emails are paused for this job. Moving candidates will not email them.
        </p>
      )}
      <Board jobId={job.id} stages={stagesRes.data ?? []} cards={cards} canMove={isHr(m)} />
    </main>
  );
}
