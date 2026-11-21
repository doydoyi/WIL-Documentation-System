import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, Badge, buttonClass, Card, EmptyState, formatDateTime, PageHeader, tableClass } from "@/components/ui";
import { DriveConnectionForm } from "./drive-connection-form";
import { ScanProgress } from "./scan-progress";

export const metadata: Metadata = { title: "Drive Settings" };

// The initial scan runs after the Server Action responds; allow it time to
// process a Shared Drive of about 500 files (NFR-PF-05).
export const maxDuration = 300;

const GOOGLE_MESSAGES: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Google account connected. Now enter the Shared Drive and test the connection." },
  cancelled: { tone: "warning", text: "Google authorization was cancelled. Select Connect Google Account to try again." },
  state: { tone: "error", text: "The authorization request expired or did not match. Select Connect Google Account again." },
  scopes: { tone: "error", text: "Google Drive and Docs access were not both granted. Connect again and allow all requested access." },
  no_refresh: {
    tone: "error",
    text: "Google did not return a long-lived credential. Remove the app's access at myaccount.google.com/permissions, then connect again.",
  },
  failed: { tone: "error", text: "Google authorization failed. Check the OAuth client settings and try again." },
};

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }> = {
  not_connected: { label: "Not connected", tone: "neutral" },
  account_connected: { label: "Account connected", tone: "blue" },
  configured: { label: "Configured", tone: "blue" },
  scanning: { label: "Scanning", tone: "amber" },
  ready: { label: "Ready", tone: "green" },
  error: { label: "Needs attention", tone: "red" },
};

export default async function DriveSettingsPage({ searchParams }: PageProps<"/admin/drive">) {
  await requireRole("administrator");
  const { google } = await searchParams;
  const supabase = await createClient();

  const [{ data: config }, { data: runs }, { count: fileCount }, { count: documentCount }, { count: queuedCount }] =
    await Promise.all([
      supabase.from("drive_config").select("*").eq("id", 1).single(),
      supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(10),
      supabase.from("drive_files").select("drive_file_id", { count: "exact", head: true }),
      supabase.from("documents").select("id", { count: "exact", head: true }),
      supabase.from("drive_files").select("drive_file_id", { count: "exact", head: true }).eq("registration_status", "unclassified"),
    ]);

  const message = typeof google === "string" ? GOOGLE_MESSAGES[google] : undefined;
  const status = STATUS_LABEL[config?.status ?? "not_connected"] ?? STATUS_LABEL.not_connected;
  const running = (runs ?? []).find((r) => r.status === "running");

  return (
    <>
      <PageHeader
        title="Drive Settings"
        description="Connect the office's Google Workspace Shared Drive. The system reads file information and writes each assigned code to the file's private properties; it never moves, renames, or deletes files."
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      {message ? <div className="mb-5"><Alert tone={message.tone}>{message.text}</Alert></div> : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="1. Google account">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm">
                {config?.connected_account_email ? (
                  <>Connected as <span className="font-medium">{config.connected_account_email}</span>.</>
                ) : (
                  <>No Google account is connected. An Administrator who is a member of the Shared Drive must authorize the system once.</>
                )}
                <p className="mt-1 text-xs text-stone-500">
                  The credential is stored as a server-side secret and is never sent to the browser.
                </p>
              </div>
              <a href="/api/google/connect" className={config?.connected_account_email ? buttonClass.secondary : buttonClass.primary}>
                {config?.connected_account_email ? "Reconnect Google Account" : "Connect Google Account"}
              </a>
            </div>
          </Card>

          <Card title="2. Shared Drive and initial scan">
            <DriveConnectionForm
              disabled={!config?.connected_account_email || Boolean(running)}
              defaults={{
                sharedDriveId: config?.shared_drive_id ?? "",
                pollInterval: config?.poll_interval_minutes ?? 15,
                excludedFolders: (config?.excluded_folder_ids ?? []).join("\n"),
              }}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Current connection">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Shared Drive</dt><dd className="text-right font-medium">{config?.shared_drive_name ?? "—"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Polling interval</dt><dd>{config?.poll_interval_minutes ?? 15} minutes</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Excluded folders</dt><dd>{config?.excluded_folder_ids?.length ?? 0}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Last synchronized</dt><dd>{formatDateTime(config?.last_synced_at)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Files recorded</dt><dd>{fileCount ?? 0}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Documents coded</dt><dd>{documentCount ?? 0}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-stone-500">Awaiting classification</dt><dd>{queuedCount ?? 0}</dd></div>
            </dl>
          </Card>
          {running ? <ScanProgress run={running} /> : null}
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold">Synchronization history</h2>
      {(runs ?? []).length === 0 ? (
        <EmptyState>No scans or synchronizations have run yet.</EmptyState>
      ) : (
        <div className={tableClass.wrapper}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>Started</th>
                <th className={tableClass.th}>Type</th>
                <th className={tableClass.th}>Status</th>
                <th className={tableClass.th}>Added</th>
                <th className={tableClass.th}>Updated</th>
                <th className={tableClass.th}>Removed</th>
                <th className={tableClass.th}>Coded</th>
                <th className={tableClass.th}>Queued</th>
                <th className={tableClass.th}>Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(runs ?? []).map((r) => (
                <tr key={r.id} className={tableClass.row}>
                  <td className={`${tableClass.td} whitespace-nowrap`}>{formatDateTime(r.started_at)}</td>
                  <td className={tableClass.td}>{r.mode === "initial" ? "Initial scan" : "Sync"} · {r.trigger}</td>
                  <td className={tableClass.td}>
                    <Badge tone={r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Badge>
                  </td>
                  <td className={tableClass.td}>{r.files_added}</td>
                  <td className={tableClass.td}>{r.files_updated}</td>
                  <td className={tableClass.td}>{r.files_removed}</td>
                  <td className={tableClass.td}>{r.files_registered}</td>
                  <td className={tableClass.td}>{r.files_queued}</td>
                  <td className={`${tableClass.td} max-w-sm text-xs text-stone-600`}>{r.error_message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
