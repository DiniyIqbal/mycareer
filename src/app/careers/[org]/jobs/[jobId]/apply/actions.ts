"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import {
  applicantInput,
  detectResumeKind,
  isValidTimeZone,
  MAX_RESUME_BYTES,
  RESUME_TYPES,
  resumeProblem,
  validateAnswers,
} from "@/lib/applications/validate";
import type { ScreeningQuestion } from "@/lib/jobs/schema";
import { deliverMessage } from "@/lib/messages/deliver";
import { createAdminClient } from "@/lib/supabase/admin";

export type ApplyState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Record<string, string> }
  | { status: "success"; email: string };

const fail = (message: string, fieldErrors: Record<string, string> = {}): ApplyState => ({
  status: "error",
  message,
  fieldErrors,
});

const CLOSED = "Sorry, this job is no longer accepting applications.";

/**
 * Public job application (AP-03). Anyone can call this, so everything is
 * checked here: the job is re-read fresh (not from the careers cache), the
 * answers are checked against the job's questions and the resume is
 * identified from its bytes. Writes go through the service role because
 * applicants have no account; `submit_application` does them in one
 * transaction.
 */
export async function applyForJob(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  // Honeypot: real people never see this field. Pretend it worked.
  if (String(formData.get("website") ?? "") !== "") {
    return { status: "success", email: String(formData.get("email") ?? "") };
  }

  const jobId = String(formData.get("job_id") ?? "");
  const orgSlug = String(formData.get("org_slug") ?? "");
  if (!z.uuid().safeParse(jobId).success) return fail(CLOSED);

  const db = createAdminClient();
  const { data: job, error: jobError } = await db
    .from("jobs")
    .select("id, org_id, status, closes_at, screening_questions, organisations!inner(slug)")
    .eq("id", jobId)
    .eq("organisations.slug", orgSlug)
    .maybeSingle();
  if (jobError) {
    console.error("[apply] job lookup failed:", jobError);
    return fail("Something went wrong. Please try again.");
  }
  if (!job || job.status !== "published" || (job.closes_at && Date.parse(job.closes_at) <= Date.now())) {
    return fail(CLOSED);
  }

  // Field checks
  const parsed = applicantInput.safeParse({
    full_name: formData.get("full_name") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    consent: formData.get("consent") ?? undefined,
    notice_id: formData.get("notice_id") ?? undefined,
    timezone: formData.get("timezone") ?? undefined,
    source: formData.get("source") ?? undefined,
  });
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) {
    for (const [field, messages] of Object.entries(z.flattenError(parsed.error).fieldErrors)) {
      if (messages?.[0]) fieldErrors[field] = messages[0];
    }
  }

  const { answers, errors: answerErrors } = validateAnswers(
    (job.screening_questions ?? []) as ScreeningQuestion[],
    (field) => {
      const v = formData.get(field);
      return typeof v === "string" ? v : null;
    },
  );
  Object.assign(fieldErrors, answerErrors);

  const file = formData.get("resume");
  const resume = file instanceof File ? file : null;
  const fileProblem = resumeProblem(resume);
  if (fileProblem) fieldErrors.resume = fileProblem;

  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return fail("Please fix the highlighted fields.", fieldErrors);
  }
  const input = parsed.data;

  // Identify the resume from its contents.
  const bytes = new Uint8Array(await resume!.arrayBuffer());
  const kind = bytes.byteLength <= MAX_RESUME_BYTES ? detectResumeKind(bytes) : null;
  if (!kind) {
    return fail("Please fix the highlighted fields.", {
      resume: "This file does not look like a PDF or Word (.docx) document. Try saving it again as PDF.",
    });
  }

  // Upload first, outside the transaction; removed again if the insert fails.
  const path = `${job.org_id}/${job.id}/${randomUUID()}.${kind}`;
  const upload = await db.storage
    .from("resumes")
    .upload(path, bytes, { contentType: RESUME_TYPES[kind], upsert: false });
  if (upload.error) {
    console.error("[apply] resume upload failed:", upload.error);
    return fail("We could not upload your resume. Please try again.");
  }

  const { data: result, error } = await db.rpc("submit_application", {
    p_job_id: job.id,
    p_email: input.email,
    p_full_name: input.full_name,
    p_phone: input.phone,
    p_timezone: isValidTimeZone(input.timezone) ? input.timezone : "",
    p_locale: "en",
    p_source: input.source,
    p_answers: answers,
    p_notice_id: input.notice_id,
    p_file_path: path,
    p_file_name: resume!.name,
    p_file_mime: RESUME_TYPES[kind],
    p_file_size: bytes.byteLength,
  });

  if (error) {
    await db.storage.from("resumes").remove([path]);
    if (error.code === "23505") {
      return fail("You have already applied for this job with this email address. We will be in touch.");
    }
    if (error.code === "P0001") return fail(CLOSED);
    if (error.code === "22023") return fail("The privacy notice has changed. Refresh the page and try again.");
    console.error("[apply] submit_application failed:", error);
    return fail("Something went wrong. Please try again.");
  }

  // Confirmation email (AP-04), sent after the response so the applicant is
  // not kept waiting. If it fails it stays queued for a retry.
  const messageId = (result as { message_id: string }).message_id;
  after(async () => {
    try {
      const outcome = await deliverMessage(messageId);
      if (outcome !== "sent") console.warn(`[apply] confirmation email ${messageId}: ${outcome}`);
    } catch (e) {
      console.error("[apply] confirmation email error:", e);
    }
  });

  return { status: "success", email: input.email };
}
