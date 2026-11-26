"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Apply button that carries the ?src= tracking parameter to the form (PRD §10). */
export function ApplyLink({ href, className }: { href: string; className?: string }) {
  const src = useSearchParams().get("src");
  return (
    <Link href={src ? `${href}?src=${encodeURIComponent(src)}` : href} className={className}>
      Apply now
    </Link>
  );
}

export function ApplyLinkFallback({ href, className }: { href: string; className?: string }) {
  return <Link href={href} className={className}>Apply now</Link>;
}
