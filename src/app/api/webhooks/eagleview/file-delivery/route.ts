/**
 * POST /api/webhooks/eagleview/file-delivery
 *
 * EagleView pushes file deliverables to this endpoint when a TDP order
 * completes. We pull the artifacts via getFileLinks and drop them in Drive.
 *
 * Auth: shared-secret bearer token in `Authorization: Bearer <secret>` header.
 *       EagleView's docs describe an HMAC scheme but the actual signing
 *       behavior varies by tenant — we configure a static bearer secret with
 *       Santosh during the prod allowlist step.
 *
 * Body shape (per OpenAPI examples): includes a `reportId` field. We extract
 * that, look up the order, and call fetchAndStoreDeliverables. The poller
 * (cron) is the safety net if this endpoint is missed.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchAndStoreDeliverables } from "@/lib/eagleview-pipeline";
import { defaultPipelineDeps } from "@/lib/eagleview-pipeline-deps";

export const maxDuration = 300;

interface FileDeliveryPayload {
  reportId?: number | string;
  ReportId?: number | string;
}

export async function POST(request: NextRequest) {
  // Auth via shared secret
  const expected = process.env.EAGLEVIEW_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[eagleview-file-delivery] EAGLEVIEW_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${expected}`) {
    console.warn("[eagleview-file-delivery] auth fail");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: FileDeliveryPayload;
  try {
    payload = (await request.json()) as FileDeliveryPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const reportId = String(payload.reportId ?? payload.ReportId ?? "").trim();
  if (!reportId) {
    return NextResponse.json({ error: "reportId required" }, { status: 400 });
  }

  try {
    const result = await fetchAndStoreDeliverables(defaultPipelineDeps(), reportId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[eagleview-file-delivery] failed", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
