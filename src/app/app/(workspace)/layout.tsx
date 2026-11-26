import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { requireMembership } from "@/lib/auth/membership";

const ROLE_LABEL = { admin: "Org Admin", recruiter: "Recruiter", hiring_manager: "Hiring Manager" } as const;

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
  return (
    <>
      <Link href="/app" className="font-semibold">{m.orgName}</Link>
      <div className="flex items-center gap-4 text-sm">
        <Link href={`/careers/${m.orgSlug}`} className="text-zinc-600 hover:underline dark:text-zinc-400">
          Careers page
        </Link>
        <span className="text-zinc-500">{ROLE_LABEL[m.role]}</span>
        <form action={signOut}><button className="underline">Sign out</button></form>
      </div>
    </>
  );
}
