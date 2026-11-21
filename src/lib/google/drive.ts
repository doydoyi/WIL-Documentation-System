import "server-only";
import { getGoogleAccessToken } from "@/lib/google/oauth";

/**
 * Minimal Google Drive API v3 client over fetch. Every call targets the
 * authorized Shared Drive (supportsAllDrives) and none moves, renames or
 * deletes files (FR-1.5.4, NFR-RE-04).
 */

const API = "https://www.googleapis.com/drive/v3";
const MAX_RETRIES = 5;

export class DriveApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  size?: string;
  createdTime: string;
  modifiedTime?: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
}

function isRetryable(status: number, reason: string): boolean {
  return (
    status === 429 ||
    status >= 500 ||
    (status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason))
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Calls the Drive API, retrying rate limits with exponential backoff (UC-1.5 E2). */
async function driveFetch<T>(path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  for (let attempt = 0; ; attempt++) {
    const token = await getGoogleAccessToken();
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
    });
    if (response.ok) return (await response.json()) as T;

    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; errors?: { reason?: string }[] };
    };
    const reason = body.error?.errors?.[0]?.reason ?? "";
    if (attempt < MAX_RETRIES && isRetryable(response.status, reason)) {
      await sleep(Math.min(32_000, 1000 * 2 ** attempt) + Math.random() * 500);
      continue;
    }
    throw new DriveApiError(response.status, reason, body.error?.message ?? `Drive API error ${response.status}`);
  }
}

export async function getSharedDrive(driveId: string): Promise<{ id: string; name: string }> {
  return driveFetch(`/drives/${encodeURIComponent(driveId)}`, { query: { fields: "id,name" } });
}

const ITEM_FIELDS =
  "id,name,mimeType,parents,webViewLink,size,createdTime,modifiedTime,trashed,appProperties";

/** Every non-trashed item (files and folders) in the Shared Drive. */
export async function listSharedDriveItems(
  driveId: string,
  fields: string = ITEM_FIELDS,
): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const page = await driveFetch<{ files: DriveItem[]; nextPageToken?: string }>("/files", {
      query: {
        corpora: "drive",
        driveId,
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
        q: "trashed = false",
        pageSize: "1000",
        fields: `nextPageToken,files(${fields})`,
        ...(pageToken ? { pageToken } : {}),
      },
    });
    items.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

export async function getStartPageToken(driveId: string): Promise<string> {
  const result = await driveFetch<{ startPageToken: string }>("/changes/startPageToken", {
    query: { driveId, supportsAllDrives: "true" },
  });
  return result.startPageToken;
}

/**
 * Writes private application properties, such as the document code, to a
 * file (FR-2.2.9). The file name and location are not changed.
 */
export async function setAppProperties(fileId: string, appProperties: Record<string, string>): Promise<void> {
  await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    query: { supportsAllDrives: "true", fields: "id" },
    body: JSON.stringify({ appProperties }),
  });
}

/** Explains Drive errors in terms the Administrator can act on (UC-1.5 E1). */
export function describeDriveError(error: unknown): string {
  if (error instanceof DriveApiError) {
    if (error.status === 404 || error.status === 403) {
      return "The connected Google account cannot access this Shared Drive. Check the ID, and make sure the account is a member of the Shared Drive (Content manager or higher).";
    }
    if (error.status === 401) {
      return "Google access has expired. Reconnect the Google account and try again.";
    }
    return `Google Drive returned an error: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Google Drive could not be reached. Try again.";
}
