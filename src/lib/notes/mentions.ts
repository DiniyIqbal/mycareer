/** A colleague who can be @mentioned. */
export type Mentionable = { id: string; name: string };

export const NOTE_MAX = 10_000;

/** Display name for a member: full name, or the part of the email before @. */
export function memberName(m: { full_name: string | null; email: string }): string {
  return m.full_name?.trim() || m.email.split("@")[0];
}

/**
 * Mentions are picked from a list, so they are stored as user ids. Keep only
 * the ones whose "@Name" is still in the text (the writer may have deleted it).
 */
export function activeMentions(body: string, ids: string[], members: Mentionable[]): string[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  return [...new Set(ids)].filter((id) => {
    const m = byId.get(id);
    return m && body.includes(`@${m.name}`);
  });
}

/** Splits a note into plain text and @mention parts for display. */
export function splitMentions(body: string, names: string[]): { text: string; mention: boolean }[] {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return [{ text: body, mention: false }];
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return parts.filter((p) => p !== "").map((p) => ({ text: p, mention: sorted.some((n) => p === `@${n}`) }));
}
