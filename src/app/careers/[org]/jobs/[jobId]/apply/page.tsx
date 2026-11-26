import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getConsentNotice, getOrganisationBySlug, getPublishedJob } from "@/lib/jobs/queries";
import { ApplyForm } from "./apply-form";

type Props = PageProps<"/careers/[org]/jobs/[jobId]/apply">;

async function load(params: Props["params"]) {
  const { org: slug, jobId } = await params;
  const org = await getOrganisationBySlug(slug);
  if (!org) return null;
  const [job, notice] = await Promise.all([getPublishedJob(org.id, jobId), getConsentNotice(org.id, "en")]);
  return job ? { org, job, notice } : null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const data = await load(props.params);
  if (!data) return {};
  // The job page is the one to index; this is just its form.
  return { title: `Apply: ${data.job.title} at ${data.org.name}`, robots: { index: false } };
}

export default function ApplyPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading application form…</p>}>
        <Apply params={props.params} />
      </Suspense>
    </main>
  );
}

async function Apply({ params }: Pick<Props, "params">) {
  const data = await load(params);
  if (!data) notFound();
  const { org, job, notice } = data;

  return (
    <>
      <Link href={`/careers/${org.slug}/jobs/${job.id}`} className="text-sm text-zinc-500 hover:underline">
        ← Back to job details
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Apply for {job.title}</h1>
      <p className="mb-8 mt-1 text-zinc-600 dark:text-zinc-400">{org.name} · {job.location}</p>
      {notice ? (
        <ApplyForm
          orgSlug={org.slug}
          orgName={org.name}
          jobId={job.id}
          jobTitle={job.title}
          questions={job.screening_questions ?? []}
          notice={notice}
        />
      ) : (
        // PDPA: no notice, no collection.
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          Applications are temporarily unavailable for this job. Please try again later.
        </p>
      )}
    </>
  );
}
