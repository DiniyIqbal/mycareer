"use client";

import { useActionState } from "react";
import { acceptInvitation } from "./actions";

export function AcceptButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitation, {});
  return (
    <form action={action} className="space-y-3 pt-2">
      <input type="hidden" name="token" value={token} />
      <button disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900">
        {pending ? "Joining…" : "Accept invitation"}
      </button>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
