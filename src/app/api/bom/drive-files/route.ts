// src/app/api/bom/drive-files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";
import { getToken } from "next-auth/jwt";

export const runtime = "nodejs";
export const maxDuration = 15;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
}

const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";
const DRIVE_PARAMS = "includeItemsFromAllDrives=true&supportsAllDrives=true";

/**
 * Returns the best available Google OAuth token for Drive access.
 * Reads the user's OAuth access_token directly from the JWT (server-side only —
 * never exposed to the client). Falls back to the service account token if the
 * user token is missing or expired.
 */
async function getDriveToken(request: NextRequest): Promise<string> {
  try {
    const jwtToken = await getToken({ req: request });
    const accessToken = (jwtToken as Record<string, unknown> | null)?.accessToken as string | undefined;
    const expires = (jwtToken as Record<string, unknown> | null)?.accessTokenExpires as number | undefined;
    if (accessToken && (expires == null || Date.now() < expires)) {
      return accessToken;
    }
  } catch {
    // fall through to service account
  }
  return getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
}

/** List all items (files + folders) directly inside a Drive folder. */
async function listFolder(folderId: string, token: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,size)");
  const url = `${DRIVE_BASE}?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&${DRIVE_PARAMS}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Drive error ${res.status}`);
  }
  const data = await res.json() as { files: DriveFile[] };
  return data.files ?? [];
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const folderParam = request.nextUrl.searchParams.get("folderId");
  if (!folderParam) return NextResponse.json({ error: "folderId required" }, { status: 400 });

  // Accept either a bare folder ID or a full Drive URL
  const driveUrlMatch = folderParam.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  const folderId = driveUrlMatch ? driveUrlMatch[1] : folderParam;

  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return NextResponse.json({ error: "Invalid folderId format" }, { status: 400 });
  }

  try {
    const token = await getDriveToken(request);

    // Step 1: list everything directly in the folder
    const items = await listFolder(folderId, token);

    // Step 2: collect PDFs directly in this folder
    const pdfs = items.filter(f => f.mimeType === "application/pdf");

    if (pdfs.length > 0) {
      return NextResponse.json({ files: pdfs });
    }

    // Step 3: no PDFs directly here — search one level of subfolders.
    // PB Drive structure: all_document_parent_folder contains subfolders
    // like "Design Documents", "Permit Documents", etc. Prefer a subfolder
    // whose name contains "design" (case-insensitive); fall back to any subfolder.
    const subfolders = items.filter(f =>
      f.mimeType === "application/vnd.google-apps.folder"
    );

    if (subfolders.length === 0) {
      return NextResponse.json({ files: [] });
    }

    // Prioritise design subfolder; otherwise search all subfolders in parallel
    const designFolder = subfolders.find(f =>
      f.name.toLowerCase().includes("design")
    );
    const foldersToSearch = designFolder ? [designFolder] : subfolders;

    const subResults = await Promise.all(
      foldersToSearch.map(sub =>
        listFolder(sub.id, token)
          .then(files => files.filter(f => f.mimeType === "application/pdf"))
          .catch(() => [] as DriveFile[])
      )
    );

    const allPdfs = subResults.flat().sort(
      (a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime()
    );

    return NextResponse.json({ files: allPdfs });

  } catch (e) {
    return NextResponse.json(
      { files: [], error: e instanceof Error ? e.message : "Drive fetch failed" },
      { status: 200 }
    );
  }
}
