/**
 * Audit log filters shared by the page and the CSV export (FR-1.3.1).
 * Dates are interpreted in office time (Asia/Manila, UTC+8).
 */

export const AUDIT_ACTIONS = [
  "insert",
  "update",
  "delete",
  "sign_in",
  "sign_in_failed",
  "export_audit_log",
  "drive_account_connected",
  "drive_connection_tested",
  "drive_scan_started",
  "drive_scan_finished",
] as const;

export const AUDIT_ENTITIES = [
  "auth",
  "profiles",
  "categories",
  "purposes",
  "required_field_rules",
  "classification_rules",
  "drive_config",
  "documents",
  "sync_runs",
  "audit_logs",
  "report_templates",
] as const;

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  from?: string;
  to?: string;
  actor?: string;
  action?: string;
  entity?: string;
  page: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string | undefined {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single?.trim() || undefined;
}

export function parseAuditFilters(params: Params): AuditFilters {
  const from = get(params, "from");
  const to = get(params, "to");
  const actor = get(params, "actor");
  const action = get(params, "action");
  const entity = get(params, "entity");
  const page = Math.max(1, Math.min(10_000, Number.parseInt(get(params, "page") ?? "1", 10) || 1));
  return {
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    actor: actor && UUID.test(actor) ? actor : undefined,
    action: action && (AUDIT_ACTIONS as readonly string[]).includes(action) ? action : undefined,
    entity: entity && (AUDIT_ENTITIES as readonly string[]).includes(entity) ? entity : undefined,
    page,
  };
}

/** Start of a day in office time, as an ISO timestamp. */
export function startOfOfficeDay(date: string): string {
  return `${date}T00:00:00+08:00`;
}

/** Start of the following day in office time (exclusive upper bound). */
export function endOfOfficeDayExclusive(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T00:00:00+08:00`;
}

/** Minimal shape of a PostgREST filter builder used by applyAuditFilters. */
export interface AuditFilterable {
  gte(column: string, value: string): this;
  lt(column: string, value: string): this;
  eq(column: string, value: string): this;
}

export function applyAuditFilters<T extends AuditFilterable>(query: T, filters: AuditFilters): T {
  let q = query;
  if (filters.from) q = q.gte("created_at", startOfOfficeDay(filters.from));
  if (filters.to) q = q.lt("created_at", endOfOfficeDayExclusive(filters.to));
  if (filters.actor) q = q.eq("actor_id", filters.actor);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.entity) q = q.eq("entity_type", filters.entity);
  return q;
}

export function filtersToQuery(filters: AuditFilters, overrides: Partial<AuditFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const key of ["from", "to", "actor", "action", "entity"] as const) {
    if (merged[key]) params.set(key, merged[key]!);
  }
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  return params.toString();
}
