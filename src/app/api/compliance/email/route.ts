import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { getComplianceDigest } from "@/lib/compliance-digest";
import { sendWeeklyComplianceEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user || !["ADMIN", "OWNER"].includes(user.role)) {
    return NextResponse.json({ error: "Admin or Owner access required" }, { status: 403 });
  }

  let body: { to?: string; days?: number; threshold?: number } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = body.to?.trim();
  if (!to || !to.includes("@")) {
    return NextResponse.json({ error: "Valid 'to' email address required" }, { status: 400 });
  }

  const days = Math.max(1, Math.min(90, Math.floor(Number(body.days) || 7)));
  const threshold = Math.max(1, Math.min(50, Math.floor(Number(body.threshold) || 5)));

  try {
    const digest = await getComplianceDigest(days, { threshold });
    const result = await sendWeeklyComplianceEmail({ to, digest });

    return NextResponse.json({
      success: result.success,
      error: result.error,
      period: digest.period,
      summary: digest.summary,
      baseline30Day: digest.baseline30Day,
      userGrowth: {
        improvers: digest.userGrowth.improvers.length,
        decliners: digest.userGrowth.decliners.length,
        threshold: digest.userGrowth.threshold,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
