import type { MemberRole } from "@/lib/auth/membership";

export const ROLES: MemberRole[] = ["admin", "recruiter", "hiring_manager"];

export const ROLE_LABEL: Record<MemberRole, string> = {
  admin: "Org Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring Manager",
};

/** PRD §3, in words an admin choosing a role can act on. */
export const ROLE_DESCRIPTION: Record<MemberRole, string> = {
  admin: "Everything a recruiter can do, plus managing the team, settings and audit log.",
  recruiter: "Creates jobs, sees all candidates, moves them between stages and edits email templates.",
  hiring_manager: "Sees only the jobs they are assigned to, and their candidates. Can add notes but not move candidates.",
};
