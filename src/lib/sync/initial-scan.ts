import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/audit";
import { env } from "@/lib/env";
import {
  classifyWithCompiled,
  compileRules,
  type ClassificationRule,
} from "@/lib/domain/classification";
import { FOLDER_MIME_TYPE, FolderTree } from "@/lib/domain/drive";
import { describeDriveError, listSharedDriveItems, setAppProperties } from "@/lib/google/drive";

/**
 * Initial scan of the Shared Drive (UC-1.5 steps 8–10).
 *
 *  1. Lists every non-trashed item and records file metadata in drive_files,
 *     without copying file contents (FR-1.5.3). Files inside excluded folders
 *     are marked excluded and never coded (FR-1.5.6, NFR-RE-07).
 *  2. Registers and codes new files in order of creation date (UC-2.2):
 *     classification rules give the category and purpose, the database
 *     assigns the next code atomically, and the code is stored as
 *     provisional. Files no rule matches are queued for Records Staff.
 *  3. Writes the code to each file's appProperties (FR-2.2.9); failures are
 *     flagged (code_written_to_drive = false) and retried by the next sync.
 *
 * The scan is idempotent: re-running it refreshes metadata and only
 * registers files that are not yet registered.
 */

export interface ScanOptions {
  runId: number;
  driveId: string;
  excludedFolderIds: string[];
  actorId: string;
}

const UPSERT_BATCH = 500;
const PROGRESS_EVERY = 20;

export async function runInitialScan({ runId, driveId, excludedFolderIds, actorId }: ScanOptions): Promise<void> {
  const db = createAdminClient();
  const counts = { files_added: 0, files_updated: 0, files_registered: 0, files_queued: 0 };
  const progress = () => db.from("sync_runs").update(counts).eq("id", runId);
  let codesNotWritten = 0;

  try {
    // 1. Inventory ---------------------------------------------------------
    const items = await listSharedDriveItems(driveId);
    const folders = items.filter((i) => i.mimeType === FOLDER_MIME_TYPE);
    const files = items.filter((i) => i.mimeType !== FOLDER_MIME_TYPE);
    const tree = new FolderTree(
      driveId,
      folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parents?.[0] ?? null })),
    );
    const excluded = new Set(excludedFolderIds);

    const existing = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("drive_files")
        .select("drive_file_id, registration_status")
        .range(from, from + 999);
      if (error) throw new Error(`Could not read the file inventory: ${error.message}`);
      for (const row of data ?? []) existing.set(row.drive_file_id, row.registration_status);
      if (!data || data.length < 1000) break;
    }

    const rows = files.map((file) => {
      const parentId = file.parents?.[0] ?? null;
      const previous = existing.get(file.id);
      const inExcludedFolder = tree.isExcluded(parentId, excluded);
      const registration_status =
        previous === "registered" ? "registered" : inExcludedFolder ? "excluded" : "unclassified";
      if (previous) counts.files_updated++;
      else counts.files_added++;
      return {
        drive_file_id: file.id,
        name: file.name,
        mime_type: file.mimeType,
        folder_path: tree.pathOf(parentId),
        parent_id: parentId,
        web_view_link: file.webViewLink ?? null,
        size_bytes: file.size ? Number(file.size) : null,
        created_time: file.createdTime,
        modified_time: file.modifiedTime ?? null,
        is_trashed: false,
        registration_status,
        last_sync_id: runId,
      };
    });

    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const { error } = await db.from("drive_files").upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: "drive_file_id" });
      if (error) throw new Error(`Could not save file metadata: ${error.message}`);
    }
    await progress();

    // 2. Automatic registration --------------------------------------------
    const [{ data: rules }, { data: categories }, { data: purposes }] = await Promise.all([
      db.from("classification_rules").select("id, pattern, match_on, category_code, purpose_code, priority, is_active"),
      db.from("categories").select("code").eq("is_active", true),
      db.from("purposes").select("code").eq("is_active", true),
    ]);
    const compiled = compileRules(
      ((rules ?? []) as ClassificationRule[]).map((r) => ({ ...r, category_code: r.category_code.trim() })),
      {
        categories: new Set((categories ?? []).map((c) => c.code.trim())),
        purposes: new Set((purposes ?? []).map((p) => p.code)),
      },
    );

    const candidates = rows
      .filter((r) => r.registration_status === "unclassified")
      .sort((a, b) => a.created_time.localeCompare(b.created_time));

    for (const [index, file] of candidates.entries()) {
      const match = classifyWithCompiled({ name: file.name, folderPath: file.folder_path }, compiled);
      if (!match) {
        counts.files_queued++;
      } else {
        const { data: document, error } = await db.rpc("register_document", {
          p_drive_file_id: file.drive_file_id,
          p_category: match.categoryCode,
          p_purpose: match.purposeCode,
          p_code_status: "provisional",
          p_actor: actorId,
          p_office: env.officeCode,
        });
        if (error || !document) {
          // Leave the file queued; Records Staff can register it manually.
          console.error("Automatic registration failed", file.drive_file_id, error?.message);
          counts.files_queued++;
        } else {
          counts.files_registered++;
          const doc = document as { id: string; document_code: string };
          try {
            await setAppProperties(file.drive_file_id, { wilDocumentCode: doc.document_code, wilDocumentId: doc.id });
            await db.from("documents").update({ code_written_to_drive: true }).eq("id", doc.id);
          } catch (writeError) {
            codesNotWritten++;
            console.error("Could not write appProperties", file.drive_file_id, describeDriveError(writeError));
          }
        }
      }
      if ((index + 1) % PROGRESS_EVERY === 0) await progress();
    }

    // 3. Finish ---------------------------------------------------------------
    const finishedAt = new Date().toISOString();
    await db
      .from("sync_runs")
      .update({
        ...counts,
        status: "succeeded",
        finished_at: finishedAt,
        error_message: codesNotWritten
          ? `${codesNotWritten} code(s) could not be written to Drive and will be retried on the next sync.`
          : null,
      })
      .eq("id", runId);
    await db.from("drive_config").update({ status: "ready", last_synced_at: finishedAt }).eq("id", 1);
    await recordAuditEvent({
      actorId,
      action: "drive_scan_finished",
      entityType: "sync_runs",
      entityId: String(runId),
      newValues: { ...counts, files_total: files.length, codes_not_written: codesNotWritten },
    });
  } catch (error) {
    const message = describeDriveError(error);
    console.error("Initial scan failed", error);
    await db
      .from("sync_runs")
      .update({ ...counts, status: "failed", finished_at: new Date().toISOString(), error_message: message })
      .eq("id", runId);
    await db.from("drive_config").update({ status: "error" }).eq("id", 1);
    await recordAuditEvent({
      actorId,
      action: "drive_scan_finished",
      entityType: "sync_runs",
      entityId: String(runId),
      newValues: { ...counts, status: "failed", error: message },
    }).catch(() => undefined);
  }
}
