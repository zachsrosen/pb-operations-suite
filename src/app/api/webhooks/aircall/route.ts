/**
 * POST /api/webhooks/aircall
 *
 * Aircall webhook receiver. Verifies HMAC-SHA256 signature, deduplicates
 * via IdempotencyKey, and persists per event:
 *   - call.ended            → upsert AircallCallCache (final call state)
 *   - call.ringing_on_agent → upsert AircallCallRing (one row per rung agent)
 *   - call.answered         → stamp answeredAt on the matching AircallCallRing
 *
 * All other events return 200 with `{ ignored: true }` so Aircall does not
 * retry. The combination of ringing_on_agent + answered lets us compute true
 * per-user answer rate even when a missed inbound goes to a ring group.
 */

import { NextRequest, NextResponse } from "next/server";

import { appCache } from "@/lib/cache";
import { prisma } from "@/lib/db";
import {
  idempotencyKeyFor,
  mapAnsweredEvent,
  mapCallToCacheRow,
  mapRingEventToRow,
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

  const ALLOWED = new Set(["call.ended", "call.ringing_on_agent", "call.answered"]);
  if (!ALLOWED.has(payload.event)) {
    return NextResponse.json({ ignored: true, event: payload.event });
  }

  // Idempotency claim — same scheme for every event. Aircall retries on non-2xx
  // and we want each (event_id, event) pair processed once.
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
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ ok: true, dedup: true });
    }
    throw err;
  }

  if (payload.event === "call.ended") {
    const data = payload.data as AircallCall | undefined;
    if (!data || typeof data.id === "undefined") {
      return NextResponse.json({ ignored: true, reason: "missing call data" });
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
    appCache.invalidateByPrefix("aircall:");
    return NextResponse.json({ ok: true, event: "call.ended", callId: row.id });
  }

  if (payload.event === "call.ringing_on_agent") {
    const ring = mapRingEventToRow(payload);
    if (!ring) return NextResponse.json({ ignored: true, reason: "ring event missing user/timestamp" });
    await prisma.aircallCallRing.upsert({
      where: { callId_userAircallId: { callId: ring.callId, userAircallId: ring.userAircallId } },
      create: ring,
      update: {
        // Don't overwrite ringedAt if a later event arrives out-of-order; preserve
        // the earliest. The unique-index ensures one row per (call, user).
        userName: ring.userName,
        userEmail: ring.userEmail,
        direction: ring.direction,
        rawPayload: ring.rawPayload,
      },
    });
    appCache.invalidateByPrefix("aircall:");
    return NextResponse.json({ ok: true, event: "call.ringing_on_agent", callId: ring.callId, userAircallId: ring.userAircallId });
  }

  // call.answered — stamp answeredAt on the matching ring row (creating one
  // if the ringing event was missed/out-of-order).
  const ans = mapAnsweredEvent(payload);
  if (!ans) return NextResponse.json({ ignored: true, reason: "answered event missing user" });
  const data = payload.data as AircallCall | undefined;
  await prisma.aircallCallRing.upsert({
    where: { callId_userAircallId: { callId: ans.callId, userAircallId: ans.userAircallId } },
    create: {
      callId: ans.callId,
      userAircallId: ans.userAircallId,
      userName: data?.user?.name ?? null,
      userEmail: data?.user?.email ?? null,
      direction: data?.direction ?? null,
      ringedAt: ans.answeredAt, // best-effort if no prior ring event
      answeredAt: ans.answeredAt,
      rawPayload: payload as unknown as object,
    },
    update: { answeredAt: ans.answeredAt },
  });
  appCache.invalidateByPrefix("aircall:");
  return NextResponse.json({ ok: true, event: "call.answered", callId: ans.callId, userAircallId: ans.userAircallId });
}
