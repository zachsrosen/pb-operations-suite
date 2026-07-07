import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { computeBottleneckSnapshot } from "@/lib/bottlenecks";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const snapshot = await computeBottleneckSnapshot();
    return NextResponse.json({ ...snapshot, lastUpdated: snapshot.computedAt });
  } catch (error) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
