/**
 * POST /api/webhooks/aircall
 *
 * Aircall webhook receiver. Verifies HMAC-SHA256 signature, deduplicates
 * via IdempotencyKey, upserts AircallCallCache rows on `call.ended`.
 *
 * Other events return 200 with `{ ignored: true }` so Aircall does not retry.
 */

import { NextRequest, NextResponse } from "next/server";

import { appCache } from "@/lib/cache";
import { prisma } from "@/lib/db";
import {
  idempotencyKeyFor,
  mapCallToCacheRow,
  verifyAircallSignature,
  type AircallWebhookPayload,
} from "@/lib/aircall-webhook";
import type { AircallCall } from "@/lib/aircall";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IDEMPOTENCY_SCOPE = "aircall-webhook";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secret = process.env.AIRCALL_WEBHOOK_TOKEN ?? "";
  const signature = req.headers.get("x-aircall-signature");

  if (!verifyAircallSignature(rawBody, signature, secret)) {
    // Best-effort audit log; don't let logging failure leak info.
    void prisma.activityLog
      .create({
        data: {
          type: "WEBHOOK_AIRCALL_SIGNATURE_FAILED",
          description: "Invalid Aircall webhook signature",
          metadata: { hasSignature: Boolean(signature), bodyLength: rawBody.length },
        },
      })
      .catch(() => {});
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: AircallWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as AircallWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.event !== "call.ended") {
    return NextResponse.json({ ignored: true, event: payload.event });
  }

  const data = payload.data as AircallCall | undefined;
  if (!data || typeof data.id === "undefined") {
    return NextResponse.json({ ignored: true, reason: "missing call data" });
  }

  // Idempotency: claim the key atomically via unique-index conflict. If two
  // identical webhooks arrive simultaneously, only one create() succeeds; the
  // other gets P2002 and short-circuits.
  const key = idempotencyKeyFor(payload);
  try {
    await prisma.idempotencyKey.create({
      data: {
        key,
        scope: IDEMPOTENCY_SCOPE,
        status: "completed",
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation → already processed.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ ok: true, dedup: true });
    }
    throw err;
  }

  const row = mapCallToCacheRow(data);
  await prisma.aircallCallCache.upsert({
    where: { id: row.id },
    create: row,
    update: row,
  });

  void prisma.activityLog
    .create({
      data: {
        type: "WEBHOOK_AIRCALL_CALL_ENDED",
        description: `Aircall call ${row.id} (${row.direction}/${row.status})`,
        metadata: { callId: row.id, direction: row.direction, status: row.status, userAircallId: row.userAircallId ?? null },
      },
    })
    .catch(() => {});

  // Trigger SSE invalidation so live dashboards refetch.
  appCache.invalidateByPrefix("aircall:");

  return NextResponse.json({ ok: true, callId: row.id });
}
