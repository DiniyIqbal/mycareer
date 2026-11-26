import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/membership";
import { formatDateTime } from "@/lib/dates";
import { kindLabel } from "@/lib/privacy/requests";
import { createClient } from "@/lib/supabase/server";
import { markAllRead } from "./actions";

type Payload = {
  kind?: string;
  author_name?: string;
  candidate_name?: string;
  job_title?: string;
  excerpt?: string;
};

export default function NotificationsPage() {
  return (
    <main className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Notifications</h1>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <List />
      </Suspense>
    </main>
  );
}

async function List() {
  const m = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, payload, read_at, created_at")
    .eq("org_id", m.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  if (!data?.length) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        Nothing yet. You will see it here when a colleague @mentions you in a note or adds you to a job.
      </p>
    );
  }

  return (
    <>
      {unread > 0 && (
        <form action={markAllRead} className="mb-4">
          <button className="text-sm underline">Mark all as read</button>
        </form>
      )}
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {data.map((n) => {
          const p = (n.payload ?? {}) as Payload;
          return (
            <li key={n.id}>
              {/* Plain link: opening marks it read, then goes to the note. */}
              <a href={`/app/notifications/${n.id}/open`}
                className="flex gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-sky-600"}`} />
                <span className="min-w-0">
                  <span className="block text-sm">
                    {!n.read_at && <span className="sr-only">Unread: </span>}
                    {n.kind === "data_request" ? (
                      <>A candidate confirmed a <strong>{kindLabel(p.kind ?? "")}</strong> data request. Reply within 21 days.</>
                    ) : n.kind === "job_assigned" ? (
                      <><strong>{p.author_name ?? "A colleague"}</strong> added you to the hiring team for <strong>{p.job_title}</strong></>
                    ) : (
                      <><strong>{p.author_name ?? "A colleague"}</strong> mentioned you on{" "}
                        <strong>{p.candidate_name}</strong>{p.job_title ? ` (${p.job_title})` : ""}</>
                    )}
                  </span>
                  {p.excerpt && <span className="mt-0.5 block truncate text-sm text-zinc-600 dark:text-zinc-400">{p.excerpt}</span>}
                  <span className="mt-0.5 block text-xs text-zinc-500">{formatDateTime(n.created_at, m.orgTimezone)}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
