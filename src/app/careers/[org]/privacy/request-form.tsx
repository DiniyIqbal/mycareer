"use client";

import { useActionState, useEffect, useRef, useState, startTransition, type FormEvent } from "react";
import { REQUEST_KINDS } from "@/lib/privacy/requests";
import { requestData, type RequestState } from "./actions";

const input = "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-base aria-[invalid=true]:border-red-600 dark:border-zinc-700 dark:bg-zinc-900";

export function RequestForm({ orgSlug }: { orgSlug: string }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(requestData, { status: "idle" });
  const [kind, setKind] = useState("export");
  const alertRef = useRef<HTMLDivElement>(null);
  const errors = state.status === "error" ? state.fieldErrors : {};

  useEffect(() => { if (state.status !== "idle") alertRef.current?.focus(); }, [state]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  }

  if (state.status === "sent") {
    return (
      <div ref={alertRef} tabIndex={-1} role="status"
        className="rounded-lg border border-green-300 bg-green-50 p-5 outline-none dark:border-green-900 dark:bg-green-950">
        <h2 className="font-semibold">Check your email</h2>
        <p className="mt-1">
          If <strong>{state.email}</strong> is an address we hold data for, you will get an email with a link to confirm
          your request. The link works for 24 hours. We then reply within 21 days.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <input type="hidden" name="org_slug" value={orgSlug} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state.status === "error" && (
        <div ref={alertRef} tabIndex={-1} role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800 outline-none dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {state.message}
        </div>
      )}

      <fieldset>
        <legend className="mb-2 font-medium">What would you like us to do?</legend>
        <div className="space-y-2">
          {REQUEST_KINDS.map((k) => (
            <label key={k.value} className="flex items-center gap-3">
              <input type="radio" name="kind" value={k.value} checked={kind === k.value}
                onChange={() => setKind(k.value)} className="size-5" />
              {k.label}
            </label>
          ))}
        </div>
        {kind === "delete" && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Deleting your data also withdraws any application you have with us.
          </p>
        )}
      </fieldset>

      <div>
        <label htmlFor="email" className="mb-1 block font-medium">Email you applied with</label>
        <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required className={input}
          aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} />
        {errors.email && <p id="email-error" className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.email}</p>}
      </div>

      <div>
        <label htmlFor="details" className="mb-1 block font-medium">
          {kind === "correct" ? "What needs correcting?" : "Anything else we should know? (optional)"}
        </label>
        <textarea id="details" name="details" rows={3} maxLength={2000} className={input}
          aria-invalid={!!errors.details} aria-describedby={errors.details ? "details-error" : undefined} />
        {errors.details && <p id="details-error" className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.details}</p>}
      </div>

      <button disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-5 py-3 font-medium text-white disabled:opacity-60 sm:w-auto dark:bg-white dark:text-zinc-900">
        {pending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
