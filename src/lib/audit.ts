import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Appends to the audit log (PRD §13). Signed-in users cannot write the log
 * directly, so this uses the service role — call it only after the action
 * itself has been authorised and has succeeded.
 */
export async function writeAudit(entry: {
  orgId: string;
  actorId: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await createAdminClient().from("audit_log").insert({
    org_id: entry.orgId,
    actor_id: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
  // Never fail the user's action because logging failed, but make it visible.
  if (error) console.error("audit_log insert failed", entry.action, error.message);
}
