import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { StoredAnswer } from "@/lib/applications/validate";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { sourceLabel, StageBadge } from "../stage-badge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = PageProps<"/app/candidates/[candidateId]">;

type Application = {
  id: string;
  job_id: string;
  source: string;
  answers: Record<string, StoredAnswer>;
  submitted_at: string;
  stage_changed_at: string;
  rejection_reason: string | null;
  jobs: { title: string; status: string } | null;
  pipeline_stages: { name: string; kind: string } | null;
  candidate_files: {
    id: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    scan_status: "pending" | "clean" | "infected" | "error";
  } | null;
};

export default function CandidatePage(props: Props) {
  return (
    <main className="max-w-4xl">
      <Link href="/app/candidates" className="text-sm text-zinc-500 hover:underline">← Candidates</Link>
      <Suspense fallback={<p className="mt-4 text-zinc-500">Loading candidate…</p>}>
        <Candidate params={props.params} />
      </Suspense>
    </main>
  );
}

async function Candidate({ params }: Pick<Props, "params">) {
  const { candidateId } = await params;
  if (!UUID.test(candidateId)) notFound();

  const m = await requireMembership();
  const supabase = await createClient();
  const tz = m.orgTimezone;

  const [candidateRes, appsRes, stagesRes, membersRes] = await Promise.all([
    supabase
      .from("candidates")
      .select("id, full_name, email, phone, timezone, locale, created_at")
      .eq("id", candidateId)
      .eq("org_id", m.orgId)
      .maybeSingle(),
    // RLS limits hiring managers to applications for jobs assigned to them.
    supabase
      .from("applications")
      .select(
        `id, job_id, source, answers, submitted_at, stage_changed_at, rejection_reason,
         jobs(title, status), pipeline_stages(name, kind),
         candidate_files(id, original_name, mime_type, size_bytes, scan_status)`,
      )
      .eq("candidate_id", candidateId)
      .eq("org_id", m.orgId)
      .order("submitted_at", { ascending: false }),
    supabase.from("pipeline_stages").select("id, name").eq("org_id", m.orgId),
    supabase.from("members").select("user_id, full_name, email").eq("org_id", m.orgId),
  ]);
  for (const r of [candidateRes, appsRes, stagesRes, membersRes]) if (r.error) throw r.error;
  const candidate = candidateRes.data;
  if (!candidate) notFound(); // also covers candidates a hiring manager may not see

  const apps = (appsRes.data ?? []) as unknown as Application[];
  const appIds = apps.map((a) => a.id);
  const [historyRes, messagesRes, consentRes] = await Promise.all([
    supabase
      .from("stage_history")
      .select("id, application_id, from_stage_id, to_stage_id, changed_by, reason, changed_at")
      .in("application_id", appIds)
      .order("changed_at", { ascending: false }),
    supabase
      .from("messages")
      .select("id, application_id, subject, template_key, status, sent_at, send_after, created_at")
      .in("application_id", appIds)
      .order("created_at", { ascending: false }),
    // HR only (RLS); hiring managers get an empty list.
    supabase
      .from("consent_records")
      .select("id, application_id, purpose, given_at, withdrawn_at, consent_notices(version, locale)")
      .eq("candidate_id", candidateId),
  ]);
  for (const r of [historyRes, messagesRes, consentRes]) if (r.error) throw r.error;

  const stageName = new Map((stagesRes.data ?? []).map((s) => [s.id, s.name]));
  const memberName = new Map((membersRes.data ?? []).map((x) => [x.user_id, x.full_name || x.email]));
  const byApp = <T extends { application_id: string | null }>(rows: T[] | null, id: string) =>
    (rows ?? []).filter((r) => r.application_id === id);

  return (
    <>
      <header className="mb-8 mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">{candidate.full_name}</h1>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Email"><a href={`mailto:${candidate.email}`} className="underline">{candidate.email}</a></Detail>
          <Detail label="Phone">
            {candidate.phone ? <a href={`tel:${candidate.phone.replace(/[^\d+]/g, "")}`} className="underline">{candidate.phone}</a> : "—"}
          </Detail>
          <Detail label="Time zone">{candidate.timezone ?? "Unknown"}</Detail>
          <Detail label="First applied">{formatDate(candidate.created_at, tz)}</Detail>
        </dl>
      </header>

      {apps.length === 0 && <p className="text-zinc-600 dark:text-zinc-400">No applications you can view.</p>}

      <div className="space-y-8">
        {apps.map((a) => {
          const history = byApp(historyRes.data, a.id);
          const messages = byApp(messagesRes.data, a.id);
          const consent = byApp(consentRes.data, a.id);
          const answers = Object.values(a.answers ?? {});
          return (
            <section key={a.id} id={`application-${a.id}`} aria-labelledby={`title-${a.id}`}
              className="scroll-mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                <div>
                  <h2 id={`title-${a.id}`} className="font-semibold">
                    <Link href={`/app/jobs/${a.job_id}`} className="hover:underline">{a.jobs?.title}</Link>
                  </h2>
                  <p className="text-sm text-zinc-500">
                    Applied {formatDate(a.submitted_at, tz)} via {sourceLabel(a.source)}
                  </p>
                </div>
                {a.pipeline_stages && <StageBadge name={a.pipeline_stages.name} kind={a.pipeline_stages.kind} />}
              </div>

              <div className="grid gap-6 px-5 py-5 md:grid-cols-2">
                <div className="space-y-6">
                  <Block title="Resume">
                    <Resume file={a.candidate_files} />
                  </Block>

                  <Block title="Screening answers">
                    {answers.length === 0 ? (
                      <p className="text-sm text-zinc-500">No screening questions for this job.</p>
                    ) : (
                      <dl className="space-y-3 text-sm">
                        {answers.map((ans, i) => (
                          <div key={i}>
                            <dt className="text-zinc-500">{ans.question}</dt>
                            <dd className="mt-0.5 whitespace-pre-line">{ans.answer === "yes" ? "Yes" : ans.answer === "no" ? "No" : ans.answer}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </Block>
                </div>

                <div className="space-y-6">
                  <Block title="Stage history">
                    <ol className="space-y-2 text-sm">
                      {history.map((h) => (
                        <li key={h.id}>
                          <span className="font-medium">
                            {h.from_stage_id ? `${stageName.get(h.from_stage_id)} → ${stageName.get(h.to_stage_id)}` : `Applied (${stageName.get(h.to_stage_id)})`}
                          </span>
                          <span className="text-zinc-500">
                            {" · "}{formatDate(h.changed_at, tz)}
                            {h.changed_by ? ` · ${memberName.get(h.changed_by) ?? "Former member"}` : ""}
                          </span>
                          {h.reason && <p className="text-zinc-600 dark:text-zinc-400">Reason: {h.reason}</p>}
                        </li>
                      ))}
                    </ol>
                  </Block>

                  <Block title="Emails">
                    {messages.length === 0 ? (
                      <p className="text-sm text-zinc-500">None yet.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {messages.map((msg) => (
                          <li key={msg.id} className="flex flex-wrap justify-between gap-2">
                            <span>{msg.subject ?? templateLabel(msg.template_key)}</span>
                            <span className="text-zinc-500">{messageStatus(msg, tz)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Block>

                  {isHr(m) && consent.length > 0 && (
                    <Block title="Consent (PDPA)">
                      <ul className="space-y-1 text-sm">
                        {consent.map((c) => {
                          const notice = c.consent_notices as unknown as { version: number; locale: string } | null;
                          return (
                            <li key={c.id}>
                              Agreed to privacy notice v{notice?.version} ({notice?.locale?.toUpperCase()}) on {formatDate(c.given_at, tz)}
                              {c.withdrawn_at && <span className="text-red-700 dark:text-red-400"> · withdrawn {formatDate(c.withdrawn_at, tz)}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </Block>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}

function Resume({ file }: { file: Application["candidate_files"] }) {
  if (!file) return <p className="text-sm text-zinc-500">No resume attached.</p>;
  const size = `${(file.size_bytes / 1024 / 1024).toFixed(1)} MB`;
  const isPdf = file.mime_type === "application/pdf";

  if (file.scan_status === "infected") {
    return (
      <p className="text-sm text-red-700 dark:text-red-400">
        {file.original_name} was flagged by the virus scan and cannot be opened.
      </p>
    );
  }
  return (
    <div className="text-sm">
      {/* A plain link (not next/link): every open is a fresh, audited request. */}
      <a href={`/app/files/${file.id}`} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
        {isPdf ? "Open resume" : "Download resume"}
        <span className="font-normal text-zinc-500">({isPdf ? "PDF" : "Word"}, {size})</span>
      </a>
      <p className="mt-1 break-all text-zinc-500">{file.original_name}</p>
      {file.scan_status !== "clean" && (
        <p className="mt-1 text-amber-700 dark:text-amber-400">Not virus-scanned yet. Open only if you trust the source.</p>
      )}
    </div>
  );
}

const TEMPLATE_LABEL: Record<string, string> = {
  application_received: "Application received",
  interview_invite: "Interview invitation",
  offer_pending: "Offer pending",
  rejected: "Not progressing",
};
const templateLabel = (key: string | null) => (key && TEMPLATE_LABEL[key]) || "Email";

function messageStatus(
  msg: { status: string; sent_at: string | null; send_after: string },
  tz: string,
): string {
  switch (msg.status) {
    case "sent":
      return `Sent ${msg.sent_at ? formatDate(msg.sent_at, tz) : ""}`;
    case "queued":
      return Date.parse(msg.send_after) > Date.now() ? `Scheduled for ${formatDate(msg.send_after, tz)}` : "Sending…";
    case "sending":
      return "Sending…";
    case "cancelled":
      return "Cancelled";
    default:
      return "Failed to send";
  }
}
