import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records events that are not row changes (sign-ins, exports, scans).
 * Row changes are audited by database triggers, so no code path can skip
 * them. audit_logs is append-only and has no insert policy for users, so
 * these entries are written with the service role.
 */
export interface AuditEvent {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_logs").insert({
    actor_id: event.actorId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    old_values: event.oldValues ?? null,
    new_values: event.newValues ?? null,
  });
  if (error) {
    // Auditing must not fail silently: surface it in server logs.
    console.error("Failed to write audit entry", event.action, error.message);
    throw new Error("The activity could not be recorded in the audit log.");
  }
}
