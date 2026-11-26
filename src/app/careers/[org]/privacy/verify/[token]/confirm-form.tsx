"use client";

import { useActionState } from "react";
import { confirmRequest, type VerifyState } from "./actions";

export function ConfirmForm({ token, kindLabel, email }: { token: string; kindLabel: string; email: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(confirmRequest, { status: "idle" });

  if (state.status === "confirmed") {
    const due = state.dueLabel;
    return (
      <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-5 dark:border-green-900 dark:bg-green-950">
        <h2 className="font-semibold">Request confirmed</h2>
        <p className="mt-1">
          {state.noData
            ? "We do not hold any personal data for this email address, so there is nothing more to do."
            : `Thank you. We will reply to ${email} by ${due}.`}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <p>Request: <strong>{kindLabel}</strong> for <strong>{email}</strong></p>
      <button disabled={pending}
        className="rounded-md bg-zinc-900 px-5 py-3 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900">
        {pending ? "Confirming…" : "Confirm request"}
      </button>
      {state.status === "error" && <p role="alert" className="text-red-700 dark:text-red-400">{state.message}</p>}
    </form>
  );
}
