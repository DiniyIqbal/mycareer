"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/settings/team", label: "Team" },
  { href: "/app/settings/templates", label: "Email templates" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="mb-6 flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined}
          className="-mb-px border-b-2 border-transparent px-1 pb-2 text-sm aria-[current=page]:border-zinc-900 aria-[current=page]:font-medium dark:aria-[current=page]:border-white">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
