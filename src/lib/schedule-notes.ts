/**
 * Pure utility functions for parsing and updating installer notes
 * within ScheduleRecord notes blobs.
 *
 * Notes blobs have the format:
 *   [TENTATIVE] Tentatively scheduled via Master Scheduler — CrewName [TZ:America/Denver] [AUTO_OPTIMIZED]
 *
 *   Installer Notes: some user text here
 *
 * System tags that must be preserved:
 *   [TENTATIVE], [CONFIRMED], [TZ:...], [AUTO_OPTIMIZED]
 *   Trailing "— CrewName" on the first line
 */

const INSTALLER_NOTES_MARKER = "Installer Notes:";

// Max length for installer notes to prevent oversized blobs
export const MAX_INSTALLER_NOTE_LENGTH = 2000;

/**
 * Extract just the installer note text from a ScheduleRecord notes blob.
 * Strips system tags before parsing.
 */
export function extractInstallerNote(rawNotes: string | null | undefined): string {
  if (typeof rawNotes !== "string" || !rawNotes.trim()) return "";

  const cleaned = rawNotes
    .replace(/\[(?:TENTATIVE|CONFIRMED)\]\s*/gi, "")
    .replace(/\[TZ:[^\]]+\]/gi, "")
    .replace(/\[AUTO_OPTIMIZED\]/gi, "")
    .trim();

  const markerMatch = cleaned.match(/Installer Notes:\s*([\s\S]+)/i);
  return markerMatch?.[1]?.trim() || "";
}

/**
 * Insert or replace the Installer Notes segment in a notes blob,
 * preserving all system tags and crew suffix.
 *
 * If newInstallerNote is empty/whitespace, removes the Installer Notes
 * segment cleanly.
 */
export function upsertInstallerNoteInBlob(
  existingNotes: string | null | undefined,
  newInstallerNote: string
): string {
  const trimmedNote = newInstallerNote.trim().slice(0, MAX_INSTALLER_NOTE_LENGTH);
  const blob = existingNotes || "";

  // Check if there's an existing "Installer Notes:" segment
  const markerIndex = blob.search(/Installer Notes:/i);

  if (markerIndex >= 0) {
    // Replace everything from marker onward
    const beforeMarker = blob.slice(0, markerIndex).trimEnd();
    if (!trimmedNote) {
      // Remove the segment cleanly — trim trailing whitespace/newlines
      return beforeMarker;
    }
    return `${beforeMarker}\n\n${INSTALLER_NOTES_MARKER} ${trimmedNote}`;
  }

  // No existing marker — append if there's a note to add
  if (!trimmedNote) return blob;

  const base = blob.trimEnd();
  if (!base) return `${INSTALLER_NOTES_MARKER} ${trimmedNote}`;
  return `${base}\n\n${INSTALLER_NOTES_MARKER} ${trimmedNote}`;
}
