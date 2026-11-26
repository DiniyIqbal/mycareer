export const REQUEST_KINDS = [
  { value: "export", label: "Get a copy of my data", short: "Access / copy" },
  { value: "correct", label: "Correct my data", short: "Correction" },
  { value: "delete", label: "Delete my data", short: "Deletion" },
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number]["value"];

export const kindLabel = (kind: string) => REQUEST_KINDS.find((k) => k.value === kind)?.short ?? kind;

/** PDPA 2010 s.31/s.35: respond to access and correction requests within 21 days. */
export const RESPONSE_DAYS = 21;
export const VERIFY_HOURS = 24;
export const EXPORT_LINK_DAYS = 7;
/** Unverified requests allowed per email per organisation per day (anti-abuse). */
export const MAX_REQUESTS_PER_DAY = 3;
