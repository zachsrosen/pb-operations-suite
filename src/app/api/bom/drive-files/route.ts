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
const DRIVE_PARAMS = "includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=100";
const MAX_SEARCH_DEPTH = 4;
const MAX_FOLDERS_TO_SCAN = 60;

/**
 * Refreshes a Google OAuth access token using the stored refresh token.
 * Returns the new access token string, or null if refresh fails.
 */
async function refreshUserToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

function isHttpsRequest(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return proto === "https";
}

/**
 * Auth.js v5 getToken() needs both:
 * 1) explicit secret
 * 2) matching secureCookie mode (affects cookie name + salt)
 * Try both secure/non-secure cookie modes to handle local + production.
 */
async function getJwtToken(request: NextRequest): Promise<Record<string, unknown> | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const secureFirst = isHttpsRequest(request);
  const attempts = secureFirst ? [true, false] : [false, true];

  for (const secureCookie of attempts) {
    try {
      const token = await getToken({ req: request, secret, secureCookie });
      if (token && typeof token === "object") {
        return token as Record<string, unknown>;
      }
    } catch {
      // try the next cookie mode
    }
  }

  return null;
}

/**
 * Returns the best available Google OAuth token for Drive access.
 * Priority:
 *  1. User's JWT access_token if not expired
 *  2. Refreshed user token (using stored refresh_token) when access_token is expired
 *  3. Service account token as final fallback
 *
 * Returns both the token and a tokenSource label for debugging.
 */
async function getDriveToken(request: NextRequest): Promise<{ token: string; tokenSource: string }> {
  try {
    const jwtToken = await getJwtToken(request);
    const accessToken = jwtToken?.accessToken as string | undefined;
    const expires = jwtToken?.accessTokenExpires as number | undefined;
    const refreshToken = jwtToken?.refreshToken as string | undefined;

    if (accessToken && (expires == null || Date.now() < expires - 60_000)) {
      return { token: accessToken, tokenSource: "user_oauth" };
    }

    // Access token expired — try to refresh using the stored refresh_token
    if (refreshToken) {
      const refreshed = await refreshUserToken(refreshToken);
      if (refreshed) {
        return { token: refreshed, tokenSource: "user_oauth_refreshed" };
      }
    }
  } catch {
    // fall through to service account
  }

  const saToken = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
  return { token: saToken, tokenSource: "service_account" };
}

function parseFolderId(rawFolderParam: string): string {
  const folderPathMatch = rawFolderParam.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderPathMatch?.[1]) return folderPathMatch[1];

  try {
    const parsed = new URL(rawFolderParam);
    const id = parsed.searchParams.get("id");
    if (id) return id;
  } catch {
    // rawFolderParam may already be a bare folder ID
  }

  return rawFolderParam;
}

async function listDriveFilesByQuery(
  query: string,
  token: string,
  fields: string
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const q = encodeURIComponent(query);
    const encodedFields = encodeURIComponent(`nextPageToken,files(${fields})`);
    const pageTokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const url = `${DRIVE_BASE}?q=${q}&fields=${encodedFields}&orderBy=modifiedTime%20desc&${DRIVE_PARAMS}${pageTokenParam}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `Drive error ${res.status}`);
    }

    const data = await res.json() as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

async function listPdfFilesInFolder(folderId: string, token: string): Promise<DriveFile[]> {
  return listDriveFilesByQuery(
    `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    token,
    "id,name,mimeType,modifiedTime,size"
  );
}

async function listSubfolders(folderId: string, token: string): Promise<DriveFile[]> {
  return listDriveFilesByQuery(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    token,
    "id,name,mimeType,modifiedTime,size"
  );
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const folderParam = request.nextUrl.searchParams.get("folderId");
  if (!folderParam) return NextResponse.json({ error: "folderId required" }, { status: 400 });

  // Accept either a bare folder ID or a full Drive URL
  const folderId = parseFolderId(folderParam);

  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return NextResponse.json({ error: "Invalid folderId format" }, { status: 400 });
  }

  try {
    const { token, tokenSource } = await getDriveToken(request);
    // Breadth-first folder scan so PDFs nested under "Design Documents/..." are found.
    const queue: Array<{ id: string; depth: number }> = [{ id: folderId, depth: 0 }];
    const visited = new Set<string>();
    const foundPdfs = new Map<string, DriveFile>();
    let scannedFolders = 0;

    while (queue.length > 0 && scannedFolders < MAX_FOLDERS_TO_SCAN) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      scannedFolders += 1;

      const pdfs = await listPdfFilesInFolder(current.id, token);
      for (const pdf of pdfs) {
        if (!foundPdfs.has(pdf.id)) foundPdfs.set(pdf.id, pdf);
      }

      if (current.depth >= MAX_SEARCH_DEPTH) continue;

      const subfolders = await listSubfolders(current.id, token);
      for (const folder of subfolders) {
        if (!visited.has(folder.id)) {
          queue.push({ id: folder.id, depth: current.depth + 1 });
        }
      }
    }

    const files = Array.from(foundPdfs.values()).sort(
      (a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime()
    );

    return NextResponse.json({
      files,
      debug: {
        tokenSource,
        folderId,
        scannedFolders,
        maxDepth: MAX_SEARCH_DEPTH,
        pdfsFound: files.length,
      },
    });

  } catch (e) {
    return NextResponse.json(
      { files: [], error: e instanceof Error ? e.message : "Drive fetch failed" },
      { status: 200 }
    );
  }
}
