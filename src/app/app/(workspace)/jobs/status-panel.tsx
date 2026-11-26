"use client";

import { useActionState } from "react";
import { STATUS_LABEL, STATUS_TRANSITIONS, type JobStatus } from "@/lib/jobs/schema";
import { changeJobStatus, type StatusState } from "./actions";

const BADGE: Record<JobStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  published: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  closed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  archived: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusPanel({
  jobId,
  status,
  canManage,
  publicUrl,
}: {
  jobId: string;
  status: JobStatus;
  canManage: boolean;
  publicUrl: string;
}) {
  const [state, action, pending] = useActionState<StatusState, FormData>(changeJobStatus, {});

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {status === "published" && (
          <a href={publicUrl} target="_blank" rel="noreferrer" className="text-sm underline">
            View on careers page ↗
          </a>
        )}
        {canManage && (
          <div className="ml-auto flex flex-wrap gap-2">
            {STATUS_TRANSITIONS[status].map((t) => (
              <form key={t.to} action={action}>
                <input type="hidden" name="job_id" value={jobId} />
                <input type="hidden" name="to" value={t.to} />
                <button disabled={pending}
                  className={
                    t.to === "published"
                      ? "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
                      : "rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700"
                  }>
                  {t.label}
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
      <div aria-live="polite" className="text-sm">
        {state.message && <p className="text-green-700 dark:text-green-500">{state.message}</p>}
        {state.error && <p className="text-red-600">{state.error}</p>}
        {state.problems && (
          <ul className="mt-1 list-disc pl-5 text-red-600">
            {state.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
