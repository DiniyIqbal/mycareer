"use client";

import { useState, useTransition, type FormEvent } from "react";
import { changeRole, inviteMember, removeMember, revokeInvitation, type TeamResult } from "./actions";

type RoleOption = { value: string; label: string };

function Result({ result }: { result: TeamResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <div role="status" className="text-sm text-green-700 dark:text-green-500">
      {result.message}
      {result.link && (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <code className="max-w-full break-all rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{result.link}</code>
          <button type="button" className="text-xs underline" onClick={() => navigator.clipboard?.writeText(result.link!)}>Copy</button>
        </span>
      )}
    </div>
  ) : (
    <p role="alert" className="text-sm text-red-700 dark:text-red-400">{result.error}</p>
  );
}

export function InviteForm({ roles }: { roles: RoleOption[] }) {
  const [result, setResult] = useState<TeamResult | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    start(async () => {
      const r = await inviteMember({ email: String(data.get("email") ?? ""), role: String(data.get("role") ?? "") });
      setResult(r);
      if (r.ok) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col text-sm">
          <span className="mb-1 font-medium">Work email</span>
          <input name="email" type="email" required autoComplete="off" placeholder="colleague@company.com"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium">Role</span>
          <select name="role" defaultValue="hiring_manager"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900">
          {pending ? "Sending…" : "Send invitation"}
        </button>
      </div>
      <Result result={result} />
    </form>
  );
}

export function MemberControls({ userId, name, role, isSelf, roles }: {
  userId: string; name: string; role: string; isSelf: boolean; roles: RoleOption[];
}) {
  const [result, setResult] = useState<TeamResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<TeamResult>) => start(async () => setResult(await fn()));

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3 text-sm">
        <label>
          <span className="sr-only">Role for {name}</span>
          <select value={role} disabled={pending}
            onChange={(e) => {
              const next = e.target.value;
              if (isSelf && role === "admin" && next !== "admin" &&
                  !confirm("You will lose admin access, including this page. Continue?")) return;
              run(() => changeRole({ userId, role: next }));
            }}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button type="button" disabled={pending} className="text-red-700 underline dark:text-red-400"
          onClick={() => {
            const question = isSelf
              ? "Leave this organisation? You will lose access immediately."
              : `Remove ${name} from the team? Their notes stay; their job assignments are removed.`;
            if (confirm(question)) run(() => removeMember({ userId }));
          }}>
          {isSelf ? "Leave" : "Remove"}
        </button>
      </div>
      <Result result={result} />
    </div>
  );
}

export function RevokeButton({ id, email, role }: { id: string; email: string; role: string }) {
  const [result, setResult] = useState<TeamResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1 text-sm">
      <span className="flex gap-3">
        <button type="button" disabled={pending} className="underline"
          onClick={() => start(async () => setResult(await inviteMember({ email, role })))}>
          Resend
        </button>
        <button type="button" disabled={pending} className="text-red-700 underline dark:text-red-400"
          onClick={() => confirm(`Cancel the invitation for ${email}?`) && start(async () => setResult(await revokeInvitation({ id })))}>
          Cancel
        </button>
      </span>
      <Result result={result} />
    </div>
  );
}
