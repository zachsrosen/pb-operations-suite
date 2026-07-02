import { NextResponse } from "next/server";

import { syncZuperFieldActivity } from "@/lib/zuper-field-activity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refreshes a bounded batch of Zuper job field activity (status changes by
 * employee) into ExternalActivity. Bearer-authed like the other crons; scheduled
 * a few times a day so successive runs walk the active window.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncZuperFieldActivity();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
