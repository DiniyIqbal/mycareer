"use client";

import { useState, useTransition } from "react";
import { closeRequest, completeCorrection, eraseData, sendExport, type HandleResult } from "../actions";

const field = "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";
const primary = "rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900";

export function HandleRequest({ requestId, kind, email, hasCandidate, candidate }: {
  requestId: string;
  kind: string;
  email: string;
  hasCandidate: boolean;
  candidate: { fullName: string; phone: string } | null;
}) {
  const [result, setResult] = useState<HandleResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<HandleResult>) => start(async () => setResult(await fn()));

  if (result?.ok) {
    return <p role="status" className="rounded-md border border-green-300 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">{result.message}</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        {kind === "export" && hasCandidate && (
          <>
            <h2 className="font-semibold">Send the candidate their data</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              They get an email with a link to download everything we hold: profile, applications, answers, status
              history, emails sent to them, consents and resume. The link works for 7 days.{" "}
              <a href={`/app/requests/${requestId}/export`} className="underline">Preview the file</a>.
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Internal notes and rejection reasons are not included.</p>
            <button type="button" disabled={pending} className={`${primary} mt-3`} onClick={() => run(() => sendExport({ requestId }))}>
              {pending ? "Sending…" : "Send download link"}
            </button>
          </>
        )}

        {kind === "delete" && hasCandidate && <EraseForm requestId={requestId} email={email} pending={pending} run={run} />}

        {kind === "correct" && candidate && <CorrectForm requestId={requestId} candidate={candidate} pending={pending} run={run} />}

        {!hasCandidate && (
          <p className="text-sm">This candidate is no longer on file. Close the request below and tell them so.</p>
        )}
      </section>

      <CloseForm requestId={requestId} pending={pending} run={run} />
      {result && !result.ok && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{result.error}</p>}
    </div>
  );
}

type RunProps = { requestId: string; pending: boolean; run: (fn: () => Promise<HandleResult>) => void };

function EraseForm({ requestId, email, pending, run }: RunProps & { email: string }) {
  const [typed, setTyped] = useState("");
  return (
    <>
      <h2 className="font-semibold text-red-800 dark:text-red-300">Delete all of this candidate&apos;s data</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Permanently deletes their profile, every application, answers, resume files, notes, stage history, emails and
        consent records. Only a record that this request was handled is kept. This cannot be undone.
      </p>
      <label className="mt-3 block text-sm">
        <span className="mb-1 block">Type <strong>{email}</strong> to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={field} />
      </label>
      <button type="button" disabled={pending || typed.trim().toLowerCase() !== email}
        onClick={() => run(() => eraseData({ requestId, confirmEmail: typed }))}
        className="mt-3 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Deleting…" : "Delete everything"}
      </button>
    </>
  );
}

function CorrectForm({ requestId, candidate, pending, run }: RunProps & { candidate: { fullName: string; phone: string } }) {
  const [fullName, setFullName] = useState(candidate.fullName);
  const [phone, setPhone] = useState(candidate.phone);
  const [note, setNote] = useState("");
  return (
    <>
      <h2 className="font-semibold">Correct their details</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Update what they asked for, then tell them what changed. For anything else (for example a wrong answer), explain in the note.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block">Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={field} /></label>
        <label className="text-sm"><span className="mb-1 block">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={field} /></label>
      </div>
      <label className="mt-3 block text-sm"><span className="mb-1 block">Message to the candidate</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="We have updated your name to …" className={field} /></label>
      <button type="button" disabled={pending || !note.trim()} className={`${primary} mt-3`}
        onClick={() => run(() => completeCorrection({ requestId, fullName, phone, note }))}>
        {pending ? "Saving…" : "Save and notify"}
      </button>
    </>
  );
}

function CloseForm({ requestId, pending, run }: RunProps) {
  const [note, setNote] = useState("");
  return (
    <details className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <summary className="cursor-pointer font-medium">Close without the action above</summary>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        For example, if there is nothing to send, or the law lets you refuse (say why). The candidate is emailed your message.
      </p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={`${field} mt-2`} aria-label="Message to the candidate" />
      <div className="mt-2 flex gap-3">
        <button type="button" disabled={pending || note.trim().length < 5} className={primary}
          onClick={() => run(() => closeRequest({ requestId, outcome: "completed", note }))}>Mark handled</button>
        <button type="button" disabled={pending || note.trim().length < 5} className="rounded-md border border-red-300 px-4 py-2 font-medium text-red-800 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
          onClick={() => run(() => closeRequest({ requestId, outcome: "rejected", note }))}>Decline</button>
      </div>
    </details>
  );
}
