"use server";

import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { kindLabel, MAX_REQUESTS_PER_DAY, REQUEST_KINDS, VERIFY_HOURS } from "@/lib/privacy/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { newToken } from "@/lib/tokens";

export type RequestState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Record<string, string> }
  | { status: "sent"; email: string };

const input = z.object({
  email: z.string({ error: "Enter your email address" }).trim().toLowerCase()
    .pipe(z.email("Enter the email address you applied with")),
  kind: z.enum(REQUEST_KINDS.map((k) => k.value) as ["export", "correct", "delete"], { error: "Choose what you would like us to do" }),
  details: z.string().trim().max(2000, "Keep this under 2,000 characters").default(""),
}).refine((v) => v.kind !== "correct" || v.details.length > 0, {
  message: "Tell us what needs correcting", path: ["details"],
});

/**
 * AP-05: a candidate asks to access, correct or delete their data. The reply
 * is the same whether or not we hold data for the address, so the form cannot
 * be used to find out who applied. A link is emailed to prove the person owns
 * the address; only then does HR see the request.
 */
export async function requestData(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const orgSlug = String(formData.get("org_slug") ?? "");
  const parsed = input.safeParse({
    email: formData.get("email") ?? undefined,
    kind: formData.get("kind") ?? undefined,
    details: formData.get("details") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const [k, v] of Object.entries(z.flattenError(parsed.error).fieldErrors)) if (v?.[0]) fieldErrors[k] = v[0];
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }
  const { email, kind, details } = parsed.data;
  const sent: RequestState = { status: "sent", email };
  if (String(formData.get("website") ?? "") !== "") return sent; // honeypot

  const db = createAdminClient();
  const { data: org } = await db.from("organisations").select("id, name, slug").eq("slug", orgSlug).maybeSingle();
  if (!org) return { status: "error", message: "This careers site no longer exists.", fieldErrors: {} };

  // Anti-abuse: at most a few emails per address per day.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db.from("data_requests").select("id", { count: "exact", head: true })
    .eq("org_id", org.id).eq("email", email).gte("created_at", since);
  if ((count ?? 0) >= MAX_REQUESTS_PER_DAY) return sent;

  const { token, hash } = newToken();
  const { error } = await db.from("data_requests").insert({
    org_id: org.id, email, kind, details: details || null,
    token_hash: hash, token_expires_at: new Date(Date.now() + VERIFY_HOURS * 3600_000).toISOString(),
  });
  if (error) {
    console.error("[privacy] request insert failed:", error);
    return { status: "error", message: "Something went wrong. Please try again.", fieldErrors: {} };
  }

  const link = `${publicEnv.siteUrl()}/careers/${org.slug}/privacy/verify/${token}`;
  try {
    await sendEmail({
      to: email,
      subject: `Confirm your data request to ${org.name}`,
      text: [
        `Hi,`,
        ``,
        `We received a request (${kindLabel(kind).toLowerCase()}) for the personal data ${org.name} holds about ${email}.`,
        ``,
        `To confirm it was you, open this link within ${VERIFY_HOURS} hours and press Confirm:`,
        link,
        ``,
        `If you did not ask for this, ignore this email and nothing will happen.`,
        ``,
        org.name,
      ].join("\n"),
    });
  } catch (e) {
    console.error("[privacy] verification email failed:", e);
    return { status: "error", message: "We could not send the confirmation email. Please try again later.", fieldErrors: {} };
  }
  return sent;
}
