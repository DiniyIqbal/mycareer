/** ISO timestamp for 23:59:59 on `ymd` (YYYY-MM-DD) in the given IANA zone. */
export function endOfDayInZone(ymd: string, timeZone: string): string {
  return zonedTimeToIso(ymd, 23, 59, 59, timeZone);
}

/** Hour of day (0–23) at `date` in the given zone. */
export function hourInZone(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date),
  );
}

/** ISO timestamp for a wall-clock time on `ymd` in the given IANA zone. */
export function zonedTimeToIso(ymd: string, h: number, min: number, s: number, timeZone: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min, s);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asZone = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (asZone - guess)).toISOString();
}

/** YYYY-MM-DD of an ISO timestamp as seen in the given zone (for date inputs). */
export function dateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-MY", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}
