"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireMembership, type Membership } from "@/lib/auth/membership";
import { activeMentions, memberName, NOTE_MAX } from "@/lib/notes/mentions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type NoteResult = { ok: true; warning: string | null } | { ok: false; error: string };

const bodySchema = z
  .string()
  .trim()
  .min(1, "Write something first")
  .max(NOTE_MAX, "Notes can be up to 10,000 characters");
const ids = z.array(z.uuid()).max(50).default([]);

/** HR-07: add a note to an application, notifying anyone @mentioned. */
export async function addNote(input: { applicationId: string; body: string; mentions: string[] }): Promise<NoteResult> {
  const m = await requireMembership();
  const parsed = z.object({ applicationId: z.uuid(), body: bodySchema, mentions: ids }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  const { applicationId, body } = parsed.data;

  const supabase = await createClient();
  // RLS: only people who can see the application get a row back.
  const { data: app, error: appError } = await supabase
    .from("applications")
    .select("id, job_id, candidate_id, candidates(full_name), jobs(title)")
    .eq("id", applicationId)
    .eq("org_id", m.orgId)
    .maybeSingle();
  if (appError) throw appError;
  if (!app) return { ok: false, error: "This application is no longer available." };

  const team = await loadTeam(m.orgId, app.job_id);
  const mentions = activeMentions(body, parsed.data.mentions, team.members).filter((id) => id !== m.userId);

  const { data: note, error } = await supabase
    .from("notes")
    .insert({ org_id: m.orgId, application_id: applicationId, author_id: m.userId, body, mentions })
    .select("id")
    .single();
  if (error) {
    console.error("[notes] insert failed:", error);
    return { ok: false, error: "The note could not be saved. Please try again." };
  }

  const warning = await notify(m, team, mentions, {
    note_id: note.id,
    application_id: applicationId,
    candidate_id: app.candidate_id,
    candidate_name: (app.candidates as unknown as { full_name: string } | null)?.full_name ?? "",
    job_title: (app.jobs as unknown as { title: string } | null)?.title ?? "",
    excerpt: body.slice(0, 140),
  });
  refresh();
  return { ok: true, warning };
}

/** Edit your own note. Only newly added @mentions are notified. */
export async function updateNote(input: { noteId: string; body: string; mentions: string[] }): Promise<NoteResult> {
  const m = await requireMembership();
  const parsed = z.object({ noteId: z.uuid(), body: bodySchema, mentions: ids }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  const { noteId, body } = parsed.data;

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("notes")
    .select("id, author_id, mentions, application_id, applications(job_id, candidate_id, candidates(full_name), jobs(title))")
    .eq("id", noteId)
    .eq("org_id", m.orgId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!existing || existing.author_id !== m.userId) return { ok: false, error: "You can only edit your own notes." };

  const app = existing.applications as unknown as {
    job_id: string; candidate_id: string; candidates: { full_name: string } | null; jobs: { title: string } | null;
  };
  const team = await loadTeam(m.orgId, app.job_id);
  const mentions = activeMentions(body, parsed.data.mentions, team.members).filter((id) => id !== m.userId);

  const { data: saved, error } = await supabase
    .from("notes")
    .update({ body, mentions })
    .eq("id", noteId)
    .eq("author_id", m.userId)
    .select("id");
  if (error || !saved?.length) {
    if (error) console.error("[notes] update failed:", error);
    return { ok: false, error: "The note could not be saved. Please try again." };
  }

  const before = new Set(existing.mentions as string[]);
  const warning = await notify(m, team, mentions.filter((id) => !before.has(id)), {
    note_id: noteId,
    application_id: existing.application_id,
    candidate_id: app.candidate_id,
    candidate_name: app.candidates?.full_name ?? "",
    job_title: app.jobs?.title ?? "",
    excerpt: body.slice(0, 140),
  });
  refresh();
  return { ok: true, warning };
}

export async function deleteNote(input: { noteId: string }): Promise<NoteResult> {
  await requireMembership();
  if (!z.uuid().safeParse(input.noteId).success) return { ok: false, error: "Invalid note." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("notes").delete().eq("id", input.noteId).select("id"); // RLS: own notes only
  if (error || !data?.length) return { ok: false, error: "You can only delete your own notes." };
  refresh();
  return { ok: true, warning: null };
}

type Team = {
  members: { id: string; name: string }[];
  canSee: Set<string>;
};

/** Everyone in the organisation, and who among them can see this job's candidates. */
async function loadTeam(orgId: string, jobId: string): Promise<Team> {
  const supabase = await createClient();
  const [members, assignments] = await Promise.all([
    supabase.from("members").select("user_id, full_name, email, role").eq("org_id", orgId),
    supabase.from("job_assignments").select("user_id").eq("org_id", orgId).eq("job_id", jobId),
  ]);
  if (members.error) throw members.error;
  if (assignments.error) throw assignments.error;
  const assigned = new Set((assignments.data ?? []).map((a) => a.user_id));
  return {
    members: (members.data ?? []).map((x) => ({ id: x.user_id, name: memberName(x) })),
    canSee: new Set(
      (members.data ?? []).filter((x) => x.role !== "hiring_manager" || assigned.has(x.user_id)).map((x) => x.user_id),
    ),
  };
}

/**
 * In-app notifications for mentioned colleagues who can open the candidate.
 * Returns a warning naming anyone mentioned who cannot (an unassigned hiring
 * manager), so the writer knows they will not see it.
 */
async function notify(m: Membership, team: Team, userIds: string[], payload: Record<string, string>) {
  if (userIds.length === 0) return null;
  const author = team.members.find((x) => x.id === m.userId)?.name ?? "A colleague";
  const allowed = userIds.filter((id) => team.canSee.has(id));
  const blocked = userIds.filter((id) => !team.canSee.has(id));

  if (allowed.length) {
    const { error } = await createAdminClient()
      .from("notifications")
      .insert(allowed.map((user_id) => ({ org_id: m.orgId, user_id, kind: "mention", payload: { ...payload, author_name: author } })));
    if (error) console.error("[notes] notifications failed:", error);
  }
  if (!blocked.length) return null;
  const names = blocked.map((id) => team.members.find((x) => x.id === id)?.name ?? "Someone").join(", ");
  return `${names} cannot see this candidate (not assigned to the job), so they were not notified.`;
}
