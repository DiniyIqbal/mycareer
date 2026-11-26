import { z } from "zod";

export const JOB_STATUSES = ["draft", "published", "closed", "archived"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type ScreeningQuestion = {
  id: string;
  label: string;
  type: "text" | "yes_no" | "choice";
  required: boolean;
  options?: string[];
};

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const screeningQuestion = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    label: z.string().trim().min(1, "Every question needs text").max(300),
    type: z.enum(["text", "yes_no", "choice"]),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1, "Options cannot be empty").max(100)).max(20).optional(),
  })
  .refine((q) => q.type !== "choice" || (q.options?.length ?? 0) >= 2, {
    message: "Multiple-choice questions need at least 2 options",
  })
  .transform((q) => (q.type === "choice" ? q : { ...q, options: undefined }));

/** Fields saved from the job form. A draft needs only a title (HR-02). */
export const jobInput = z
  .object({
    title: z.string({ error: "Enter a job title" }).trim().min(1, "Enter a job title").max(200),
    department: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
    description: z.string().trim().max(20000, "Description is too long").default(""),
    location: z.string().trim().max(200).default(""),
    address_locality: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
    address_region: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
    address_country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use a 2-letter country code, e.g. MY")
      .default("MY"),
    workplace_type: z.enum(["onsite", "hybrid", "remote"]).default("onsite"),
    employment_type: z
      .enum(["full_time", "part_time", "contractor", "temporary", "intern", "other"])
      .default("full_time"),
    salary_min: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(1e9).optional()),
    salary_max: z.preprocess(emptyToUndefined, z.coerce.number().min(0).max(1e9).optional()),
    salary_currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("MYR"),
    salary_period: z.preprocess(emptyToUndefined, z.enum(["hour", "day", "month", "year"]).optional()),
    closes_on: z.preprocess(
      emptyToUndefined,
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid closing date").optional(),
    ),
    screening_questions: z.preprocess((v) => {
      if (typeof v !== "string" || v.trim() === "") return [];
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    }, z.array(screeningQuestion).max(20, "Up to 20 screening questions")),
  })
  .refine((j) => j.salary_min == null || j.salary_max == null || j.salary_min <= j.salary_max, {
    message: "Minimum salary cannot be more than the maximum",
    path: ["salary_max"],
  })
  .refine((j) => (j.salary_min == null && j.salary_max == null) || j.salary_period, {
    message: "Choose how often the salary is paid",
    path: ["salary_period"],
  });

export type JobInput = z.infer<typeof jobInput>;

/** What a job needs before it can be published (Google Jobs + PRD AP-02). */
export function publishProblems(job: {
  title: string;
  description: string;
  workplace_type: string;
  address_locality: string | null;
  closes_at: string | null;
}): string[] {
  const problems: string[] = [];
  if (!job.title.trim()) problems.push("Add a job title.");
  if (job.description.trim().length < 50)
    problems.push("Write a description of at least 50 characters.");
  if (job.workplace_type !== "remote" && !job.address_locality)
    problems.push("Add a city (needed for Google Jobs) or mark the job as remote.");
  if (job.closes_at && Date.parse(job.closes_at) <= Date.now())
    problems.push("The closing date has passed. Choose a later date.");
  return problems;
}

/** Allowed status changes (HR-03). */
export const STATUS_TRANSITIONS: Record<JobStatus, { to: JobStatus; label: string }[]> = {
  draft: [
    { to: "published", label: "Publish" },
    { to: "archived", label: "Archive" },
  ],
  published: [{ to: "closed", label: "Close applications" }],
  closed: [
    { to: "published", label: "Reopen" },
    { to: "archived", label: "Archive" },
  ],
  archived: [{ to: "draft", label: "Restore as draft" }],
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  draft: "Draft",
  published: "Published",
  closed: "Closed",
  archived: "Archived",
};
