import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_JOB, JobForm } from "../job-form";

export default function NewJobPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <NewJob />
    </Suspense>
  );
}

async function NewJob() {
  const m = await requireMembership();
  if (!isHr(m)) redirect("/app/jobs");

  const supabase = await createClient();
  const { data: departments } = await supabase
    .from("departments")
    .select("name")
    .eq("org_id", m.orgId)
    .order("name");

  return (
    <main className="max-w-3xl">
      <Link href="/app/jobs" className="text-sm text-zinc-500 hover:underline">← Jobs</Link>
      <h1 className="mb-2 mt-2 text-2xl font-semibold tracking-tight">New job</h1>
      <p className="mb-8 text-zinc-600 dark:text-zinc-400">
        Save it as a draft first. You can publish it to your careers page once it is ready.
      </p>
      <JobForm initial={EMPTY_JOB} departments={(departments ?? []).map((d) => d.name)} />
    </main>
  );
}
