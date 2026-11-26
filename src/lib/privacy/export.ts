import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const RESUME_LINK_SECONDS = 60 * 60;

/**
 * Everything we hold about a candidate, for an access request (AP-05).
 * Uses candidate-facing stage names. Internal HR notes and rejection reasons
 * are left out: whether they must be disclosed is a legal call (see README).
 * Resume links in the file are signed and expire after an hour.
 */
export async function buildCandidateExport(orgId: string, candidateId: string) {
  const db = createAdminClient();
  const [org, candidate, apps, consents] = await Promise.all([
    db.from("organisations").select("name").eq("id", orgId).single(),
    db.from("candidates").select("full_name, email, phone, timezone, locale, created_at")
      .eq("org_id", orgId).eq("id", candidateId).maybeSingle(),
    db.from("applications")
      .select(`id, submitted_at, source, answers,
               jobs(title), pipeline_stages(public_label),
               candidate_files(storage_path, original_name, mime_type, size_bytes, created_at)`)
      .eq("org_id", orgId).eq("candidate_id", candidateId).order("submitted_at"),
    db.from("consent_records").select("purpose, given_at, withdrawn_at, consent_notices(version, locale, body)")
      .eq("org_id", orgId).eq("candidate_id", candidateId).order("given_at"),
  ]);
  for (const r of [org, candidate, apps, consents]) if (r.error) throw r.error;
  if (!candidate.data) return null;

  const appIds = (apps.data ?? []).map((a) => a.id);
  const [history, messages, stages] = await Promise.all([
    db.from("stage_history").select("application_id, to_stage_id, changed_at").in("application_id", appIds).order("changed_at"),
    db.from("messages").select("application_id, subject, body, status, sent_at").in("application_id", appIds).eq("status", "sent").order("sent_at"),
    db.from("pipeline_stages").select("id, public_label").eq("org_id", orgId),
  ]);
  for (const r of [history, messages, stages]) if (r.error) throw r.error;
  const label = new Map((stages.data ?? []).map((s) => [s.id, s.public_label]));

  const applications = await Promise.all((apps.data ?? []).map(async (a) => {
    const file = a.candidate_files as unknown as {
      storage_path: string; original_name: string; mime_type: string; size_bytes: number; created_at: string;
    } | null;
    let downloadUrl: string | null = null;
    if (file) {
      const { data } = await db.storage.from("resumes").createSignedUrl(file.storage_path, RESUME_LINK_SECONDS, { download: file.original_name });
      downloadUrl = data?.signedUrl ?? null;
    }
    return {
      job: (a.jobs as unknown as { title: string } | null)?.title ?? null,
      submitted_at: a.submitted_at,
      source: a.source,
      current_status: (a.pipeline_stages as unknown as { public_label: string } | null)?.public_label ?? null,
      answers: Object.values((a.answers ?? {}) as Record<string, { question: string; answer: string }>),
      status_history: (history.data ?? []).filter((h) => h.application_id === a.id)
        .map((h) => ({ status: label.get(h.to_stage_id) ?? null, at: h.changed_at })),
      emails_sent_to_you: (messages.data ?? []).filter((m) => m.application_id === a.id)
        .map((m) => ({ subject: m.subject, body: m.body, sent_at: m.sent_at })),
      resume: file && {
        file_name: file.original_name,
        type: file.mime_type,
        size_bytes: file.size_bytes,
        uploaded_at: file.created_at,
        download_url: downloadUrl,
        download_url_expires_in: "1 hour from when this file was generated",
      },
    };
  }));

  return {
    generated_at: new Date().toISOString(),
    organisation: org.data?.name ?? null,
    about: "Personal data held about you by this organisation through its MyCareer careers site.",
    you: candidate.data,
    applications,
    consents: (consents.data ?? []).map((c) => {
      const n = c.consent_notices as unknown as { version: number; locale: string; body: string } | null;
      return { purpose: c.purpose, given_at: c.given_at, withdrawn_at: c.withdrawn_at, notice_version: n?.version, notice_language: n?.locale, notice_text: n?.body };
    }),
  };
}
