"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { assignHiringManager, unassignHiringManager, type AssignResult } from "./assign-actions";

type Person = { id: string; name: string; email: string };

export function HiringTeam({ jobId, assigned, available, canManage, isAdmin }: {
  jobId: string;
  assigned: Person[];
  available: Person[];
  canManage: boolean;
  isAdmin: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<AssignResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<AssignResult>) => start(async () => setResult(await fn()));

  return (
    <section aria-labelledby="hiring-team" className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 id="hiring-team" className="font-semibold">Hiring managers</h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Assigned hiring managers can see this job&apos;s candidates and add notes. Recruiters and admins see every job.
      </p>
      {assigned.length === 0 ? (
        <p className="text-sm text-zinc-500">No one assigned yet.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {assigned.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3">
              <span>{p.name} <span className="text-zinc-500">· {p.email}</span></span>
              {canManage && (
                <button type="button" disabled={pending} className="text-red-700 underline dark:text-red-400"
                  onClick={() => run(() => unassignHiringManager({ jobId, userId: p.id }))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        available.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <label className="sr-only" htmlFor={`assign-${jobId}`}>Hiring manager to assign</label>
            <select id={`assign-${jobId}`} value={selected} onChange={(e) => setSelected(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
              <option value="">Choose a hiring manager…</option>
              {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" disabled={pending || !selected}
              onClick={() => run(async () => {
                const r = await assignHiringManager({ jobId, userId: selected });
                if (r.ok) setSelected("");
                return r;
              })}
              className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
              {pending ? "Saving…" : "Assign"}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            {assigned.length ? "All hiring managers are assigned." : "There are no hiring managers in your team yet."}{" "}
            {isAdmin && <Link href="/app/settings/team" className="underline">Invite one</Link>}
          </p>
        )
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"}
          className={`mt-2 text-sm ${result.ok ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-400"}`}>
          {result.ok ? result.message : result.error}
        </p>
      )}
    </section>
  );
}
