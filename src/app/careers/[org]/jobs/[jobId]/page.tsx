import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { publicEnv } from "@/lib/env";
import { jobPostingJsonLd, serializeJsonLd } from "@/lib/jobs/json-ld";
import { getOrganisationBySlug, getPublishedJob } from "@/lib/jobs/queries";
import { EMPLOYMENT_TYPE_LABEL, WORKPLACE_LABEL } from "@/lib/jobs/types";
import { ApplyLink, ApplyLinkFallback } from "./apply-link";

// Cached via `use cache` in the queries (ISR with Cache Components). Crawlers
// such as Googlebot get a fully rendered page, including the JSON-LD.

type Props = PageProps<"/careers/[org]/jobs/[jobId]">;

async function load(params: Props["params"]) {
  const { org: slug, jobId } = await params;
  const org = await getOrganisationBySlug(slug);
  if (!org) return null;
  const job = await getPublishedJob(org.id, jobId);
  return job ? { org, job, url: `${publicEnv.siteUrl()}/careers/${org.slug}/jobs/${job.id}` } : null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const data = await load(props.params);
  if (!data) return {};
  const { org, job, url } = data;
  return {
    title: `${job.title} at ${org.name}`,
    description: job.description.slice(0, 160),
    alternates: { canonical: url },
    openGraph: { title: `${job.title} at ${org.name}`, url, type: "website" },
  };
}

function formatSalary(min: number | null, max: number | null, currency: string, period: string | null) {
  if (!period || (min == null && max == null)) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-MY", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  const range = min != null && max != null ? `${fmt(min)} – ${fmt(max)}` : fmt((min ?? max)!);
  return `${range} per ${period}`;
}

export default function JobPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading job…</p>}>
        <JobDetails params={props.params} />
      </Suspense>
    </main>
  );
}

async function JobDetails({ params }: Pick<Props, "params">) {
  const data = await load(params);
  if (!data) notFound();
  const { org, job, url } = data;
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_period);
  const applyHref = `/careers/${org.slug}/jobs/${job.id}/apply`;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jobPostingJsonLd(job, org, url)) }}
      />
      <Link href={`/careers/${org.slug}`} className="text-sm text-zinc-500 hover:underline">
        ← All jobs at {org.name}
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{job.title}</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        {[job.location, WORKPLACE_LABEL[job.workplace_type], EMPLOYMENT_TYPE_LABEL[job.employment_type], salary]
          .filter(Boolean).join(" · ")}
      </p>
      <Apply href={applyHref} />
      <article className="mt-8 whitespace-pre-line leading-7">{job.description}</article>
      <div className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <Apply href={applyHref} />
      </div>
    </>
  );
}

const applyClass =
  "inline-block w-full rounded-md bg-zinc-900 px-6 py-3 text-center font-medium text-white sm:w-auto dark:bg-white dark:text-zinc-900";

function Apply({ href }: { href: string }) {
  return (
    <div className="mt-6">
      <Suspense fallback={<ApplyLinkFallback href={href} className={applyClass} />}>
        <ApplyLink href={href} className={applyClass} />
      </Suspense>
    </div>
  );
}
