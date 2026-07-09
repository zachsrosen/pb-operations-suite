import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { isAllowedPhotoPath } from "@/lib/idr-escalation-photos";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });
  if (!isAllowedPhotoPath(path)) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const result = await get(path, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob?.contentType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[idr/escalation-photos/view] Fetch failed:", msg);
    return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 500 });
  }
}
