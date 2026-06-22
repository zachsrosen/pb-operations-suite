import { extractFolderId } from "@/lib/drive-plansets";

/**
 * Resolve a Google Drive folder ID from one or more HubSpot deal fields.
 *
 * HubSpot Drive-folder fields are inconsistent: some hold a bare folder ID
 * (e.g. `all_document_parent_folder_id`), others hold a full Drive URL
 * (e.g. `design_documents` = "https://drive.google.com/drive/folders/<id>").
 * Passing a URL straight to the Drive API as a parent fails — that stranded
 * EagleView deliveries with `drive_folder_create_failed`. See FS #1066 and the
 * "drive folder fields are URLs" reference.
 *
 * Each candidate is run through {@link extractFolderId} (URL → ID, bare ID
 * passthrough); the first that yields a usable ID wins. Null/empty candidates
 * are skipped so callers can pass a preference-ordered list.
 */
export function resolveDriveFolderId(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const id = extractFolderId(candidate);
    if (id) return id;
  }
  return null;
}
