import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getConsentNotice, getOrganisationBySlug } from "@/lib/jobs/queries";
import { RequestForm } from "./request-form";

type Props = PageProps<"/careers/[org]/privacy">;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const org = await getOrganisationBySlug((await props.params).org);
  return org ? { title: `Your data · ${org.name}`, robots: { index: false } } : {};
}

export default function PrivacyPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Privacy params={props.params} />
      </Suspense>
    </main>
  );
}

async function Privacy({ params }: Pick<Props, "params">) {
  const org = await getOrganisationBySlug((await params).org);
  if (!org) notFound();
  const notice = await getConsentNotice(org.id, "en");

  return (
    <>
      <Link href={`/careers/${org.slug}`} className="text-sm text-zinc-500 hover:underline">← Jobs at {org.name}</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Your data</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Under Malaysia&apos;s Personal Data Protection Act you can ask {org.name} for a copy of the personal data it
        holds about you from job applications, ask for it to be corrected, or ask for it to be deleted.
      </p>

      {notice && (
        <details className="mt-6 rounded-md border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">Privacy notice</summary>
          <p className="mt-2 whitespace-pre-line leading-6">{notice.body}</p>
        </details>
      )}

      <section aria-labelledby="request" className="mt-8">
        <h2 id="request" className="mb-4 text-lg font-semibold">Make a request</h2>
        <RequestForm orgSlug={org.slug} />
      </section>
    </>
  );
}
