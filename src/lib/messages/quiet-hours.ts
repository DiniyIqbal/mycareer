import { dateInZone, hourInZone, zonedTimeToIso } from "@/lib/dates";

/** PRD §8: automated messages go out 8am–9pm in the candidate's local time. */
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 21;

/**
 * null when `now` is inside the sending window, otherwise the ISO time the
 * window next opens (08:00 local, today or tomorrow).
 */
export function nextSendTime(now: Date, timeZone: string): string | null {
  const hour = hourInZone(now, timeZone);
  if (hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR) return null;
  // Before 8am: today. After 9pm: tomorrow (12h on is safely the next local day).
  const day = hour < SEND_FROM_HOUR ? now : new Date(now.getTime() + 12 * 3600_000);
  return zonedTimeToIso(dateInZone(day.toISOString(), timeZone), SEND_FROM_HOUR, 0, 0, timeZone);
}
