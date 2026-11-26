"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState, startTransition, type FormEvent } from "react";
import { answerField, RESUME_ACCEPT, resumeProblem } from "@/lib/applications/validate";
import type { ScreeningQuestion } from "@/lib/jobs/schema";
import type { ConsentNotice } from "@/lib/jobs/types";
import { applyForJob, type ApplyState } from "./actions";

type Props = {
  orgSlug: string;
  orgName: string;
  jobId: string;
  jobTitle: string;
  questions: ScreeningQuestion[];
  notice: ConsentNotice;
};

const input =
  "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base aria-[invalid=true]:border-red-600 dark:border-zinc-700 dark:bg-zinc-900";

export function ApplyForm({ orgSlug, orgName, jobId, jobTitle, questions, notice }: Props) {
  const [state, formAction, pending] = useActionState<ApplyState, FormData>(applyForJob, { status: "idle" });
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const errors = state.status === "error" ? state.fieldErrors : {};
  const errorFor = (field: string) => (field === "resume" ? fileError ?? errors.resume : errors[field]);

  useEffect(() => {
    if (state.status === "error") summaryRef.current?.focus();
    if (state.status === "success") doneRef.current?.focus();
  }, [state]);

  // Submitting through onSubmit (not the form's action prop) keeps what the
  // applicant typed, including the chosen file, when the server finds a problem.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("resume");
    const problem = resumeProblem(file instanceof File ? file : null);
    if (problem) {
      setFileError(problem);
      return;
    }
    data.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    data.set("source", searchParams.get("src") ?? "");
    startTransition(() => formAction(data));
  }

  if (state.status === "success") {
    return (
      <section aria-live="polite" className="rounded-lg border border-green-300 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
        <h2 ref={doneRef} tabIndex={-1} className="text-xl font-semibold outline-none">Application sent</h2>
        <p className="mt-2">
          Thank you for applying for <strong>{jobTitle}</strong> at {orgName}. We have emailed a confirmation
          to <strong>{state.email}</strong>. If it is not in your inbox in a few minutes, check your spam folder.
        </p>
        <Link href={`/careers/${orgSlug}`} className="mt-4 inline-block underline">See other jobs at {orgName}</Link>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="org_slug" value={orgSlug} />
      <input type="hidden" name="notice_id" value={notice.id} />
      {/* Honeypot for bots; hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      {state.status === "error" && (
        <div ref={summaryRef} tabIndex={-1} role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800 outline-none dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {state.message}
        </div>
      )}

      <Field id="full_name" label="Full name" error={errorFor("full_name")}>
        <input id="full_name" name="full_name" required autoComplete="name" maxLength={200} className={input}
          aria-invalid={!!errorFor("full_name")} aria-describedby={errorFor("full_name") ? "full_name-error" : undefined} />
      </Field>

      <Field id="email" label="Email" hint="We will send updates about your application here." error={errorFor("email")}>
        <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" maxLength={254}
          className={input} aria-invalid={!!errorFor("email")}
          aria-describedby={`email-hint${errorFor("email") ? " email-error" : ""}`} />
      </Field>

      <Field id="phone" label="Phone (optional)" error={errorFor("phone")}>
        <input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={30}
          placeholder="+60 12-345 6789" className={input} aria-invalid={!!errorFor("phone")}
          aria-describedby={errorFor("phone") ? "phone-error" : undefined} />
      </Field>

      <Field id="resume" label="Resume" hint="PDF or Word (.docx), up to 10 MB." error={errorFor("resume")}>
        <input id="resume" name="resume" type="file" required accept={RESUME_ACCEPT}
          className="block w-full text-base file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2.5 file:text-white dark:file:bg-white dark:file:text-zinc-900"
          aria-invalid={!!errorFor("resume")}
          aria-describedby={`resume-hint${errorFor("resume") ? " resume-error" : ""}`}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            setFileError(f ? resumeProblem(f) : null);
            setFileLabel(f ? `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)` : null);
          }} />
        {fileLabel && !errorFor("resume") && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{fileLabel}</p>}
      </Field>

      {questions.length > 0 && (
        <fieldset className="space-y-6 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <legend className="sr-only">Questions from {orgName}</legend>
          {questions.map((q) => <Question key={q.id} q={q} error={errors[answerField(q.id)]} />)}
        </fieldset>
      )}

      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 id="notice-heading" className="font-medium">Privacy notice</h2>
        <div tabIndex={0} aria-labelledby="notice-heading"
          className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 dark:border-zinc-800 dark:bg-zinc-900">
          {notice.body}
        </div>
        <label className="mt-3 flex items-start gap-3">
          <input type="checkbox" name="consent" required className="mt-1 size-5 shrink-0"
            aria-invalid={!!errors.consent} aria-describedby={errors.consent ? "consent-error" : undefined} />
          <span>I have read the privacy notice and agree to {orgName} processing my data to assess my application.</span>
        </label>
        {errors.consent && <p id="consent-error" className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.consent}</p>}
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          You can ask to see, correct or delete your data at any time on the{" "}
          <Link href={`/careers/${orgSlug}/privacy`} className="underline">Your data</Link> page.
        </p>
      </div>

      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-5 py-3 text-base font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-zinc-900">
        {pending ? "Sending application…" : "Submit application"}
      </button>
    </form>
  );
}

function Field({ id, label, hint, error, children }: {
  id: string; label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">{label}</label>
      {hint && <p id={`${id}-hint`} className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{hint}</p>}
      {children}
      {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

function Question({ q, error }: { q: ScreeningQuestion; error?: string }) {
  const name = answerField(q.id);
  const label = `${q.label}${q.required ? "" : " (optional)"}`;
  const described = error ? `${name}-error` : undefined;
  const errorText = error && <p id={`${name}-error`} className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>;

  if (q.type === "text") {
    return (
      <div>
        <label htmlFor={name} className="mb-1 block font-medium">{label}</label>
        <textarea id={name} name={name} rows={3} maxLength={2000} required={q.required} className={input}
          aria-invalid={!!error} aria-describedby={described} />
        {errorText}
      </div>
    );
  }

  const options = q.type === "yes_no" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
    : (q.options ?? []).map((o) => ({ value: o, label: o }));
  return (
    <fieldset aria-describedby={described} aria-invalid={!!error}>
      <legend className="mb-2 font-medium">{label}</legend>
      <div className={q.type === "yes_no" ? "flex gap-6" : "space-y-2"}>
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-3 py-1">
            <input type="radio" name={name} value={o.value} required={q.required} className="size-5" />
            {o.label}
          </label>
        ))}
      </div>
      {errorText}
    </fieldset>
  );
}
