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
  /** File size in bytes (string from Drive API). */
  size?: string;
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

/** Get a Drive-scoped token with write access (for creating folders, copying files). */
export async function getDriveWriteToken(): Promise<string> {
  const impersonateEmail = process.env.GOOGLE_ADMIN_EMAIL ?? process.env.GMAIL_SENDER_EMAIL;
  if (impersonateEmail) {
    try {
      return await getServiceAccountToken(
        ["https://www.googleapis.com/auth/drive"],
        impersonateEmail,
      );
    } catch {
      // DWD not configured — fall through to plain SA
    }
  }
  return getServiceAccountToken(["https://www.googleapis.com/auth/drive"]);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** List PDF files in a Google Drive folder, sorted by modifiedTime descending. */
export async function listDrivePdfs(folderId: string): Promise<DrivePdfFile[]> {
  const token = await getDriveToken();

  const query = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
  const fields = "files(id,name,modifiedTime,size)";
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
  /design\s*approval/i,
  /customer\s*approval/i,
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
  if (stamped.length > 0) {
    const bestStamped = pickLargest(stamped);
    const overallLargest = pickLargest(candidates);
    const stampedSize = Number(bestStamped.size) || 0;
    const largestSize = Number(overallLargest.size) || 0;

    // If the stamped file is significantly smaller than the largest candidate,
    // it's likely not a real planset (e.g., "Stamped barn plans" at 2.8MB vs
    // the actual 29MB planset). Skip the stamped tier and fall through.
    if (stampedSize > 0 && largestSize > 0 && stampedSize < largestSize / 3) {
      console.warn(
        `[drive-plansets] Stamped file "${bestStamped.name}" (${(stampedSize / 1e6).toFixed(1)}MB) ` +
        `is <1/3 size of largest candidate "${overallLargest.name}" (${(largestSize / 1e6).toFixed(1)}MB) — skipping stamped preference`,
      );
    } else {
      return bestStamped;
    }
  }

  // Fallback to files with "planset" or "plan set" in the name
  const planset = candidates.filter((f) => /plan\s*set/i.test(f.name));
  if (planset.length > 0) return planset[0];

  // Prefer files with PROJ-XXXX (project number) — design plans include project number + customer + date
  const projNumbered = candidates.filter((f) => /PROJ-\d{4,}/i.test(f.name));
  if (projNumbered.length > 0) return pickLargest(projNumbered);

  // Last resort: largest PDF from candidates — full plansets are almost always
  // the biggest file in the folder (10-50+ pages vs 2-3 page approvals/letters)
  if (candidates.length > 0) return pickLargest(candidates);

  // If ALL files were excluded, fall back to largest from original list
  console.warn(
    `[drive-plansets] All ${files.length} PDFs matched non-planset patterns — falling back to largest`,
  );
  return pickLargest(files);
}

/** Pick the largest file from a list (plansets are almost always the biggest PDF). */
function pickLargest(files: DrivePdfFile[]): DrivePdfFile {
  return files.reduce((best, f) => {
    const bestSize = Number(best.size) || 0;
    const fSize = Number(f.size) || 0;
    return fSize > bestSize ? f : best;
  }, files[0]);
}

// ---------------------------------------------------------------------------
// Subfolder navigation — prefer "Stamped Plans" inside Design folder
// ---------------------------------------------------------------------------

/** Patterns for the stamped plans subfolder name. */
const STAMPED_FOLDER_PATTERNS = [
  /stamped\s*plans?/i,
  /^stamped$/i,
];

/**
 * Look for a "Stamped Plans" subfolder inside the given folder.
 * Returns the subfolder ID if found, null otherwise.
 */
export async function findStampedPlansFolder(parentFolderId: string): Promise<string | null> {
  const token = await getDriveToken();

  const query = `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&pageSize=50` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = await res.json() as { files?: Array<{ id: string; name: string }> };
  const folders = data.files ?? [];

  const stamped = folders.find((f) =>
    STAMPED_FOLDER_PATTERNS.some((p) => p.test(f.name)),
  );
  return stamped?.id ?? null;
}

/**
 * List planset PDFs, preferring the "Stamped Plans" subfolder if it exists.
 * Falls back to the parent folder if no subfolder found.
 */
export async function listPlansetPdfs(designFolderId: string): Promise<DrivePdfFile[]> {
  // Try "Stamped Plans" subfolder first
  const stampedFolderId = await findStampedPlansFolder(designFolderId);
  if (stampedFolderId) {
    const files = await listDrivePdfs(stampedFolderId);
    if (files.length > 0) {
      console.log(`[drive-plansets] Found ${files.length} PDFs in Stamped Plans subfolder`);
      return files;
    }
  }

  // Fallback to parent design folder
  return listDrivePdfs(designFolderId);
}

// ---------------------------------------------------------------------------
// URL / ID helpers
// ---------------------------------------------------------------------------

/** Extract a Google Drive folder ID from a URL or bare ID. */
export function extractFolderId(input: string): string | null {
  // Full URL: https://drive.google.com/drive/folders/FOLDER_ID?...
  const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // Bare alphanumeric ID (no slashes)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim();

  return null;
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

// ---------------------------------------------------------------------------
// Install / Construction Photos from Drive
// ---------------------------------------------------------------------------

export interface DriveImageFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

/** Patterns for construction / install photos subfolder names. */
const PHOTOS_FOLDER_PATTERNS = [
  /construction\s*photo/i,
  /install(ation)?\s*photo/i,
  /^photos$/i,
  /^construction$/i,
  /job\s*photo/i,
  /field\s*photo/i,
  /site\s*photo/i,
];

/**
 * Search for a construction/install photos subfolder inside the given folder.
 * Searches recursively one level deep (parent → child folders).
 */
export async function findPhotosFolder(parentFolderId: string): Promise<string | null> {
  const token = await getDriveToken();

  const query = `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&pageSize=100` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  const folders = data.files ?? [];

  // Direct match at this level
  const direct = folders.find((f) => PHOTOS_FOLDER_PATTERNS.some((p) => p.test(f.name)));
  if (direct) return direct.id;

  // One level deeper — check inside "Construction" or similar parent folders
  const constructionLike = folders.filter((f) =>
    /construct|install|field|job/i.test(f.name),
  );
  for (const folder of constructionLike) {
    const subQuery = `'${folder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const subUrl =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subQuery)}` +
      `&fields=${encodeURIComponent(fields)}` +
      `&pageSize=50` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const subRes = await fetch(subUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!subRes.ok) continue;

    const subData = (await subRes.json()) as { files?: Array<{ id: string; name: string }> };
    const subMatch = (subData.files ?? []).find((f) =>
      PHOTOS_FOLDER_PATTERNS.some((p) => p.test(f.name)),
    );
    if (subMatch) return subMatch.id;

    // If "Construction" folder itself has images directly (no subfolder), use it
    const hasImages = await listDriveImages(folder.id);
    if (hasImages.length > 0) return folder.id;
  }

  return null;
}

/** List image files in a Google Drive folder, sorted by modifiedTime descending. */
export async function listDriveImages(folderId: string): Promise<DriveImageFile[]> {
  const token = await getDriveToken();

  const mimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ];
  const mimeFilter = mimeTypes.map((m) => `mimeType='${m}'`).join(" or ");
  const query = `'${folderId}' in parents and (${mimeFilter}) and trashed=false`;
  const fields = "files(id,name,mimeType,modifiedTime,size)";
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
    console.warn(`[drive] Failed to list images in ${folderId}: ${res.status} ${body.slice(0, 200)}`);
    return [];
  }

  const data = (await res.json()) as { files?: DriveImageFile[] };
  return data.files ?? [];
}

/**
 * Recursively list image files across a folder and all its subfolders.
 * Searches up to `maxDepth` levels deep and returns up to `maxImages` results.
 */
export async function listDriveImagesRecursive(
  folderId: string,
  maxDepth = 3,
  maxImages = 30,
): Promise<DriveImageFile[]> {
  const allImages: DriveImageFile[] = [];

  async function walk(parentId: string, depth: number) {
    if (depth > maxDepth || allImages.length >= maxImages) return;

    // Fetch images at this level
    const images = await listDriveImages(parentId);
    for (const img of images) {
      if (allImages.length >= maxImages) break;
      allImages.push(img);
    }

    // Fetch subfolders and recurse
    const token = await getDriveToken();
    const query = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const fields = "files(id,name)";
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
      `&fields=${encodeURIComponent(fields)}` +
      `&pageSize=50` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) return;

    const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
    const subfolders = data.files ?? [];

    for (const sub of subfolders) {
      if (allImages.length >= maxImages) break;
      await walk(sub.id, depth + 1);
    }
  }

  await walk(folderId, 0);
  return allImages;
}

/** HEIC/HEIF mime types that need conversion via Drive thumbnail. */
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

/**
 * Download an image from Google Drive as a Buffer.
 * For HEIC/HEIF images, fetches the Drive thumbnail (JPEG) instead,
 * since Claude's vision API doesn't support HEIC.
 */
export async function downloadDriveImage(
  fileId: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const token = await getDriveToken();

  // Get file metadata (include thumbnailLink for HEIC fallback)
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType,thumbnailLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const meta = metaRes.ok
    ? ((await metaRes.json()) as { name?: string; mimeType?: string; thumbnailLink?: string })
    : {};
  const filename = meta.name ?? `photo-${fileId}.jpg`;
  const mimeType = meta.mimeType ?? "image/jpeg";
  const isHeic = HEIC_TYPES.has(mimeType) || /\.heic$/i.test(filename) || /\.heif$/i.test(filename);

  // For HEIC/HEIF: use Google Drive thumbnail (served as JPEG) at high resolution
  if (isHeic && meta.thumbnailLink) {
    const thumbUrl = meta.thumbnailLink.replace(/=s\d+$/, "=s1024");
    const thumbRes = await fetch(thumbUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (thumbRes.ok) {
      const ab = await thumbRes.arrayBuffer();
      const outName = filename.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg");
      console.log(`[drive] HEIC→thumbnail JPEG: ${filename} → ${outName} (${Math.round(ab.byteLength / 1024)}KB)`);
      return { buffer: Buffer.from(ab), filename: outName, mimeType: "image/jpeg" };
    }
    console.warn(`[drive] Thumbnail fetch failed for ${filename}: ${thumbRes.status}`);
  }

  // Standard download for non-HEIC (or HEIC without thumbnail)
  const dlUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const dlRes = await fetch(dlUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!dlRes.ok) {
    const body = await dlRes.text().catch(() => "");
    throw new Error(`Drive image download ${dlRes.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await dlRes.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), filename, mimeType };
}

// ---------------------------------------------------------------------------
// General-purpose folder/file listing (used by pe-turnover)
// ---------------------------------------------------------------------------

export interface DriveFolder {
  id: string;
  name: string;
}

/** List immediate subfolders of a Drive folder. */
export async function listDriveSubfolders(folderId: string): Promise<DriveFolder[]> {
  const token = await getDriveToken();

  const query = `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&pageSize=100` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { files?: DriveFolder[] };
  return data.files ?? [];
}

export interface DriveGenericFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

/** List ALL non-folder files in a Drive folder (any type), sorted by modifiedTime desc. */
export async function listDriveFiles(folderId: string): Promise<DriveGenericFile[]> {
  const token = await getDriveToken();

  const query = `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name,mimeType,modifiedTime,size)";
  const orderBy = "modifiedTime desc";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&orderBy=${encodeURIComponent(orderBy)}` +
    `&pageSize=100` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { files?: DriveGenericFile[] };
  return data.files ?? [];
}

/** Download any file from Drive as a Buffer. For images, prefer downloadDriveImage() for HEIC support. */
export async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const token = await getDriveToken();

  // Get metadata first for filename
  const metaUrl =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?fields=name,mimeType&supportsAllDrives=true`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!metaRes.ok) throw new Error(`Drive metadata ${metaRes.status}`);
  const meta = (await metaRes.json()) as { name: string; mimeType: string };

  // Download content
  const dlUrl =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&supportsAllDrives=true`;
  const dlRes = await fetch(dlUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!dlRes.ok) throw new Error(`Drive download ${dlRes.status}`);

  const arrayBuffer = await dlRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filename: meta.name,
    mimeType: meta.mimeType,
  };
}

/** Create a subfolder inside a Drive folder. Returns the new folder. */
export async function createDriveFolder(parentId: string, name: string): Promise<DriveFolder> {
  const token = await getDriveWriteToken();

  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive create folder ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  return { id: data.id, name: data.name };
}

/** Copy a file within Drive, optionally renaming it. Returns the new file. */
export async function copyDriveFile(
  fileId: string,
  destFolderId: string,
  newName?: string,
): Promise<{ id: string; name: string }> {
  const token = await getDriveWriteToken();

  const body: Record<string, unknown> = { parents: [destFolderId] };
  if (newName) body.name = newName;

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive copy file ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  return { id: data.id, name: data.name };
}

/** Upload a text file to a Drive folder. Returns the new file. */
export async function uploadDriveTextFile(
  parentId: string,
  filename: string,
  content: string,
): Promise<{ id: string; name: string }> {
  const token = await getDriveWriteToken();

  // Multipart upload: metadata + content
  const boundary = "pe_turnover_boundary";
  const metadata = JSON.stringify({
    name: filename,
    mimeType: "text/plain",
    parents: [parentId],
  });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Drive upload ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  return { id: data.id, name: data.name };
}

/**
 * Upload a binary file (PDF, image, ZIP, etc.) to Google Drive using the
 * multipart upload protocol. Counterpart to `uploadDriveTextFile`.
 */
export async function uploadDriveBinaryFile(
  parentId: string,
  filename: string,
  content: ArrayBuffer | Uint8Array | Buffer,
  mimeType: string,
): Promise<{ id: string; name: string }> {
  const token = await getDriveWriteToken();

  const boundary = `pb_drive_boundary_${Date.now()}`;
  const metadata = JSON.stringify({
    name: filename,
    mimeType,
    parents: [parentId],
  });

  const bodyParts = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${metadata}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`,
      "utf-8",
    ),
    Buffer.isBuffer(content)
      ? content
      : content instanceof Uint8Array
        ? Buffer.from(content)
        : Buffer.from(new Uint8Array(content)),
    Buffer.from(`\r\n--${boundary}--`, "utf-8"),
  ];
  const body = Buffer.concat(bodyParts);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Drive binary upload ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  return { id: data.id, name: data.name };
}
