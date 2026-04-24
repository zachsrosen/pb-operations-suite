// src/app/api/cron/task-digest/route.ts
//
// Vercel cron — emails Zach a digest of his open HubSpot tasks +
// Freshservice tickets (agent-assigned). Schedule: weekdays 14:00 UTC
// (8:00 AM Mountain Daylight Time; 7:00 AM during MST Nov–Mar).
//
// Auth: Bearer ${CRON_SECRET}.
// ?dryRun=true returns the digest payload without sending email.

import { NextRequest, NextResponse } from "next/server";
import { runTaskDigest } from "@/lib/task-digest/send";
import { sendCronHealthAlert } from "@/lib/audit/alerts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  try {
    const result = await runTaskDigest({ dryRun });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    try {
      await sendCronHealthAlert("task-digest", message);
    } catch {
      // best-effort
    }
    return NextResponse.json({ sent: false, reason: message }, { status: 500 });
  }
}
