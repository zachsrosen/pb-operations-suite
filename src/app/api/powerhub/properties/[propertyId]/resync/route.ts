import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { enqueueCrossSystemPush } from "@/lib/powerhub-crosslink";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = (session.user as { roles?: string[] }).roles ?? [];
  if (!roles.includes("ADMIN") && !roles.includes("OWNER")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { propertyId } = await params;

  try {
    await enqueueCrossSystemPush(propertyId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      `[api/powerhub/properties/${propertyId}/resync] error:`,
      err,
    );
    return NextResponse.json({ error: "Resync failed" }, { status: 500 });
  }
}
