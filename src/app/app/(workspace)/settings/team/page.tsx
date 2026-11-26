import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { formatDate, isPast } from "@/lib/dates";
import { memberName } from "@/lib/notes/mentions";
import { createClient } from "@/lib/supabase/server";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/team/roles";
import { InviteForm, MemberControls, RevokeButton } from "./team-controls";

export default function TeamPage() {
  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
      <Suspense fallback={<p className="mt-4 text-zinc-500">Loading team…</p>}>
        <Team />
      </Suspense>
    </main>
  );
}

async function Team() {
  const m = await requireMembership();
  if (!isHr(m)) redirect("/app");
  const isAdmin = m.role === "admin";

  const supabase = await createClient();
  const [members, invitations, assignments] = await Promise.all([
    supabase.from("members").select("user_id, full_name, email, role, created_at").eq("org_id", m.orgId).order("created_at"),
    // RLS: admins only; others get an empty list.
    supabase.from("invitations").select("id, email, role, created_at, expires_at")
      .eq("org_id", m.orgId).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
    supabase.from("job_assignments").select("user_id").eq("org_id", m.orgId),
  ]);
  for (const r of [members, invitations, assignments]) if (r.error) throw r.error;

  const jobCount = new Map<string, number>();
  for (const a of assignments.data ?? []) jobCount.set(a.user_id, (jobCount.get(a.user_id) ?? 0) + 1);
  const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

  return (
    <>
      <p className="mb-6 mt-1 text-zinc-600 dark:text-zinc-400">
        {isAdmin ? "Invite colleagues and choose what they can do." : "People in your organisation. Only Org Admins can change the team."}
      </p>

      {isAdmin && (
        <section aria-labelledby="invite" className="mb-8 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 id="invite" className="mb-3 font-semibold">Invite someone</h2>
          <InviteForm roles={roleOptions} />
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            {ROLES.map((r) => (
              <div key={r}>
                <dt className="font-medium">{ROLE_LABEL[r]}</dt>
                <dd className="text-zinc-600 dark:text-zinc-400">{ROLE_DESCRIPTION[r]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <h2 className="mb-3 font-semibold">Members ({members.data?.length ?? 0})</h2>
      <ul className="mb-8 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {(members.data ?? []).map((x) => (
          <li key={x.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {memberName(x)} {x.user_id === m.userId && <span className="text-sm font-normal text-zinc-500">(you)</span>}
              </p>
              <p className="truncate text-sm text-zinc-500">
                {x.email} · joined {formatDate(x.created_at, m.orgTimezone)}
                {x.role === "hiring_manager" && ` · ${jobCount.get(x.user_id) ?? 0} assigned job${jobCount.get(x.user_id) === 1 ? "" : "s"}`}
              </p>
            </div>
            {isAdmin ? (
              <MemberControls userId={x.user_id} name={memberName(x)} role={x.role} isSelf={x.user_id === m.userId} roles={roleOptions} />
            ) : (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{ROLE_LABEL[x.role as keyof typeof ROLE_LABEL]}</span>
            )}
          </li>
        ))}
      </ul>

      {isAdmin && (
        <>
          <h2 className="mb-3 font-semibold">Pending invitations</h2>
          {invitations.data?.length ? (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {invitations.data.map((inv) => {
                const expired = isPast(inv.expires_at);
                return (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{inv.email}</p>
                      <p className={`text-sm ${expired ? "text-red-700 dark:text-red-400" : "text-zinc-500"}`}>
                        {ROLE_LABEL[inv.role as keyof typeof ROLE_LABEL]} · {expired ? "expired" : "expires"} {formatDate(inv.expires_at, m.orgTimezone)}
                      </p>
                    </div>
                    <RevokeButton id={inv.id} email={inv.email} role={inv.role} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">None.</p>
          )}
        </>
      )}
    </>
  );
}
