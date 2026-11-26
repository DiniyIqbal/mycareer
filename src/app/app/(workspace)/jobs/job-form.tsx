"use client";

import { startTransition, useActionState, useState } from "react";
import type { ScreeningQuestion } from "@/lib/jobs/schema";
import { EMPLOYMENT_TYPE_LABEL, WORKPLACE_LABEL } from "@/lib/jobs/types";
import { saveJob, type SaveJobState } from "./actions";

export type JobFormValues = {
  id?: string;
  title: string;
  department: string;
  description: string;
  location: string;
  address_locality: string;
  address_region: string;
  address_country: string;
  workplace_type: string;
  employment_type: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  salary_period: string;
  closes_on: string;
  screening_questions: ScreeningQuestion[];
};

export const EMPTY_JOB: JobFormValues = {
  title: "",
  department: "",
  description: "",
  location: "",
  address_locality: "",
  address_region: "",
  address_country: "MY",
  workplace_type: "onsite",
  employment_type: "full_time",
  salary_min: "",
  salary_max: "",
  salary_currency: "MYR",
  salary_period: "",
  closes_on: "",
  screening_questions: [],
};

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 aria-[invalid=true]:border-red-500";
const label = "text-sm font-medium";

function Field({
  name,
  labelText,
  hint,
  errors,
  children,
}: {
  name: string;
  labelText: string;
  hint?: string;
  errors?: Record<string, string[] | undefined>;
  children: React.ReactNode;
}) {
  const error = errors?.[name]?.[0];
  return (
    <div className="space-y-1">
      <label htmlFor={name} className={label}>{labelText}</label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      {error && <p id={`${name}-error`} className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

let questionCounter = 0;
const newQuestionId = () => `q-${Date.now().toString(36)}-${(questionCounter++).toString(36)}`;

export function JobForm({
  initial,
  departments,
  readOnly = false,
}: {
  initial: JobFormValues;
  departments: string[];
  readOnly?: boolean;
}) {
  const [state, action, pending] = useActionState<SaveJobState, FormData>(saveJob, {});
  const [questions, setQuestions] = useState<ScreeningQuestion[]>(initial.screening_questions);
  const [workplace, setWorkplace] = useState(initial.workplace_type);
  const errors = state.fieldErrors;
  const invalid = (name: string) => (errors?.[name] ? true : undefined);

  const updateQuestion = (i: number, patch: Partial<ScreeningQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const moveQuestion = (i: number, dir: -1 | 1) =>
    setQuestions((qs) => {
      const next = [...qs];
      const [q] = next.splice(i, 1);
      next.splice(i + dir, 0, q);
      return next;
    });

  return (
    <form
      className="space-y-8"
      // Not `action={action}`: React resets the form after an action, which
      // would wipe the user's input when validation fails.
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => action(formData));
      }}
    >
      {initial.id && <input type="hidden" name="job_id" value={initial.id} />}
      <input type="hidden" name="screening_questions" value={JSON.stringify(questions)} />

      <fieldset disabled={readOnly || pending} className="space-y-8">
        <section className="space-y-4">
          <h2 className="font-medium">Role</h2>
          <Field name="title" labelText="Job title" errors={errors}>
            <input id="title" name="title" required maxLength={200} defaultValue={initial.title}
              aria-invalid={invalid("title")} className={input} placeholder="e.g. Customer Service Executive" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="department" labelText="Department (optional)" errors={errors}>
              <input id="department" name="department" list="departments" maxLength={100}
                defaultValue={initial.department} className={input} placeholder="e.g. Operations" />
              <datalist id="departments">
                {departments.map((d) => <option key={d} value={d} />)}
              </datalist>
            </Field>
            <Field name="employment_type" labelText="Position type" errors={errors}>
              <select id="employment_type" name="employment_type" defaultValue={initial.employment_type} className={input}>
                {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          <Field name="description" labelText="Description" errors={errors}
            hint="Responsibilities, requirements and benefits. At least 50 characters to publish. Leave a blank line between paragraphs.">
            <textarea id="description" name="description" rows={12} maxLength={20000}
              defaultValue={initial.description} aria-invalid={invalid("description")} className={input} />
          </Field>
        </section>

        <section className="space-y-4">
          <h2 className="font-medium">Location</h2>
          <Field name="workplace_type" labelText="Workplace" errors={errors}>
            <select id="workplace_type" name="workplace_type" value={workplace}
              onChange={(e) => setWorkplace(e.target.value)} className={input}>
              {Object.entries(WORKPLACE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="address_locality" labelText={workplace === "remote" ? "City (optional)" : "City"}
              errors={errors} hint={workplace === "remote" ? undefined : "Needed to publish (Google Jobs)."}>
              <input id="address_locality" name="address_locality" maxLength={100}
                defaultValue={initial.address_locality} aria-invalid={invalid("address_locality")}
                className={input} placeholder="e.g. Shah Alam" />
            </Field>
            <Field name="address_region" labelText="State (optional)" errors={errors}>
              <input id="address_region" name="address_region" maxLength={100}
                defaultValue={initial.address_region} className={input} placeholder="e.g. Selangor" />
            </Field>
            <Field name="address_country" labelText="Country code" errors={errors}>
              <input id="address_country" name="address_country" maxLength={2}
                defaultValue={initial.address_country} aria-invalid={invalid("address_country")}
                className={`${input} uppercase`} />
            </Field>
          </div>
          <Field name="location" labelText="Location shown to applicants (optional)" errors={errors}
            hint="Defaults to “City, State”.">
            <input id="location" name="location" maxLength={200} defaultValue={initial.location} className={input} />
          </Field>
        </section>

        <section className="space-y-4">
          <h2 className="font-medium">Salary (optional)</h2>
          <p className="text-sm text-zinc-500">Jobs that show a salary get more applicants and rank better on Google Jobs.</p>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field name="salary_min" labelText="From" errors={errors}>
              <input id="salary_min" name="salary_min" type="number" min={0} step="any" inputMode="decimal"
                defaultValue={initial.salary_min} aria-invalid={invalid("salary_min")} className={input} />
            </Field>
            <Field name="salary_max" labelText="To" errors={errors}>
              <input id="salary_max" name="salary_max" type="number" min={0} step="any" inputMode="decimal"
                defaultValue={initial.salary_max} aria-invalid={invalid("salary_max")} className={input} />
            </Field>
            <Field name="salary_currency" labelText="Currency" errors={errors}>
              <input id="salary_currency" name="salary_currency" maxLength={3}
                defaultValue={initial.salary_currency} className={`${input} uppercase`} />
            </Field>
            <Field name="salary_period" labelText="Per" errors={errors}>
              <select id="salary_period" name="salary_period" defaultValue={initial.salary_period}
                aria-invalid={invalid("salary_period")} className={input}>
                <option value="">—</option>
                <option value="hour">Hour</option>
                <option value="day">Day</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-medium">Applications</h2>
          <Field name="closes_on" labelText="Closing date (optional)" errors={errors}
            hint="Applications close at the end of this day. Leave empty to keep the job open until you close it.">
            <input id="closes_on" name="closes_on" type="date" defaultValue={initial.closes_on}
              aria-invalid={invalid("closes_on")} className={`${input} sm:w-60`} />
          </Field>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Screening questions (optional)</h3>
              <p className="text-xs text-zinc-500">Asked on the application form. Keep them few — every question lowers completion on mobile.</p>
            </div>
            {errors?.screening_questions && (
              <p className="text-sm text-red-600">{errors.screening_questions[0]}</p>
            )}
            <ol className="space-y-3">
              {questions.map((q, i) => (
                <li key={q.id} className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex gap-2">
                    <label className="sr-only" htmlFor={`${q.id}-label`}>Question {i + 1}</label>
                    <input id={`${q.id}-label`} value={q.label} maxLength={300} required
                      onChange={(e) => updateQuestion(i, { label: e.target.value })}
                      className={input} placeholder={`Question ${i + 1}`} />
                    <select aria-label="Answer type" value={q.type} className={`${input} w-40`}
                      onChange={(e) => {
                        const type = e.target.value as ScreeningQuestion["type"];
                        updateQuestion(i, { type, options: type === "choice" ? (q.options?.length ? q.options : ["", ""]) : undefined });
                      }}>
                      <option value="text">Short answer</option>
                      <option value="yes_no">Yes / No</option>
                      <option value="choice">Multiple choice</option>
                    </select>
                  </div>
                  {q.type === "choice" && (
                    <div className="space-y-2 pl-4">
                      {(q.options ?? []).map((opt, k) => (
                        <div key={k} className="flex gap-2">
                          <input aria-label={`Option ${k + 1}`} value={opt} maxLength={100} required className={input}
                            placeholder={`Option ${k + 1}`}
                            onChange={(e) => updateQuestion(i, {
                              options: q.options!.map((o, n) => (n === k ? e.target.value : o)),
                            })} />
                          <button type="button" className="text-sm text-zinc-500 underline disabled:opacity-40"
                            disabled={(q.options?.length ?? 0) <= 2}
                            onClick={() => updateQuestion(i, { options: q.options!.filter((_, n) => n !== k) })}>
                            Remove
                          </button>
                        </div>
                      ))}
                      <button type="button" className="text-sm underline"
                        onClick={() => updateQuestion(i, { options: [...(q.options ?? []), ""] })}>
                        Add option
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={q.required}
                        onChange={(e) => updateQuestion(i, { required: e.target.checked })} />
                      Required
                    </label>
                    <button type="button" className="underline disabled:opacity-40" disabled={i === 0}
                      onClick={() => moveQuestion(i, -1)}>Move up</button>
                    <button type="button" className="underline disabled:opacity-40" disabled={i === questions.length - 1}
                      onClick={() => moveQuestion(i, 1)}>Move down</button>
                    <button type="button" className="text-red-600 underline"
                      onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>Delete</button>
                  </div>
                </li>
              ))}
            </ol>
            {questions.length < 20 && (
              <button type="button"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                onClick={() => setQuestions((qs) => [...qs, { id: newQuestionId(), label: "", type: "text", required: false }])}>
                + Add question
              </button>
            )}
          </div>
        </section>
      </fieldset>

      {!readOnly && (
        <div className="sticky bottom-0 flex items-center gap-4 border-t border-zinc-200 bg-[var(--background)] py-4 dark:border-zinc-800">
          <button disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900">
            {pending ? "Saving…" : initial.id ? "Save changes" : "Save as draft"}
          </button>
          <p aria-live="polite" className="text-sm">
            {state.error && <span className="text-red-600">{state.error}</span>}
            {state.message && <span className="text-green-700 dark:text-green-500">{state.message}</span>}
          </p>
        </div>
      )}
    </form>
  );
}
