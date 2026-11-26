import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/team/roles";


export default function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Suspense fallback={<span className="font-semibold">MyCareer</span>}>
            <WorkspaceNav />
          </Suspense>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>{children}</Suspense>
      </div>
    </div>
  );
}

async function WorkspaceNav() {
  const m = await requireMembership();
  const supabase = await createClient();
  const [{ count }, { count: openRequests }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", m.userId).is("read_at", null),
    // RLS: HR only; hiring managers get 0.
    supabase.from("data_requests").select("id", { count: "exact", head: true }).eq("org_id", m.orgId).eq("status", "open"),
  ]);
  const unread = count ?? 0;
  return (
    <>
      <nav className="flex items-center gap-5">
        <Link href="/app" className="font-semibold">{m.orgName}</Link>
        <Link href="/app" className="text-sm hover:underline">Dashboard</Link>
        <Link href="/app/jobs" className="text-sm hover:underline">Jobs</Link>
        <Link href="/app/candidates" className="text-sm hover:underline">Candidates</Link>
        {isHr(m) && (
          <Link href="/app/requests" className="text-sm hover:underline">
            Data requests{openRequests ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{openRequests}</span> : null}
          </Link>
        )}
        {isHr(m) && <Link href="/app/settings/team" className="text-sm hover:underline">Settings</Link>}
      </nav>
      <div className="flex items-center gap-4 text-sm">
        <Link href="/app/notifications" className="relative hover:underline"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {unread > 0 && (
            <span className="absolute -right-2 -top-1.5 rounded-full bg-sky-600 px-1.5 text-[10px] font-semibold leading-4 text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
        <Link href={`/careers/${m.orgSlug}`} className="text-zinc-600 hover:underline dark:text-zinc-400">
          Careers page
        </Link>
        <span className="text-zinc-500">{ROLE_LABEL[m.role]}</span>
        <form action={signOut}><button className="underline">Sign out</button></form>
      </div>
    </>
  );
}
