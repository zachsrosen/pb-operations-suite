/**
 * Drive link helpers for the P&I hub.
 *
 * Kept as a leaf module (no imports) so it stays testable without dragging
 * the HubSpot/Gmail clients that detail.ts pulls in.
 */

/**
 * The Drive folder deal properties are not consistently formatted:
 * permit_documents, interconnection_documents and design_documents hold full
 * URLs, but pto___closeout_documents holds a BARE folder id on roughly 75% of
 * deals (measured over a 100-deal sample, 2026-07-17). A bare id rendered as
 * an href becomes a relative link that 404s, so coerce it to a real Drive URL.
 */
export function normalizeDriveFolderUrl(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  // Drive ids are long url-safe tokens; anything shorter is not a usable link.
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) {
    return `https://drive.google.com/drive/folders/${raw}`;
  }
  return null;
}
