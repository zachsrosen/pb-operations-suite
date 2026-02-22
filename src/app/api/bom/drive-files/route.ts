// src/app/api/bom/drive-files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 15;

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const folderId = request.nextUrl.searchParams.get("folderId");
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });

  // Validate folderId format to prevent Drive query injection
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(folderId)) {
    return NextResponse.json({ error: "Invalid folderId format" }, { status: 400 });
  }

  try {
    const token = await getServiceAccountToken([
      "https://www.googleapis.com/auth/drive.readonly",
    ]);

    const query = encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`
    );
    const fields = encodeURIComponent("files(id,name,modifiedTime,size)");
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=modifiedTime%20desc`;

    const driveRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!driveRes.ok) {
      const err = await driveRes.json().catch(() => ({})) as { error?: { message?: string } };
      return NextResponse.json(
        { files: [], error: err.error?.message ?? `Drive error ${driveRes.status}` },
        { status: 200 } // Return 200 with empty list so UI can show graceful message
      );
    }

    const data = await driveRes.json() as { files: DriveFile[] };
    return NextResponse.json({ files: data.files ?? [] });
  } catch (e) {
    return NextResponse.json(
      { files: [], error: e instanceof Error ? e.message : "Drive fetch failed" },
      { status: 200 }
    );
  }
}
