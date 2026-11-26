// Hand-written until a Supabase project exists; then replace with
// `npx supabase gen types typescript` output.
import type { ScreeningQuestion } from "./schema";

export type EmploymentType = "full_time" | "part_time" | "contractor" | "temporary" | "intern" | "other";
export type WorkplaceType = "onsite" | "hybrid" | "remote";
export type SalaryPeriod = "hour" | "day" | "month" | "year";

export type PublicOrganisation = {
  id: string;
  name: string;
  slug: string;
  logo_path: string | null;
  website: string | null;
};

export type PublicJob = {
  id: string;
  org_id: string;
  title: string;
  description: string;
  location: string;
  address_locality: string | null;
  address_region: string | null;
  address_country: string;
  workplace_type: WorkplaceType;
  employment_type: EmploymentType;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: SalaryPeriod | null;
  published_at: string;
  closes_at: string | null;
  screening_questions: ScreeningQuestion[] | null;
};

export const PUBLIC_JOB_COLUMNS =
  "id, org_id, title, description, location, address_locality, address_region, address_country, workplace_type, employment_type, salary_min, salary_max, salary_currency, salary_period, published_at, closes_at, screening_questions";

export type ConsentNotice = { id: string; version: number; locale: string; body: string };

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contractor: "Contract",
  temporary: "Temporary",
  intern: "Internship",
  other: "Other",
};

export const WORKPLACE_LABEL: Record<WorkplaceType, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};
