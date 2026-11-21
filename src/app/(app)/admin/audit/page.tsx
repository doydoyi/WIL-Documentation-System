import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  Alert,
  buttonClass,
  EmptyState,
  formatDateTime,
  inputClass,
  labelClass,
  PageHeader,
  tableClass,
} from "@/components/ui";
import {
  applyAuditFilters,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_PAGE_SIZE,
  filtersToQuery,
  parseAuditFilters,
} from "./filters";

export const metadata: Metadata = { title: "Audit Logs" };

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Lists only the keys whose values differ, so changes are easy to read. */
function changedKeys(oldValues: Record<string, unknown> | null, newValues: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})]);
  return [...keys].filter(
    (k) => JSON.stringify(oldValues?.[k] ?? null) !== JSON.stringify(newValues?.[k] ?? null),
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default async function AuditLogPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireRole("administrator");
  const filters = parseAuditFilters(await searchParams);
  const supabase = await createClient();

  const offset = (filters.page - 1) * AUDIT_PAGE_SIZE;
  const base = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, old_values, new_values, created_at, actor:profiles(email, full_name)", {
      count: "exact",
    });
  const [{ data: entries, count, error }, { data: users }] = await Promise.all([
    applyAuditFilters(base, filters)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + AUDIT_PAGE_SIZE - 1),
    supabase.from("profiles").select("id, email, full_name").order("full_name"),
  ]);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const exportQuery = filtersToQuery(filters, { page: 1 });

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Every sign-in, registration, code and classification change, synchronization run and administrative action. Entries cannot be edited or deleted."
        actions={
          <a href={`/api/audit/export${exportQuery ? `?${exportQuery}` : ""}`} className={buttonClass.secondary}>
            Export CSV
          </a>
        }
      />

      <form method="get" className="mb-5 grid grid-cols-2 gap-3 rounded-lg border border-stone-200 bg-white p-4 md:grid-cols-6">
        <div>
          <label htmlFor="from" className={labelClass}>From</label>
          <input id="from" name="from" type="date" defaultValue={filters.from} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label htmlFor="to" className={labelClass}>To</label>
          <input id="to" name="to" type="date" defaultValue={filters.to} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label htmlFor="actor" className={labelClass}>User</label>
          <select id="actor" name="actor" defaultValue={filters.actor ?? ""} className={`${inputClass} mt-1`}>
            <option value="">All users</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="action" className={labelClass}>Action</label>
          <select id="action" name="action" defaultValue={filters.action ?? ""} className={`${inputClass} mt-1`}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="entity" className={labelClass}>Entity</label>
          <select id="entity" name="entity" defaultValue={filters.entity ?? ""} className={`${inputClass} mt-1`}>
            <option value="">All entities</option>
            {AUDIT_ENTITIES.map((e) => <option key={e} value={e}>{humanize(e)}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonClass.primary}>Filter</button>
          <Link href="/admin/audit" className={buttonClass.link}>Clear</Link>
        </div>
      </form>

      {error ? <Alert tone="error">The audit log could not be loaded. Refresh the page to try again.</Alert> : null}

      {!error && (entries ?? []).length === 0 ? (
        <EmptyState>No activity found for these filters.</EmptyState>
      ) : null}

      {(entries ?? []).length > 0 ? (
        <div className={tableClass.wrapper}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>When</th>
                <th className={tableClass.th}>User</th>
                <th className={tableClass.th}>Action</th>
                <th className={tableClass.th}>Entity</th>
                <th className={tableClass.th}>Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(entries ?? []).map((entry) => {
                const actor = Array.isArray(entry.actor) ? entry.actor[0] : entry.actor;
                const oldValues = entry.old_values as Record<string, unknown> | null;
                const newValues = entry.new_values as Record<string, unknown> | null;
                const keys = changedKeys(oldValues, newValues);
                return (
                  <tr key={entry.id} className={tableClass.row}>
                    <td className={`${tableClass.td} whitespace-nowrap`}>{formatDateTime(entry.created_at)}</td>
                    <td className={tableClass.td}>{actor ? actor.full_name || actor.email : <span className="text-stone-500">System</span>}</td>
                    <td className={tableClass.td}>{humanize(entry.action)}</td>
                    <td className={tableClass.td}>
                      {humanize(entry.entity_type)}
                      {entry.entity_id ? <span className="block font-mono text-xs text-stone-500">{entry.entity_id}</span> : null}
                    </td>
                    <td className={tableClass.td}>
                      <details>
                        <summary className="cursor-pointer text-brand">
                          {keys.length ? `${keys.length} field${keys.length === 1 ? "" : "s"}` : "View"}
                        </summary>
                        <table className="mt-2 w-full text-xs">
                          <thead>
                            <tr className="text-left text-stone-500">
                              <th className="pr-3 font-medium">Field</th>
                              <th className="pr-3 font-medium">Old value</th>
                              <th className="font-medium">New value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {keys.map((k) => (
                              <tr key={k} className="align-top">
                                <td className="pr-3 font-mono">{k}</td>
                                <td className="max-w-xs break-words pr-3 text-red-800">{show(oldValues?.[k])}</td>
                                <td className="max-w-xs break-words text-green-800">{show(newValues?.[k])}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {total > 0 ? (
        <nav className="mt-4 flex items-center justify-between text-sm text-stone-600" aria-label="Pagination">
          <span>
            {offset + 1}–{Math.min(offset + AUDIT_PAGE_SIZE, total)} of {total} entries
          </span>
          <span className="flex gap-3">
            {filters.page > 1 ? (
              <Link className={buttonClass.link} href={`/admin/audit?${filtersToQuery(filters, { page: filters.page - 1 })}`}>
                Previous
              </Link>
            ) : null}
            <span>Page {filters.page} of {pages}</span>
            {filters.page < pages ? (
              <Link className={buttonClass.link} href={`/admin/audit?${filtersToQuery(filters, { page: filters.page + 1 })}`}>
                Next
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
