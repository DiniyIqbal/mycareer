"use server";

import { formatDate } from "@/lib/dates";
import { addDays } from "@/lib/privacy/dates";
import { RESPONSE_DAYS } from "@/lib/privacy/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, isTokenShaped } from "@/lib/tokens";

export type VerifyState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "confirmed"; dueLabel: string; noData: boolean };

/**
 * Confirms a data request from the emailed link (a button press, so email
 * scanners that open links do not confirm it). Links the request to the
 * candidate with that email; if there is none, the request is closed with
 * "no data held" and the person is told so (they have proved they own the
 * address, so this reveals nothing to anyone else).
 */
export async function confirmRequest(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const token = String(formData.get("token") ?? "");
  if (!isTokenShaped(token)) return { status: "error", message: "This link is not valid." };

  const db = createAdminClient();
  const { data: req } = await db.from("data_requests")
    .select("id, org_id, email, kind, status, token_expires_at, organisations(timezone)")
    .eq("token_hash", hashToken(token)).maybeSingle();
  if (!req) return { status: "error", message: "This link is not valid." };
  if (req.status !== "unverified") return { status: "error", message: "This request has already been confirmed." };
  if (!req.token_expires_at || Date.parse(req.token_expires_at) < Date.now()) {
    return { status: "error", message: "This link has expired. Please make the request again." };
  }

  const { data: candidate } = await db.from("candidates").select("id").eq("org_id", req.org_id).eq("email", req.email).maybeSingle();
  const now = new Date();
  const dueAt = addDays(now, RESPONSE_DAYS).toISOString();
  const update = candidate
    ? { status: "open", candidate_id: candidate.id, verified_at: now.toISOString(), due_at: dueAt, token_hash: null }
    : { status: "completed", verified_at: now.toISOString(), handled_at: now.toISOString(), token_hash: null,
        resolution: "We do not hold any personal data for this email address." };
  const { data: updated, error } = await db.from("data_requests").update(update)
    .eq("id", req.id).eq("status", "unverified").select("id");
  if (error || !updated?.length) return { status: "error", message: "This request has already been confirmed." };

  await db.from("audit_log").insert({ org_id: req.org_id, actor_id: null, action: "data_request.verify", entity: "data_request",
    entity_id: req.id, metadata: { kind: req.kind, matched: !!candidate } });

  if (candidate) {
    // Tell HR (admins and recruiters) a request needs handling.
    const { data: hr } = await db.from("members").select("user_id").eq("org_id", req.org_id).in("role", ["admin", "recruiter"]);
    if (hr?.length) {
      await db.from("notifications").insert(hr.map((m) => ({
        org_id: req.org_id, user_id: m.user_id, kind: "data_request",
        payload: { request_id: req.id, kind: req.kind, due_at: dueAt },
      })));
    }
  }
  const tz = (req.organisations as unknown as { timezone: string } | null)?.timezone ?? "Asia/Kuala_Lumpur";
  return { status: "confirmed", dueLabel: formatDate(dueAt, tz), noData: !candidate };
}
