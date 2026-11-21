"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, AuthorizationError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/audit";
import { parseDriveId, parseDriveIdList } from "@/lib/domain/drive";
import { describeDriveError, getSharedDrive, getStartPageToken, listSharedDriveItems } from "@/lib/google/drive";
import { runInitialScan } from "@/lib/sync/initial-scan";

export type TestResult =
  | { status: "idle" }
  | { status: "success"; driveId: string; driveName: string; itemCount: number }
  | { status: "error"; message: string };

export type SaveResult =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "confirm"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

async function guard() {
  try {
    return { user: await authorize("administrator"), error: null };
  } catch (error) {
    if (error instanceof AuthorizationError) return { user: null, error: error.message };
    throw error;
  }
}

/** Test Connection (UC-1.5 steps 4–5): shows the Shared Drive name and item count. */
export async function testDriveConnection(_prev: TestResult, formData: FormData): Promise<TestResult> {
  const { user, error } = await guard();
  if (!user) return { status: "error", message: error! };

  const driveId = parseDriveId(String(formData.get("shared_drive") ?? ""));
  if (!driveId) {
    return { status: "error", message: "Enter the Shared Drive ID or paste its URL from the browser's address bar." };
  }
  try {
    const drive = await getSharedDrive(driveId);
    const items = await listSharedDriveItems(driveId, "id");
    await recordAuditEvent({
      actorId: user.id,
      action: "drive_connection_tested",
      entityType: "drive_config",
      entityId: "1",
      newValues: { shared_drive_id: driveId, shared_drive_name: drive.name, items: items.length },
    });
    return { status: "success", driveId, driveName: drive.name, itemCount: items.length };
  } catch (e) {
    return { status: "error", message: describeDriveError(e) };
  }
}

const settingsSchema = z.object({
  shared_drive: z.string(),
  poll_interval_minutes: z.coerce
    .number({ message: "Enter the polling interval in minutes." })
    .int("Enter a whole number of minutes.")
    .min(5, "The polling interval must be at least 5 minutes.")
    .max(1440, "The polling interval can be at most 1440 minutes (one day)."),
  excluded_folders: z.string().default(""),
  confirm_change: z.boolean(),
});

/**
 * Save and Start Initial Scan (UC-1.5 steps 6–10). Verifies access before
 * saving (FR-1.5.2), stores the start page token, then scans in the
 * background after the response is sent.
 */
export async function saveDriveConfigAndScan(_prev: SaveResult, formData: FormData): Promise<SaveResult> {
  const { user, error } = await guard();
  if (!user) return { status: "error", message: error! };

  const parsed = settingsSchema.safeParse({
    shared_drive: formData.get("shared_drive") ?? "",
    poll_interval_minutes: formData.get("poll_interval_minutes"),
    excluded_folders: formData.get("excluded_folders") ?? "",
    confirm_change: formData.get("confirm_change") === "yes",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: "error", message: issue.message, fieldErrors: { [String(issue.path[0])]: issue.message } };
  }
  const input = parsed.data;

  const driveId = parseDriveId(input.shared_drive);
  if (!driveId) {
    return {
      status: "error",
      message: "Enter the Shared Drive ID or paste its URL.",
      fieldErrors: { shared_drive: "This is not a valid Shared Drive ID or URL." },
    };
  }
  const excluded = parseDriveIdList(input.excluded_folders);
  if (excluded.invalid.length) {
    return {
      status: "error",
      message: `These excluded folders are not valid folder IDs or URLs: ${excluded.invalid.join(", ")}`,
      fieldErrors: { excluded_folders: "Enter one folder ID or URL per line." },
    };
  }

  const supabase = await createClient();
  const { data: current } = await supabase.from("drive_config").select("shared_drive_id, connected_account_email").eq("id", 1).single();
  if (!current?.connected_account_email) {
    return { status: "error", message: "Connect a Google account first (step 1)." };
  }

  // A1: changing an existing configuration needs confirmation.
  if (current.shared_drive_id && current.shared_drive_id !== driveId && !input.confirm_change) {
    return {
      status: "confirm",
      message:
        "This replaces the Shared Drive the system is connected to. Records of files from the current Shared Drive stay in the masterlist and must be reviewed. Select Save and Start Initial Scan again to confirm.",
    };
  }

  // FR-1.5.2: verify access before saving.
  let driveName: string;
  let startPageToken: string;
  try {
    driveName = (await getSharedDrive(driveId)).name;
    startPageToken = await getStartPageToken(driveId);
  } catch (e) {
    return { status: "error", message: describeDriveError(e), fieldErrors: { shared_drive: "Access check failed." } };
  }

  const { error: saveError } = await supabase
    .from("drive_config")
    .update({
      shared_drive_id: driveId,
      shared_drive_name: driveName,
      excluded_folder_ids: excluded.ids,
      poll_interval_minutes: input.poll_interval_minutes,
      start_page_token: startPageToken,
      status: "scanning",
      configured_by: user.id,
    })
    .eq("id", 1);
  if (saveError) return { status: "error", message: "The settings could not be saved. Try again." };

  const admin = createAdminClient();
  const { data: runId, error: runError } = await admin.rpc("start_sync_run", {
    p_trigger: "manual",
    p_mode: "initial",
    p_actor: user.id,
  });
  if (runError || runId === null) {
    return {
      status: "error",
      message: runError?.code === "P0001" ? runError.message : "The scan could not be started. Try again.",
    };
  }

  await recordAuditEvent({
    actorId: user.id,
    action: "drive_scan_started",
    entityType: "sync_runs",
    entityId: String(runId),
    newValues: { shared_drive_id: driveId, shared_drive_name: driveName },
  });

  after(() =>
    runInitialScan({ runId: Number(runId), driveId, excludedFolderIds: excluded.ids, actorId: user.id }),
  );

  revalidatePath("/admin/drive");
  return { status: "success", message: `Settings saved. Scanning “${driveName}”…` };
}
