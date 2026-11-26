const STAGE_STYLE: Record<string, string> = {
  new: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  under_review: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  assessment: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  shortlisted: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  interview: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  offer: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  hired: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  rejected: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  withdrawn: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/** "careers_page" → "Careers page", "linkedin" → "Linkedin" (from ?src=). */
export function sourceLabel(source: string) {
  return source === "careers_page" ? "Careers page" : source.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function StageBadge({ name, kind }: { name: string; kind: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLE[kind] ?? STAGE_STYLE.new}`}>
      {name}
    </span>
  );
}
