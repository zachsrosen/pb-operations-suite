/**
 * List all files in a Google Drive folder recursively.
 * Used by the site-survey-readiness skill to scan survey folder contents.
 *
 * Usage: npx tsx .claude/skills/site-survey-readiness/scripts/list-drive-files.ts <folder-id-or-url>
 *
 * Output: JSON array of { name, mimeType, modifiedTime, size, parentFolder }
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getDriveToken } from "@/lib/drive-plansets";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

interface OutputFile {
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  parentFolder: string;
}

/** Extract folder ID from a Drive URL or return as-is if already an ID. */
function extractFolderId(input: string): string {
  const urlMatch = input.match(/folders\/([a-zA-Z0-9_-]+)/);
  return urlMatch ? urlMatch[1] : input;
}

/** List all non-folder files in a single folder. */
async function listFiles(folderId: string, token: string): Promise<DriveFile[]> {
  const query = `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name,mimeType,modifiedTime,size)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&orderBy=${encodeURIComponent("modifiedTime desc")}` +
    `&pageSize=100` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

/** List subfolders in a folder. */
async function listSubfolders(folderId: string, token: string): Promise<DriveFile[]> {
  const query = `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name,mimeType,modifiedTime)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&pageSize=50` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

/** Recursively list all files, up to maxDepth levels. */
async function walkFolder(
  folderId: string,
  folderName: string,
  token: string,
  depth: number,
  maxDepth: number,
): Promise<OutputFile[]> {
  if (depth > maxDepth) return [];

  const results: OutputFile[] = [];

  const files = await listFiles(folderId, token);
  for (const f of files) {
    results.push({
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size,
      parentFolder: folderName,
    });
  }

  const subfolders = await listSubfolders(folderId, token);
  for (const sf of subfolders) {
    const subPath = folderName ? `${folderName}/${sf.name}` : sf.name;
    const subFiles = await walkFolder(sf.id, subPath, token, depth + 1, maxDepth);
    results.push(...subFiles);
  }

  return results;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npx tsx list-drive-files.ts <folder-id-or-url>");
    process.exit(1);
  }

  const folderId = extractFolderId(input);
  const token = await getDriveToken();
  const files = await walkFolder(folderId, "", token, 0, 3);

  console.log(JSON.stringify(files, null, 2));
  console.error(`\nTotal: ${files.length} files found`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
