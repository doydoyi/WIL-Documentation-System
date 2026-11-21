import { NextResponse, type NextRequest } from "next/server";
import { authorize, AuthorizationError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit";
import { toCsv } from "@/lib/domain/csv";
import { applyAuditFilters, parseAuditFilters } from "@/app/(app)/admin/audit/filters";

const MAX_ROWS = 20_000;
const BATCH = 1_000;

/** Downloads the filtered audit entries as CSV and logs the export (UC-1.3 A1). */
export async function GET(request: NextRequest) {
  let user;
  try {
    user = await authorize("administrator");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const filters = parseAuditFilters(request.nextUrl.searchParams);
  const supabase = await createClient();

  const rows: (string | number | null | object)[][] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += BATCH) {
    const base = supabase
      .from("audit_logs")
      .select("id, created_at, action, entity_type, entity_id, old_values, new_values, actor:profiles(email)");
    const { data, error } = await applyAuditFilters(base, filters)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + BATCH - 1);
    if (error) {
      return NextResponse.json({ error: "The audit log could not be exported. Try again." }, { status: 500 });
    }
    for (const e of data ?? []) {
      const actor = Array.isArray(e.actor) ? e.actor[0] : e.actor;
      rows.push([e.id, e.created_at, actor?.email ?? "system", e.action, e.entity_type, e.entity_id, e.old_values, e.new_values]);
    }
    if (!data || data.length < BATCH) break;
  }

  const { page: _page, ...appliedFilters } = filters;
  void _page;
  await recordAuditEvent({
    actorId: user.id,
    action: "export_audit_log",
    entityType: "audit_logs",
    newValues: { filters: appliedFilters, rows: rows.length },
  });

  const csv = toCsv(["id", "created_at", "user", "action", "entity_type", "entity_id", "old_values", "new_values"], rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
