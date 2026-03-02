/**
 * Drive Planset Helpers
 *
 * Shared module for listing, selecting, and downloading planset PDFs from
 * Google Drive. Used by both the BOM pipeline and design review systems.
 *
 * Extracted from bom-pipeline.ts to avoid coupling design review to the
 * BOM pipeline module.
 */

import { getServiceAccountToken } from "@/lib/google-auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrivePdfFile {
  id: string;
  name: string;
  modifiedTime: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Get a Drive-scoped token, preferring domain-wide delegation (impersonation). */
export async function getDriveToken(): Promise<string> {
  const impersonateEmail = process.env.GOOGLE_ADMIN_EMAIL ?? process.env.GMAIL_SENDER_EMAIL;
  if (impersonateEmail) {
    try {
      return await getServiceAccountToken(
        ["https://www.googleapis.com/auth/drive.readonly"],
        impersonateEmail,
      );
    } catch {
      // DWD not configured — fall through to plain SA
    }
  }
  return getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** List PDF files in a Google Drive folder, sorted by modifiedTime descending. */
export async function listDrivePdfs(folderId: string): Promise<DrivePdfFile[]> {
  const token = await getDriveToken();

  const query = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
  const fields = "files(id,name,modifiedTime)";
  const orderBy = "modifiedTime desc";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&orderBy=${encodeURIComponent(orderBy)}` +
    `&pageSize=50` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { files?: DrivePdfFile[] };
  return data.files ?? [];
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

/**
 * Filename patterns that indicate a document is NOT a planset.
 * These are excluded before selection to avoid extracting from
 * cover letters, response letters, permit apps, etc.
 */
export const NON_PLANSET_PATTERNS = [
  /response\s*letter/i,
  /cover\s*letter/i,
  /permit\s*app/i,
  /revision\s*(response|letter|comment)/i,
  /plan\s*check\s*(comment|response|correction)/i,
  /inspection\s*report/i,
  /approval\s*letter/i,
  /^invoice/i,
  /^receipt/i,
  /^proposal/i,
  /^contract/i,
];

/** Pick the best planset PDF from a list — prefer "stamped" or "planset" in name. */
export function pickBestPlanset(files: DrivePdfFile[]): DrivePdfFile | null {
  if (files.length === 0) return null;

  // Filter out known non-planset documents
  const candidates = files.filter(
    (f) => !NON_PLANSET_PATTERNS.some((p) => p.test(f.name)),
  );

  // Prefer files with "stamped" in the name (case-insensitive)
  const stamped = candidates.filter((f) => /stamped/i.test(f.name));
  if (stamped.length > 0) return stamped[0]; // already sorted by modifiedTime desc

  // Fallback to files with "planset" or "plan set" in the name
  const planset = candidates.filter((f) => /plan\s*set/i.test(f.name));
  if (planset.length > 0) return planset[0];

  // Prefer files with PROJ-XXXX (project number) — design plans include project number + customer + date
  const projNumbered = candidates.filter((f) => /PROJ-\d{4,}/i.test(f.name));
  if (projNumbered.length > 0) return projNumbered[0];

  // Last resort: newest PDF from candidates (if any survived filtering)
  if (candidates.length > 0) return candidates[0];

  // If ALL files were excluded, fall back to original list with a warning
  console.warn(
    `[drive-plansets] All ${files.length} PDFs matched non-planset patterns — falling back to newest: ${files[0].name}`,
  );
  return files[0];
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Download a PDF from Google Drive as a Buffer. */
export async function downloadDrivePdf(fileId: string): Promise<{ buffer: Buffer; filename: string }> {
  const token = await getDriveToken();

  // Get file metadata for the filename
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const meta = metaRes.ok ? (await metaRes.json() as { name?: string }) : {};
  const filename = meta.name ?? `planset-${fileId}.pdf`;

  // Download content
  const dlUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const dlRes = await fetch(dlUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!dlRes.ok) {
    const body = await dlRes.text().catch(() => "");
    throw new Error(`Drive download ${dlRes.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await dlRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), filename };
}
