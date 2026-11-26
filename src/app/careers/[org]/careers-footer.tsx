import Link from "next/link";

/** On every careers page: how candidates reach their PDPA rights (AP-05). */
export async function CareersFooter({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return (
    <FooterShell>
      <Link href={`/careers/${encodeURIComponent(org)}/privacy`} className="underline">Your data and privacy</Link>
    </FooterShell>
  );
}

export function FooterShell({ children }: { children?: React.ReactNode }) {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-between gap-3 px-4 py-6 text-sm text-zinc-600 dark:text-zinc-400">
        <span>{children}</span>
        <span>Powered by MyCareer</span>
      </div>
    </footer>
  );
}
