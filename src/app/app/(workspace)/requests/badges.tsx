import { daysUntil } from "@/lib/privacy/dates";

/** Days left until the PDPA deadline; red when overdue or close. */
export function DueBadge({ dueAt, label }: { dueAt: string; label: string }) {
  const days = daysUntil(dueAt);
  const tone = days < 0 ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
    : days <= 5 ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  const text = days < 0 ? `Overdue by ${-days} day${days === -1 ? "" : "s"}` : days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`;
  return <span title={`Due ${label}`} className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{text}</span>;
}

export function StatusLabel({ status }: { status: string }) {
  const text = status === "completed" ? "Completed" : status === "rejected" ? "Declined" : status === "open" ? "Open" : "Unconfirmed";
  return <span className="text-sm text-zinc-600 dark:text-zinc-400">{text}</span>;
}
