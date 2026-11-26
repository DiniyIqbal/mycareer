import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getOrganisationBySlug, listPublishedJobs } from "@/lib/jobs/queries";
import { EMPLOYMENT_TYPE_LABEL, WORKPLACE_LABEL } from "@/lib/jobs/types";

type Props = PageProps<"/careers/[org]">;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { org: slug } = await props.params;
  const org = await getOrganisationBySlug(slug);
  if (!org) return {};
  return { title: `Careers at ${org.name}`, description: `Open positions at ${org.name}.` };
}

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

const field = "rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

export default function CareersPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading jobs…</p>}>
        <Careers {...props} />
      </Suspense>
    </main>
  );
}

async function Careers(props: Props) {
  const { org: slug } = await props.params;
  const search = await props.searchParams;
  const org = await getOrganisationBySlug(slug);
  if (!org) notFound();

  const type = first(search.type);
  const filters = {
    q: first(search.q),
    location: first(search.location),
    type: type && type in EMPLOYMENT_TYPE_LABEL ? type : undefined,
  };
  const jobs = await listPublishedJobs(org.id, filters);

  return (
    <>
      <header className="mb-8">
        <p className="text-sm text-zinc-500">Careers</p>
        <h1 className="text-3xl font-semibold tracking-tight">Work at {org.name}</h1>
      </header>

      <form className="mb-8 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]" role="search">
        <label className="sr-only" htmlFor="q">Job title</label>
        <input id="q" name="q" defaultValue={filters.q} placeholder="Job title" className={field} />
        <label className="sr-only" htmlFor="location">Location</label>
        <input id="location" name="location" defaultValue={filters.location} placeholder="Location" className={field} />
        <label className="sr-only" htmlFor="type">Job type</label>
        <select id="type" name="type" defaultValue={filters.type ?? ""} className={field}>
          <option value="">All types</option>
          {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-zinc-900">
          Search
        </button>
      </form>

      {jobs.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No open positions match your search.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link href={`/careers/${org.slug}/jobs/${job.id}`}
                className="block py-4 hover:bg-zinc-50 focus-visible:outline-2 dark:hover:bg-zinc-900">
                <h2 className="font-medium">{job.title}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {[job.location, WORKPLACE_LABEL[job.workplace_type], EMPLOYMENT_TYPE_LABEL[job.employment_type]]
                    .filter(Boolean).join(" · ")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
