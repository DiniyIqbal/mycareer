import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { PUBLIC_JOB_COLUMNS, type ConsentNotice, type PublicJob, type PublicOrganisation } from "./types";

// Public careers data is cached (PRD §13: pages load in < 3s on 4G).
// HR actions that publish/close/edit a job must call
// revalidateTag(careersTag(orgId), 'max') so changes appear immediately.
export const careersTag = (orgId: string) => `careers:${orgId}`;

export async function getOrganisationBySlug(slug: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`org-slug:${slug}`);

  const { data, error } = await createPublicClient()
    .from("organisations")
    .select("id, name, slug, logo_path, website")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data as PublicOrganisation | null;
}

export async function listPublishedJobs(
  orgId: string,
  filters: { q?: string; type?: string; location?: string },
) {
  "use cache";
  cacheLife("minutes");
  cacheTag(careersTag(orgId));

  let query = createPublicClient()
    .from("jobs")
    .select(PUBLIC_JOB_COLUMNS)
    .eq("org_id", orgId)
    .order("published_at", { ascending: false })
    .limit(100);

  if (filters.type) query = query.eq("employment_type", filters.type);
  if (filters.location) query = query.ilike("location", `%${escapeLike(filters.location)}%`);
  if (filters.q) query = query.ilike("title", `%${escapeLike(filters.q)}%`);

  const { data, error } = await query;
  if (error) throw error;
  // RLS returns only published jobs; also hide ones past their closing date.
  const now = Date.now();
  return (data as PublicJob[]).filter((j) => !j.closes_at || Date.parse(j.closes_at) > now);
}

export async function getPublishedJob(orgId: string, jobId: string) {
  "use cache";
  cacheLife("minutes");
  cacheTag(careersTag(orgId));

  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const { data, error } = await createPublicClient()
    .from("jobs")
    .select(PUBLIC_JOB_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data as PublicJob | null;
}

/** Latest published privacy notice for job applications (PDPA). */
export async function getConsentNotice(orgId: string, locale: "en" | "ms" = "en") {
  "use cache";
  cacheLife("minutes");
  cacheTag(`consent:${orgId}`);

  const { data, error } = await createPublicClient()
    .from("consent_notices")
    .select("id, version, locale, body")
    .eq("org_id", orgId)
    .eq("purpose", "application")
    .in("locale", locale === "en" ? ["en"] : [locale, "en"])
    .order("version", { ascending: false })
    .limit(2);
  if (error) throw error;
  // Prefer the requested language, fall back to English.
  return ((data ?? []).find((n) => n.locale === locale) ?? data?.[0] ?? null) as ConsentNotice | null;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_,()]/g, (c) => `\\${c}`).slice(0, 100);
}
