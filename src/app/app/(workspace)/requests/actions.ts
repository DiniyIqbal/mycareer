"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { isHr, requireMembership, type Membership } from "@/lib/auth/membership";
import { formatDate } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { addDays } from "@/lib/privacy/dates";
import { buildCandidateExport } from "@/lib/privacy/export";
import { EXPORT_LINK_DAYS } from "@/lib/privacy/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { newToken } from "@/lib/tokens";

export type HandleResult = { ok: true; message: string } | { ok: false; error: string };

type OpenRequest = { id: string; org_id: string; email: string; kind: string; candidate_id: string | null };

/** HR-only, and the request must be open (verified, not yet handled). RLS scopes it to the org. */
async function loadOpen(requestId: string, kind?: string): Promise<{ m: Membership; req: OpenRequest } | HandleResult> {
  const m = await requireMembership();
  if (!isHr(m)) return { ok: false, error: "Only recruiters and admins can handle data requests." };
  if (!z.uuid().safeParse(requestId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data: req } = await supabase.from("data_requests").select("id, org_id, email, kind, candidate_id, status")
    .eq("id", requestId).eq("org_id", m.orgId).maybeSingle();
  if (!req) return { ok: false, error: "This request no longer exists." };
  if (req.status !== "open") return { ok: false, error: "This request has already been handled." };
  if (kind && req.kind !== kind) return { ok: false, error: "That action does not fit this request." };
  return { m, req };
}

async function tellCandidate(to: string, orgName: string, subject: string, lines: string[]) {
  try {
    await sendEmail({ to, subject, text: ["Hi,", "", ...lines, "", orgName].join("\n") });
    return true;
  } catch (e) {
    console.error("[requests] email to candidate failed:", e);
    return false;
  }
}

const emailWarning = (sent: boolean) => (sent ? "" : " The email to the candidate failed; please contact them directly.");

/** Access request: email the candidate a 7-day link to download their data. */
export async function sendExport(input: { requestId: string }): Promise<HandleResult> {
  const loaded = await loadOpen(input.requestId, "export");
  if ("ok" in loaded) return loaded;
  const { m, req } = loaded;
  if (!req.candidate_id || !(await buildCandidateExport(m.orgId, req.candidate_id))) {
    return { ok: false, error: "We no longer hold data for this candidate. Close the request with a note instead." };
  }

  const { token, hash } = newToken();
  const expires = addDays(new Date(), EXPORT_LINK_DAYS);
  const resolution = `A copy of your data was sent to you. The download link works until ${formatDate(expires.toISOString(), m.orgTimezone)}.`;
  const { error } = await createAdminClient().from("data_requests").update({
    export_token_hash: hash, export_expires_at: expires.toISOString(),
    status: "completed", handled_by: m.userId, handled_at: new Date().toISOString(), resolution,
  }).eq("id", req.id).eq("status", "open");
  if (error) {
    console.error("[requests] export failed:", error);
    return { ok: false, error: "Could not create the download link. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "data_request.export", entity: "data_request", entityId: req.id });

  const link = `${publicEnv.siteUrl()}/careers/${m.orgSlug}/privacy/export/${token}`;
  const sent = await tellCandidate(req.email, m.orgName, `Your data from ${m.orgName}`, [
    `As you asked, here is a copy of the personal data ${m.orgName} holds about you from your job applications:`,
    link,
    "",
    `The link works for ${EXPORT_LINK_DAYS} days. The file is in JSON format and opens in any text editor.`,
  ]);
  refresh();
  return { ok: true, message: `Download link sent to ${req.email}.${emailWarning(sent)}` };
}

/** Deletion request: erase the candidate, their applications and resume files. */
export async function eraseData(input: { requestId: string; confirmEmail: string }): Promise<HandleResult> {
  const loaded = await loadOpen(input.requestId, "delete");
  if ("ok" in loaded) return loaded;
  const { m, req } = loaded;
  if (input.confirmEmail.trim().toLowerCase() !== req.email) {
    return { ok: false, error: "Type the candidate's email address exactly to confirm." };
  }

  const supabase = await createClient();
  const { data: paths, error } = await supabase.rpc("erase_candidate", { p_request: req.id });
  if (error) {
    console.error("[requests] erase failed:", error);
    return { ok: false, error: "The data could not be deleted. Please try again." };
  }
  const files = (paths ?? []) as string[];
  if (files.length) {
    const { error: storageError } = await createAdminClient().storage.from("resumes").remove(files);
    if (storageError) console.error("[requests] resume removal failed (records already deleted):", storageError, files);
  }
  const sent = await tellCandidate(req.email, m.orgName, `Your data has been deleted from ${m.orgName}`, [
    `As you asked, we have deleted the personal data ${m.orgName} held about you, including your applications and resume.`,
    `We keep only a record that this request was made and completed, as the law requires.`,
  ]);
  refresh();
  return { ok: true, message: `All data for ${req.email} has been deleted.${emailWarning(sent)}` };
}

const correction = z.object({
  requestId: z.uuid(),
  fullName: z.string().trim().min(2, "Enter the candidate's name").max(200),
  phone: z.string().trim().max(30).regex(/^[+\d][\d\s()-]{6,}$|^$/, "Enter a valid phone number"),
  note: z.string().trim().min(1, "Tell the candidate what was changed").max(2000),
});

/** Correction request: update the candidate's details and tell them what changed. */
export async function completeCorrection(input: z.input<typeof correction>): Promise<HandleResult> {
  const parsed = correction.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid correction." };
  const loaded = await loadOpen(parsed.data.requestId, "correct");
  if ("ok" in loaded) return loaded;
  const { m, req } = loaded;
  if (!req.candidate_id) return { ok: false, error: "We no longer hold data for this candidate. Close the request with a note instead." };

  const supabase = await createClient();
  const { error } = await supabase.from("candidates")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null })
    .eq("id", req.candidate_id).eq("org_id", m.orgId);
  if (error) return { ok: false, error: "The details could not be updated. Please try again." };
  const { error: closeError } = await supabase.from("data_requests").update({
    status: "completed", handled_by: m.userId, handled_at: new Date().toISOString(), resolution: parsed.data.note,
  }).eq("id", req.id).eq("status", "open");
  if (closeError) return { ok: false, error: "Details updated, but the request could not be closed. Please try again." };
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "data_request.correct", entity: "data_request", entityId: req.id,
    metadata: { candidate_id: req.candidate_id } });

  const sent = await tellCandidate(req.email, m.orgName, `Your data has been corrected`, [
    `We have dealt with your request to correct your data:`, "", parsed.data.note,
  ]);
  refresh();
  return { ok: true, message: `Correction saved and ${req.email} has been told.${emailWarning(sent)}` };
}

/** Close a request without the usual action, e.g. nothing held or not possible. Tells the candidate why. */
export async function closeRequest(input: { requestId: string; outcome: "completed" | "rejected"; note: string }): Promise<HandleResult> {
  const note = z.string().trim().min(5, "Explain to the candidate (at least a sentence)").max(2000).safeParse(input.note);
  if (!note.success) return { ok: false, error: note.error.issues[0]?.message ?? "Add a note." };
  if (input.outcome !== "completed" && input.outcome !== "rejected") return { ok: false, error: "Invalid outcome." };
  const loaded = await loadOpen(input.requestId);
  if ("ok" in loaded) return loaded;
  const { m, req } = loaded;

  const supabase = await createClient();
  const { error } = await supabase.from("data_requests").update({
    status: input.outcome, handled_by: m.userId, handled_at: new Date().toISOString(), resolution: note.data,
  }).eq("id", req.id).eq("status", "open");
  if (error) return { ok: false, error: "The request could not be closed. Please try again." };
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: `data_request.${input.outcome === "rejected" ? "decline" : "close"}`,
    entity: "data_request", entityId: req.id });

  const sent = await tellCandidate(req.email, m.orgName, `About your data request to ${m.orgName}`, [
    input.outcome === "rejected" ? "We are unable to carry out your data request:" : "We have dealt with your data request:",
    "", note.data,
  ]);
  refresh();
  return { ok: true, message: `Request closed and ${req.email} has been told.${emailWarning(sent)}` };
}
