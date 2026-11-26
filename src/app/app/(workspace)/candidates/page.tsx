import Link from "next/link";
import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/membership";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { sourceLabel, StageBadge } from "./stage-badge";

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = PageProps<"/app/candidates">;
type Row = {
  id: string;
  candidate_id: string;
  submitted_at: string;
  source: string;
  stage_id: string;
  candidates: { full_name: string; email: string } | null;
  jobs: { title: string } | null;
  pipeline_stages: { name: string; kind: string } | null;
};

export default function CandidatesPage(props: Props) {
  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Candidates</h1>
      <Suspense fallback={<p className="text-zinc-500">Loading candidates…</p>}>
        <Candidates searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Candidates({ searchParams }: Pick<Props, "searchParams">) {
  const params = await searchParams;
  const jobId = UUID.test(first(params.job)) ? first(params.job) : "";
  const stageId = UUID.test(first(params.stage)) ? first(params.stage) : "";
  // Keep letters, digits and email punctuation; everything else would need
  // escaping inside a PostgREST filter.
  const q = first(params.q).replace(/[^\p{L}\p{N}@.+\-' ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number.parseInt(first(params.page), 10) || 1));

  const m = await requireMembership();
  const supabase = await createClient();

  let list = supabase
    .from("applications")
    .select(
      "id, candidate_id, submitted_at, source, stage_id, candidates!inner(full_name, email), jobs(title), pipeline_stages(name, kind)",
      { count: "exact" },
    )
    .eq("org_id", m.orgId)
    .order("submitted_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (jobId) list = list.eq("job_id", jobId);
  if (stageId) list = list.eq("stage_id", stageId);
  if (q) list = list.or(`full_name.ilike."%${q}%",email.ilike."%${q}%"`, { referencedTable: "candidates" });

  // Stage counts for the chips follow the job filter (not search or stage).
  let countsQuery = supabase.from("applications").select("stage_id").eq("org_id", m.orgId).limit(10000);
  if (jobId) countsQuery = countsQuery.eq("job_id", jobId);

  const [rows, stages, jobs, counts] = await Promise.all([
    list,
    supabase.from("pipeline_stages").select("id, name, kind").eq("org_id", m.orgId).order("position"),
    supabase.from("jobs").select("id, title, status").eq("org_id", m.orgId).neq("status", "draft").order("updated_at", { ascending: false }),
    countsQuery,
  ]);
  for (const r of [rows, stages, jobs, counts]) if (r.error) throw r.error;

  const data = (rows.data ?? []) as unknown as Row[];
  const total = rows.count ?? 0;
  const countByStage = new Map<string, number>();
  for (const a of counts.data ?? []) countByStage.set(a.stage_id, (countByStage.get(a.stage_id) ?? 0) + 1);
  const totalInScope = counts.data?.length ?? 0;

  const href = (next: Record<string, string>) => {
    const sp = new URLSearchParams();
    const merged = { job: jobId, stage: stageId, q, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/app/candidates?${s}` : "/app/candidates";
  };
  const filtered = !!(jobId || stageId || q);

  return (
    <>
      <form method="get" action="/app/candidates" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col text-sm">
          <span className="mb-1 font-medium">Search</span>
          <input name="q" type="search" defaultValue={q} placeholder="Name or email"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="flex min-w-48 flex-col text-sm">
          <span className="mb-1 font-medium">Job</span>
          <select name="job" defaultValue={jobId}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">All jobs</option>
            {(jobs.data ?? []).map((j) => (
              <option key={j.id} value={j.id}>{j.title}{j.status !== "published" ? ` (${j.status})` : ""}</option>
            ))}
          </select>
        </label>
        {stageId && <input type="hidden" name="stage" value={stageId} />}
        <button className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-zinc-900">Filter</button>
        {filtered && <Link href="/app/candidates" className="py-2 text-sm underline">Clear</Link>}
      </form>

      <nav aria-label="Stage" className="mb-4 flex flex-wrap gap-2">
        <StageChip href={href({ stage: "", page: "" })} active={!stageId} label="All" count={totalInScope} />
        {(stages.data ?? []).map((s) => (
          <StageChip key={s.id} href={href({ stage: s.id, page: "" })} active={s.id === stageId}
            label={s.name} count={countByStage.get(s.id) ?? 0} />
        ))}
      </nav>

      {data.length === 0 ? (
        <p className="py-8 text-zinc-600 dark:text-zinc-400">
          {filtered ? "No candidates match these filters." : "No applications yet. They appear here as soon as someone applies on your careers page."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Candidate</th>
                <th scope="col" className="px-4 py-2 font-medium">Job</th>
                <th scope="col" className="px-4 py-2 font-medium">Stage</th>
                <th scope="col" className="px-4 py-2 font-medium">Applied</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.map((a) => (
                <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="px-4 py-3">
                    <Link href={`/app/candidates/${a.candidate_id}#application-${a.id}`} className="font-medium hover:underline">
                      {a.candidates?.full_name}
                    </Link>
                    <p className="text-zinc-500">{a.candidates?.email}</p>
                  </td>
                  <td className="px-4 py-3">{a.jobs?.title}</td>
                  <td className="px-4 py-3">
                    {a.pipeline_stages && <StageBadge name={a.pipeline_stages.name} kind={a.pipeline_stages.kind} />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDate(a.submitted_at, m.orgTimezone)}</td>
                  <td className="hidden px-4 py-3 text-zinc-600 sm:table-cell dark:text-zinc-400">{sourceLabel(a.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <span className="flex gap-4">
            {page > 1 && <Link href={href({ page: String(page - 1) })} className="underline">Previous</Link>}
            {page * PAGE_SIZE < total && <Link href={href({ page: String(page + 1) })} className="underline">Next</Link>}
          </span>
        </nav>
      )}
    </>
  );
}

function StageChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined}
      className="rounded-full border border-zinc-300 px-3 py-1 text-sm aria-[current=true]:border-zinc-900 aria-[current=true]:bg-zinc-900 aria-[current=true]:text-white dark:border-zinc-700 dark:aria-[current=true]:border-white dark:aria-[current=true]:bg-white dark:aria-[current=true]:text-zinc-900">
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </Link>
  );
}
