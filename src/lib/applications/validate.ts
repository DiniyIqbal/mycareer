import { z } from "zod";
import type { ScreeningQuestion } from "@/lib/jobs/schema";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export const RESUME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
export type ResumeKind = keyof typeof RESUME_TYPES;

export const RESUME_ACCEPT = `.pdf,.docx,${RESUME_TYPES.pdf},${RESUME_TYPES.docx}`;

/** Applicant details from the public form (AP-03). */
export const applicantInput = z.object({
  full_name: z
    .string({ error: "Enter your full name" })
    .trim()
    .min(2, "Enter your full name")
    .max(200, "Name is too long"),
  email: z
    .string({ error: "Enter your email address" })
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address, e.g. name@example.com"))
    .refine((v) => v.length <= 254, "Email address is too long"),
  phone: z
    .string()
    .trim()
    .max(30, "Phone number is too long")
    .regex(/^[+\d][\d\s()-]{6,}$|^$/, "Enter a valid phone number, e.g. +60 12-345 6789")
    .default(""),
  consent: z.literal("on", { error: "Please read and agree to the privacy notice to apply" }),
  notice_id: z.uuid({ error: "The privacy notice could not be loaded. Refresh and try again." }),
  timezone: z.string().max(64).default(""),
  source: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => (/^[a-z0-9_-]{1,40}$/.test(v) ? v : "careers_page"))
    .default("careers_page"),
});
export type ApplicantInput = z.infer<typeof applicantInput>;

export const answerField = (id: string) => `q_${id}`;

export type StoredAnswer = { question: string; answer: string };

/**
 * Checks answers against the job's screening questions. Answers are stored
 * with the question text as it was asked, so later edits to the job do not
 * change what the applicant appears to have answered.
 */
export function validateAnswers(
  questions: ScreeningQuestion[],
  get: (field: string) => string | null,
): { answers: Record<string, StoredAnswer>; errors: Record<string, string> } {
  const answers: Record<string, StoredAnswer> = {};
  const errors: Record<string, string> = {};

  for (const q of questions) {
    const field = answerField(q.id);
    const value = (get(field) ?? "").trim();
    if (!value) {
      if (q.required) errors[field] = "This question needs an answer";
      continue;
    }
    if (q.type === "yes_no" && value !== "yes" && value !== "no") {
      errors[field] = "Choose Yes or No";
    } else if (q.type === "choice" && !(q.options ?? []).includes(value)) {
      errors[field] = "Choose one of the options";
    } else if (q.type === "text" && value.length > 2000) {
      errors[field] = "Keep your answer under 2,000 characters";
    } else {
      answers[q.id] = { question: q.label, answer: value };
    }
  }
  return { answers, errors };
}

/** Quick check on the browser's view of the file, before uploading. */
export function resumeProblem(file: { name: string; size: number } | null): string | null {
  if (!file || file.size === 0) return "Attach your resume (PDF or Word .docx)";
  if (file.size > MAX_RESUME_BYTES) return "Your resume must be 10 MB or smaller";
  if (!/\.(pdf|docx)$/i.test(file.name)) return "Upload a PDF or Word (.docx) file";
  return null;
}

/**
 * Identifies the file from its contents, not its name or the browser's MIME
 * type, which applicants (or attackers) control.
 */
export function detectResumeKind(bytes: Uint8Array): ResumeKind | null {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) {
    // A ZIP; a Word document has a word/document.xml entry. Entry names are
    // stored uncompressed in the ZIP directory, so a byte search finds them.
    return indexOf(bytes, "word/document.xml") >= 0 ? "docx" : null;
  }
  return null;
}

function indexOf(haystack: Uint8Array, needle: string): number {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= haystack.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
