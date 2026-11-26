/** System email templates HR can edit (HR-08). Order = order on the page. */
export const SYSTEM_TEMPLATES = [
  {
    key: "application_received",
    label: "Application received",
    when: "Sent right after someone applies. Always on: applicants need a confirmation.",
    stageKind: null,
  },
  {
    key: "interview_invite",
    label: "Interview invitation",
    when: "Sent when a candidate is moved to Interview.",
    stageKind: "interview",
  },
  {
    key: "offer_pending",
    label: "Offer update",
    when: "Sent when a candidate is moved to Offer.",
    stageKind: "offer",
  },
  {
    key: "rejected",
    label: "Not progressing",
    when: "Sent when a candidate is moved to Rejected. Moving them back before it goes out cancels it.",
    stageKind: "rejected",
  },
] as const;

export type TemplateKey = (typeof SYSTEM_TEMPLATES)[number]["key"];
export const TEMPLATE_KEYS = SYSTEM_TEMPLATES.map((t) => t.key) as [TemplateKey, ...TemplateKey[]];

export const LOCALES = [
  { code: "en", label: "English" },
  { code: "ms", label: "Bahasa Melayu" },
] as const;
export type Locale = (typeof LOCALES)[number]["code"];

/** Placeholders the sender fills in (see deliverMessage). */
export const TEMPLATE_VARIABLES = [
  { name: "candidate_name", example: "Nur Aisyah" },
  { name: "job_title", example: "Customer Service Executive" },
  { name: "company_name", example: "Your company" },
] as const;

export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

/** {{placeholders}} in the text that the sender does not know about. */
export function unknownVariables(text: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.name));
  const found = [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((name) => !known.has(name)))];
}

export function sampleVariables(companyName: string): Record<string, string> {
  return Object.fromEntries(
    TEMPLATE_VARIABLES.map((v) => [v.name, v.name === "company_name" ? companyName : v.example]),
  );
}
