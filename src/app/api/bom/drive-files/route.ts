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
  modifiedTime: string;
  size: string;
}

/**
 * Returns the best available Google OAuth token for Drive access.
 * Reads the user's OAuth access_token directly from the JWT (server-side only —
 * never exposed to the client). Falls back to the service account token if the
 * user token is missing or expired.
 */
async function getDriveToken(request: NextRequest): Promise<{ token: string; source: string }> {
  // Prefer user's OAuth token — has natural Workspace Drive access
  try {
    const jwtToken = await getToken({ req: request });
    const accessToken = (jwtToken as Record<string, unknown> | null)?.accessToken as string | undefined;
    const expires = (jwtToken as Record<string, unknown> | null)?.accessTokenExpires as number | undefined;
    const scopes = (jwtToken as Record<string, unknown> | null)?.scope as string | undefined;
    if (accessToken && (expires == null || Date.now() < expires)) {
      return { token: accessToken, source: `user-oauth (scopes: ${scopes ?? "unknown"}, expires: ${expires ? new Date(expires).toISOString() : "none"})` };
    }
    if (accessToken) {
      return { token: accessToken, source: `user-oauth-expired (expired at ${expires ? new Date(expires).toISOString() : "unknown"})` };
    }
  } catch (e) {
    console.error("[drive-files] getToken error:", e);
  }

  // Fallback: service account (requires manual folder sharing)
  const saToken = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
  return { token: saToken, source: "service-account" };
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const folderParam = request.nextUrl.searchParams.get("folderId");
  if (!folderParam) return NextResponse.json({ error: "folderId required" }, { status: 400 });

  // Accept either a bare folder ID or a full Drive URL — extract ID from URL if needed.
  // Handles: https://drive.google.com/drive/folders/FOLDER_ID
  //          https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
  const driveUrlMatch = folderParam.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  const folderId = driveUrlMatch ? driveUrlMatch[1] : folderParam;

  // Validate bare folder ID format to prevent Drive query injection
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return NextResponse.json({ error: "Invalid folderId format" }, { status: 400 });
  }

  try {
    const { token, source: tokenSource } = await getDriveToken(request);

    const query = encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`
    );
    const fields = encodeURIComponent("files(id,name,modifiedTime,size)");
    // includeItemsFromAllDrives + supportsAllDrives are required for Shared/Team Drives
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime%20desc&includeItemsFromAllDrives=true&supportsAllDrives=true`;

    console.log(`[drive-files] folderId=${folderId} token=${tokenSource}`);

    const driveRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const rawBody = await driveRes.text();
    console.log(`[drive-files] Drive API status=${driveRes.status} body=${rawBody.slice(0, 500)}`);

    if (!driveRes.ok) {
      let errMsg = `Drive error ${driveRes.status}`;
      try { errMsg = (JSON.parse(rawBody) as { error?: { message?: string } }).error?.message ?? errMsg; } catch { /* raw */ }
      return NextResponse.json(
        { files: [], error: errMsg, debug: { folderId, tokenSource, status: driveRes.status, body: rawBody.slice(0, 500) } },
        { status: 200 }
      );
    }

    const data = JSON.parse(rawBody) as { files: DriveFile[] };
    return NextResponse.json({
      files: data.files ?? [],
      debug: { folderId, tokenSource, fileCount: (data.files ?? []).length },
    });
  } catch (e) {
    return NextResponse.json(
      { files: [], error: e instanceof Error ? e.message : "Drive fetch failed", debug: { folderId } },
      { status: 200 }
    );
  }
}
