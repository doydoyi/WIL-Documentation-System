import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/domain/access";
import { Alert, Badge, Card, formatDateTime, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-stone-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-stone-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Sprint 1 dashboard: live counts calculated from current records
 * (FR-3.3.1). Charts, click-through filters and recent reports arrive with
 * the full dashboard (UC-3.3) in Sprint 2.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const { error } = await searchParams;
  const supabase = await createClient();
  const isStaff = user.role !== "viewer";

  const count = (query: PromiseLike<{ count: number | null }>) => query.then((r) => r.count ?? 0);
  const [total, provisional, incomplete, unclassified, config, lastRun] = await Promise.all([
    count(supabase.from("documents").select("id", { count: "exact", head: true })),
    count(supabase.from("documents").select("id", { count: "exact", head: true }).eq("code_status", "provisional")),
    count(supabase.from("documents").select("id", { count: "exact", head: true }).eq("record_status", "incomplete")),
    isStaff
      ? count(supabase.from("drive_files").select("drive_file_id", { count: "exact", head: true }).eq("registration_status", "unclassified"))
      : Promise.resolve(0),
    isStaff ? supabase.from("drive_config").select("shared_drive_name, status, last_synced_at, connected_account_email").eq("id", 1).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    isStaff ? supabase.from("sync_runs").select("status, started_at, finished_at, files_registered, files_queued").order("started_at", { ascending: false }).limit(1).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);

  const [{ count: ruleCount }, { count: userCount }] =
    user.role === "administrator"
      ? await Promise.all([
          supabase.from("classification_rules").select("id", { count: "exact", head: true }).eq("is_active", true),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
        ])
      : [{ count: null }, { count: null }];

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.fullName.split(" ")[0]}`}
        description={`Signed in as ${ROLE_LABELS[user.role]}.`}
      />
      {error === "forbidden" ? (
        <div className="mb-5"><Alert tone="error">That page is only available to Administrators. Contact the Administrator if you need access.</Alert></div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Registered documents" value={total} />
        {isStaff ? (
          <>
            <Kpi label="Files needing classification" value={unclassified} hint="No rule matched; Records Staff assign a code" />
            <Kpi label="Provisional codes" value={provisional} hint="Coded automatically, awaiting confirmation" />
            <Kpi label="Incomplete records" value={incomplete} hint="Missing required fields" />
          </>
        ) : null}
      </div>

      {total === 0 && !isStaff ? (
        <p className="mt-6 text-sm text-stone-600">The masterlist is empty. Documents appear here once the office&apos;s Shared Drive has been scanned.</p>
      ) : null}

      {isStaff ? (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="Shared Drive synchronization">
            {config?.shared_drive_name ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-stone-500">Shared Drive</dt><dd className="font-medium">{config.shared_drive_name}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Last synchronized</dt><dd>{formatDateTime(config.last_synced_at)}</dd></div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Last run</dt>
                  <dd>
                    {lastRun ? (
                      <Badge tone={lastRun.status === "succeeded" ? "green" : lastRun.status === "failed" ? "red" : "amber"}>{lastRun.status}</Badge>
                    ) : "—"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-stone-600">
                The Shared Drive is not connected yet.
                {user.role === "administrator" ? <> Open <Link className="text-brand underline" href="/admin/drive">Drive Settings</Link> to connect it.</> : " An Administrator must connect it."}
              </p>
            )}
          </Card>

          {user.role === "administrator" ? (
            <Card title="Setup checklist">
              <ol className="space-y-2 text-sm">
                <Step done={(userCount ?? 0) > 1} href="/admin/users">Add the office&apos;s Records Staff and Viewers</Step>
                <Step done={(ruleCount ?? 0) > 0} href="/admin/reference?tab=rules">Add classification rules for automatic coding</Step>
                <Step done={Boolean(config?.connected_account_email)} href="/admin/drive">Connect the authorizing Google account</Step>
                <Step done={Boolean(config?.last_synced_at)} href="/admin/drive">Connect the Shared Drive and run the initial scan</Step>
              </ol>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Step({ done, href, children }: { done: boolean; href: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${done ? "bg-green-600 text-white" : "border border-stone-300 text-stone-400"}`}
      >
        {done ? "✓" : ""}
      </span>
      <Link href={href} className={done ? "text-stone-500 line-through" : "text-stone-800 hover:text-brand hover:underline"}>
        {children}
      </Link>
      <span className="sr-only">{done ? "(done)" : "(to do)"}</span>
    </li>
  );
}
