import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate, formatDateTime } from "@/lib/dates";
import { memberName } from "@/lib/notes/mentions";
import { kindLabel } from "@/lib/privacy/requests";
import { createClient } from "@/lib/supabase/server";
import { DueBadge, StatusLabel } from "../badges";
import { HandleRequest } from "./handle-request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Props = PageProps<"/app/requests/[requestId]">;

export default function RequestPage(props: Props) {
  return (
    <main className="max-w-3xl">
      <Link href="/app/requests" className="text-sm text-zinc-500 hover:underline">← Data requests</Link>
      <Suspense fallback={<p className="mt-4 text-zinc-500">Loading…</p>}>
        <Request params={props.params} />
      </Suspense>
    </main>
  );
}

async function Request({ params }: Pick<Props, "params">) {
  const { requestId } = await params;
  if (!UUID.test(requestId)) notFound();
  const m = await requireMembership();
  if (!isHr(m)) redirect("/app");

  const supabase = await createClient();
  const { data: r, error } = await supabase.from("data_requests")
    .select("id, email, kind, details, status, verified_at, due_at, handled_at, handled_by, resolution, candidate_id, created_at, candidates(id, full_name, phone, email)")
    .eq("id", requestId).eq("org_id", m.orgId).maybeSingle();
  if (error) throw error;
  if (!r || !r.verified_at) notFound(); // unconfirmed requests are not shown to HR

  const candidate = r.candidates as unknown as { id: string; full_name: string; phone: string | null; email: string } | null;
  let handler: string | null = null;
  if (r.handled_by) {
    const { data: who } = await supabase.from("members").select("full_name, email").eq("org_id", m.orgId).eq("user_id", r.handled_by).maybeSingle();
    handler = who ? memberName(who) : "Former member";
  }
  const { count: applications } = candidate
    ? await supabase.from("applications").select("id", { count: "exact", head: true }).eq("candidate_id", candidate.id)
    : { count: 0 };

  return (
    <>
      <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{kindLabel(r.kind)} request</h1>
        {r.status === "open" && r.due_at ? <DueBadge dueAt={r.due_at} label={formatDate(r.due_at, m.orgTimezone)} /> : <StatusLabel status={r.status} />}
      </div>

      <dl className="mb-6 grid gap-x-8 gap-y-2 rounded-lg border border-zinc-200 p-4 text-sm sm:grid-cols-2 dark:border-zinc-800">
        <Item label="From">{r.email}</Item>
        <Item label="Candidate">
          {candidate ? (
            <Link href={`/app/candidates/${candidate.id}`} className="underline">{candidate.full_name}</Link>
          ) : r.status === "open" ? "No longer on file" : "—"}
          {candidate && ` · ${applications ?? 0} application${applications === 1 ? "" : "s"}`}
        </Item>
        <Item label="Requested">{formatDateTime(r.created_at, m.orgTimezone)}</Item>
        <Item label="Confirmed by email">{formatDateTime(r.verified_at, m.orgTimezone)}</Item>
        {r.due_at && <Item label="Reply by">{formatDate(r.due_at, m.orgTimezone)}</Item>}
        {r.handled_at && <Item label="Handled">{formatDateTime(r.handled_at, m.orgTimezone)}{handler && ` by ${handler}`}</Item>}
      </dl>

      {r.details && (
        <section className="mb-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">Candidate&apos;s message</h2>
          <p className="whitespace-pre-line rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">{r.details}</p>
        </section>
      )}

      {r.status === "open" ? (
        <HandleRequest requestId={r.id} kind={r.kind} email={r.email} hasCandidate={!!candidate}
          candidate={candidate ? { fullName: candidate.full_name, phone: candidate.phone ?? "" } : null} />
      ) : (
        r.resolution && (
          <section>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">What the candidate was told</h2>
            <p className="whitespace-pre-line text-sm">{r.resolution}</p>
          </section>
        )
      )}
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
