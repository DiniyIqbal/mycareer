import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type MemberRole = "admin" | "recruiter" | "hiring_manager";

export type Membership = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: MemberRole;
  userId: string;
};

/**
 * The signed-in user's organisation. MVP assumes one organisation per HR
 * user; the schema already allows several, so an org switcher can come later.
 */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("members")
    .select("role, org_id, organisations(name, slug)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const org = data.organisations as unknown as { name: string; slug: string };
  return { orgId: data.org_id, orgName: org.name, orgSlug: org.slug, role: data.role, userId: user.id };
});

export async function requireMembership(): Promise<Membership> {
  const membership = await getMembership();
  if (!membership) redirect("/app/onboarding");
  return membership;
}
