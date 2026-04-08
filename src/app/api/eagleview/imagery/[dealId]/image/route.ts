import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getDriveToken } from "@/lib/drive-plansets";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const record = await prisma.eagleViewImagery.findUnique({ where: { dealId } });

  if (!record?.driveFileId) {
    return NextResponse.json({ error: "No imagery found for this deal" }, { status: 404 });
  }

  const token = await getDriveToken();
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${record.driveFileId}?alt=media&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!driveRes.ok) {
    return NextResponse.json(
      { error: `Drive fetch failed: ${driveRes.status}` },
      { status: 502 },
    );
  }

  const contentType = driveRes.headers.get("content-type") ?? "image/png";

  return new NextResponse(driveRes.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
