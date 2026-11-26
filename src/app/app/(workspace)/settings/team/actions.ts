"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireMembership } from "@/lib/auth/membership";
import { sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, ROLES } from "@/lib/team/roles";
import { newInviteToken } from "@/lib/team/tokens";

export type TeamResult =
  | { ok: true; message: string; link?: string }
  | { ok: false; error: string };

const role = z.enum(ROLES as [string, ...string[]]);
const NOT_ADMIN: TeamResult = { ok: false, error: "Only Org Admins can manage the team." };
const LAST_ADMIN = "Your organisation needs at least one Org Admin. Make someone else an admin first.";

async function requireAdmin() {
  const m = await requireMembership();
  return m.role === "admin" ? m : null;
}

/** Invite someone by email. The link is returned too, in case the email is slow. */
export async function inviteMember(input: { email: string; role: string }): Promise<TeamResult> {
  const m = await requireAdmin();
  if (!m) return NOT_ADMIN;
  const parsed = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    role,
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invitation." };
  const { email } = parsed.data;
  const memberRole = parsed.data.role as keyof typeof ROLE_LABEL;

  const supabase = await createClient();
  const { data: existing } = await supabase.from("members").select("user_id").eq("org_id", m.orgId).eq("email", email).maybeSingle();
  if (existing) return { ok: false, error: `${email} is already in your team.` };

  // Replace any earlier open invitation, so "invite again" acts as a resend.
  await supabase.from("invitations").update({ revoked_at: new Date().toISOString() })
    .eq("org_id", m.orgId).eq("email", email).is("accepted_at", null).is("revoked_at", null);

  const { token, hash } = newInviteToken();
  const { data: invitation, error } = await supabase
    .from("invitations")
    .insert({ org_id: m.orgId, email, role: memberRole, token_hash: hash, invited_by: m.userId })
    .select("id, expires_at")
    .single();
  if (error) {
    console.error("[team] invite failed:", error);
    return { ok: false, error: "The invitation could not be created. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "member.invite", entity: "invitation",
    entityId: invitation.id, metadata: { email, role: memberRole } });

  const link = `${publicEnv.siteUrl()}/invite/${token}`;
  const { data: me } = await supabase.from("members").select("full_name, email").eq("org_id", m.orgId).eq("user_id", m.userId).single();
  const inviter = me?.full_name || me?.email || "A colleague";
  try {
    await sendEmail({
      to: email,
      subject: `${inviter} invited you to ${m.orgName} on MyCareer`,
      text: [
        `Hi,`,
        ``,
        `${inviter} has invited you to join ${m.orgName} on MyCareer as ${ROLE_LABEL[memberRole]}.`,
        ``,
        `Accept the invitation: ${link}`,
        ``,
        `Use this email address (${email}) when you sign in or create your account. The link expires in 7 days.`,
        `If you were not expecting this, you can ignore this email.`,
      ].join("\n"),
    });
  } catch (e) {
    console.error("[team] invitation email failed:", e);
    refresh();
    return { ok: true, message: `Invitation created, but the email could not be sent. Share this link with ${email} yourself:`, link };
  }
  refresh();
  return { ok: true, message: `Invitation sent to ${email}. You can also share this link:`, link };
}

export async function revokeInvitation(input: { id: string }): Promise<TeamResult> {
  const m = await requireAdmin();
  if (!m) return NOT_ADMIN;
  if (!z.uuid().safeParse(input.id).success) return { ok: false, error: "Invalid invitation." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() })
    .eq("id", input.id).eq("org_id", m.orgId).is("accepted_at", null).is("revoked_at", null).select("email");
  if (error || !data?.length) return { ok: false, error: "That invitation is no longer open." };
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "invite.revoke", entity: "invitation", entityId: input.id,
    metadata: { email: data[0].email } });
  refresh();
  return { ok: true, message: "Invitation cancelled." };
}

export async function changeRole(input: { userId: string; role: string }): Promise<TeamResult> {
  const m = await requireAdmin();
  if (!m) return NOT_ADMIN;
  const parsed = z.object({ userId: z.uuid(), role }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid role." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").update({ role: parsed.data.role as keyof typeof ROLE_LABEL })
    .eq("org_id", m.orgId).eq("user_id", parsed.data.userId).select("email");
  if (error?.code === "MC409") return { ok: false, error: LAST_ADMIN };
  if (error || !data?.length) {
    if (error) console.error("[team] role change failed:", error);
    return { ok: false, error: "The role could not be changed. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "member.role_change", entity: "member",
    entityId: parsed.data.userId, metadata: { email: data[0].email, role: parsed.data.role } });
  refresh();
  return { ok: true, message: `Role changed to ${ROLE_LABEL[parsed.data.role as keyof typeof ROLE_LABEL]}.` };
}

/** Removes someone from the organisation. Their notes stay; their job assignments go. */
export async function removeMember(input: { userId: string }): Promise<TeamResult> {
  const m = await requireAdmin();
  if (!m) return NOT_ADMIN;
  if (!z.uuid().safeParse(input.userId).success) return { ok: false, error: "Invalid member." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").delete()
    .eq("org_id", m.orgId).eq("user_id", input.userId).select("email");
  if (error?.code === "MC409") return { ok: false, error: LAST_ADMIN };
  if (error || !data?.length) {
    if (error) console.error("[team] remove failed:", error);
    return { ok: false, error: "The member could not be removed. Please try again." };
  }
  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "member.remove", entity: "member",
    entityId: input.userId, metadata: { email: data[0].email } });
  refresh();
  return { ok: true, message: `${data[0].email} was removed from the team.` };
}
