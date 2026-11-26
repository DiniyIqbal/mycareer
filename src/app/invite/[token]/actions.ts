"use server";

import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { hashInviteToken, isTokenShaped } from "@/lib/team/tokens";

const ERRORS: Record<string, string> = {
  MC401: "This invitation is no longer valid. Ask your admin to send a new one.",
  MC402: "This invitation has already been used.",
  MC403: "This invitation has expired. Ask your admin to send a new one.",
  MC404: "This invitation is for a different email address. Sign in with the invited email.",
  MC405: "Your account already belongs to another organisation. Use a different email for this one, or leave the other organisation first.",
};

export async function acceptInvitation(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  if (!isTokenShaped(token)) return { error: ERRORS.MC401 };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data: orgId, error } = await supabase.rpc("accept_invitation", { p_token_hash: hashInviteToken(token) });
  if (error) {
    if (!ERRORS[error.code]) console.error("[invite] accept failed:", error);
    return { error: ERRORS[error.code] ?? "Something went wrong. Please try again." };
  }
  await writeAudit({ orgId, actorId: user.id, action: "member.join", entity: "member", entityId: user.id });
  redirect("/app");
}
