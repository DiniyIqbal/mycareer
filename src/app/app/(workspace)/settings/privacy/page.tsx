import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate, formatDateTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { NoticeEditor, RetentionForm } from "./privacy-controls";

const UPCOMING_DAYS = 30;

export default function PrivacySettingsPage() {
  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
      <Suspense fallback={<p className="mt-4 text-zinc-500">Loading…</p>}>
        <Privacy />
      </Suspense>
    </main>
  );
}

async function Privacy() {
  const m = await requireMembership();
  if (!isHr(m)) redirect("/app");
  const isAdmin = m.role === "admin";
  const supabase = await createClient();

  const [org, notices, schedule] = await Promise.all([
    supabase.from("organisations").select("retention_months").eq("id", m.orgId).single(),
    supabase.from("consent_notices").select("locale, version, body, published_at")
      .eq("org_id", m.orgId).eq("purpose", "application").order("version", { ascending: false }),
    supabase.rpc("candidate_retention_schedule", { p_org: m.orgId }),
  ]);
  for (const r of [org, notices, schedule]) if (r.error) throw r.error;

  const latest = (locale: string) => notices.data?.find((n) => n.locale === locale) ?? null;
  const { upcoming, overdue } = splitSchedule((schedule.data ?? []) as { candidate_id: string; delete_after: string }[]);
  const ids = [...overdue, ...upcoming].map((s) => s.candidate_id);
  const { data: names } = ids.length
    ? await supabase.from("candidates").select("id, full_name, email").in("id", ids)
    : { data: [] as { id: string; full_name: string; email: string }[] };
  const nameOf = new Map((names ?? []).map((c) => [c.id, c]));
  const months = org.data!.retention_months as number;

  return (
    <div className="mt-1 space-y-8">
      <p className="text-zinc-600 dark:text-zinc-400">How long candidate data is kept, and the notice candidates agree to when they apply.</p>

      <section aria-labelledby="retention" className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 id="retention" className="font-semibold">Data retention</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          A candidate&apos;s profile, applications, resume, notes and emails are deleted automatically{" "}
          <strong>{months} months</strong> after the last job they applied for closed (closed, archived, or past its
          closing date). Anyone with an application to a job that is still open is kept. Deletions run once a day and are
          recorded in the audit log.
        </p>
        {isAdmin && <RetentionForm months={months} />}

        <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Due for deletion in the next {UPCOMING_DAYS} days
        </h3>
        {overdue.length + upcoming.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No one.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {[...overdue, ...upcoming].map((s) => {
              const c = nameOf.get(s.candidate_id);
              return (
                <li key={s.candidate_id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <Link href={`/app/candidates/${s.candidate_id}`} className="underline">{c?.full_name ?? "Candidate"}</Link>
                  <span className="text-zinc-500">{c?.email}</span>
                  <span className={overdue.includes(s) ? "text-red-700 dark:text-red-400" : ""}>
                    {overdue.includes(s) ? "At the next daily run" : formatDate(s.delete_after, m.orgTimezone)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="notice" className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 id="notice" className="font-semibold">Privacy notice</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Shown on the application form and the &ldquo;Your data&rdquo; page. Publishing creates a new version; each
          candidate&apos;s consent stays linked to the version they agreed to. Have it reviewed by your legal adviser.
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          {(["en", "ms"] as const).map((locale) => {
            const n = latest(locale);
            return (
              <NoticeEditor key={locale} locale={locale} readOnly={!isAdmin}
                initial={n?.body ?? ""}
                meta={n ? `Version ${n.version} · published ${formatDateTime(n.published_at, m.orgTimezone)}` : "Not published"}
                isDraft={!!n?.body.startsWith("DRAFT") || !!n?.body.startsWith("DRAF ")} />
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Request-time split of the schedule (this page is dynamic). */
function splitSchedule(rows: { candidate_id: string; delete_after: string }[]) {
  const now = Date.now();
  const horizon = now + UPCOMING_DAYS * 86_400_000;
  const sorted = [...rows].sort((a, b) => Date.parse(a.delete_after) - Date.parse(b.delete_after));
  return {
    overdue: sorted.filter((r) => Date.parse(r.delete_after) <= now),
    upcoming: sorted.filter((r) => Date.parse(r.delete_after) > now && Date.parse(r.delete_after) <= horizon),
  };
}
