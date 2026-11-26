import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate } from "@/lib/dates";
import { kindLabel } from "@/lib/privacy/requests";
import { createClient } from "@/lib/supabase/server";
import { DueBadge, StatusLabel } from "./badges";

export default function RequestsPage() {
  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Data requests</h1>
      <p className="mb-6 mt-1 text-zinc-600 dark:text-zinc-400">
        Candidates asking to see, correct or delete their data (PDPA). Reply within 21 days of them confirming.
      </p>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Requests />
      </Suspense>
    </main>
  );
}

async function Requests() {
  const m = await requireMembership();
  if (!isHr(m)) redirect("/app");
  const supabase = await createClient();
  const cols = "id, email, kind, status, verified_at, due_at, handled_at, candidates(full_name)";
  const [open, closed] = await Promise.all([
    supabase.from("data_requests").select(cols).eq("org_id", m.orgId).eq("status", "open").order("due_at"),
    supabase.from("data_requests").select(cols).eq("org_id", m.orgId).in("status", ["completed", "rejected"])
      .not("verified_at", "is", null).order("handled_at", { ascending: false }).limit(50),
  ]);
  if (open.error) throw open.error;
  if (closed.error) throw closed.error;

  const row = (r: NonNullable<typeof open.data>[number]) => {
    const name = (r.candidates as unknown as { full_name: string } | null)?.full_name;
    return (
      <li key={r.id}>
        <Link href={`/app/requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
          <div className="min-w-0">
            <p className="font-medium">{kindLabel(r.kind)} · {name ?? r.email}</p>
            <p className="truncate text-sm text-zinc-500">
              {r.email} · confirmed {r.verified_at ? formatDate(r.verified_at, m.orgTimezone) : "—"}
              {r.handled_at && ` · handled ${formatDate(r.handled_at, m.orgTimezone)}`}
            </p>
          </div>
          {r.status === "open" && r.due_at ? <DueBadge dueAt={r.due_at} label={formatDate(r.due_at, m.orgTimezone)} /> : <StatusLabel status={r.status} />}
        </Link>
      </li>
    );
  };

  return (
    <>
      <h2 className="mb-3 font-semibold">Open ({open.data?.length ?? 0})</h2>
      {open.data?.length ? (
        <ul className="mb-8 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{open.data.map(row)}</ul>
      ) : (
        <p className="mb-8 text-zinc-600 dark:text-zinc-400">
          No open requests. Candidates can make one from{" "}
          <Link href={`/careers/${m.orgSlug}/privacy`} className="underline">your careers site&apos;s &ldquo;Your data&rdquo; page</Link>.
        </p>
      )}
      <h2 className="mb-3 font-semibold">Recently handled</h2>
      {closed.data?.length ? (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{closed.data.map(row)}</ul>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">None yet.</p>
      )}
    </>
  );
}
