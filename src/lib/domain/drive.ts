/**
 * Pure helpers for working with Shared Drive metadata.
 */

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/**
 * Accepts a Shared Drive ID or a Drive URL and returns the ID.
 *   https://drive.google.com/drive/folders/0ABCdefGhIJk?usp=sharing
 *   https://drive.google.com/drive/u/1/folders/0ABCdefGhIJk
 *   0ABCdefGhIJk
 */
export function parseDriveId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  let candidate = value;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;
    const folderMatch = /\/folders\/([^/?#]+)/.exec(url.pathname);
    const idParam = url.searchParams.get("id");
    candidate = folderMatch?.[1] ?? idParam ?? "";
  }

  return /^[A-Za-z0-9_-]{10,100}$/.test(candidate) ? candidate : null;
}

/** Parses a comma, space or newline separated list of folder IDs or URLs. */
export function parseDriveIdList(input: string): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const token of input.split(/[\s,]+/).filter(Boolean)) {
    const id = parseDriveId(token);
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else {
      invalid.push(token);
    }
  }
  return { ids, invalid };
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Index of the Shared Drive's folders, used to build human-readable folder
 * paths (for folder-path classification rules) and to detect files inside
 * excluded folders, including nested sub-folders.
 */
export class FolderTree {
  private readonly folders = new Map<string, FolderNode>();
  private readonly pathCache = new Map<string, string>();

  constructor(
    private readonly driveId: string,
    folders: FolderNode[],
  ) {
    for (const folder of folders) this.folders.set(folder.id, folder);
  }

  /** Folder IDs from the given folder up to (not including) the drive root. */
  ancestors(folderId: string | null): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = folderId;
    while (current && current !== this.driveId && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = this.folders.get(current)?.parentId ?? null;
    }
    return chain;
  }

  /** Path such as "/Events/2026/Hackathon"; "/" for files at the drive root. */
  pathOf(folderId: string | null): string {
    if (!folderId || folderId === this.driveId) return "/";
    const cached = this.pathCache.get(folderId);
    if (cached) return cached;
    const names = this.ancestors(folderId)
      .reverse()
      .map((id) => this.folders.get(id)?.name ?? "(unknown folder)");
    const path = "/" + names.join("/");
    this.pathCache.set(folderId, path);
    return path;
  }

  isExcluded(folderId: string | null, excludedFolderIds: ReadonlySet<string>): boolean {
    if (excludedFolderIds.size === 0) return false;
    return this.ancestors(folderId).some((id) => excludedFolderIds.has(id));
  }
}

/** Strips a short file extension: "Report.final.docx" -> "Report.final". */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || name;
}
