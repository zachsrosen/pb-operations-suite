/**
 * Aircall webhook helpers — signature verification and payload normalization.
 *
 * Webhook docs: https://developer.aircall.io/api-references/#webhooks
 * Aircall signs each payload with HMAC-SHA256 using a per-webhook token.
 * Header: `X-Aircall-Signature` (hex digest).
 */

import crypto from "node:crypto";

import type { AircallCall } from "./aircall";

/**
 * Constant-time HMAC-SHA256 verification. Returns true if the provided
 * signature matches the body computed against `secret`.
 */
export function verifyAircallSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type AircallWebhookEvent =
  | "call.created"
  | "call.ringing_on_agent"
  | "call.agent_declined"
  | "call.answered"
  | "call.transferred"
  | "call.unanswered"
  | "call.hungup"
  | "call.ended"
  | "call.voicemail_left"
  | "call.commented"
  | "call.tagged"
  | "call.untagged"
  | "user.created"
  | "user.logged_in"
  | "user.logged_out";

export interface AircallWebhookPayload {
  resource?: "call" | "user" | string;
  event: AircallWebhookEvent | string;
  // Aircall sends `data` (older format) or `data: { ... }` (newer). Normalize at parse time.
  data?: AircallCall | Record<string, unknown>;
  // Some events include a top-level event id; we synthesize one if missing.
  event_id?: string;
  timestamp?: number;
  token?: string;
}

/** Returns a stable idempotency key for a webhook payload. */
export function idempotencyKeyFor(payload: AircallWebhookPayload): string {
  if (payload.event_id) return `aircall:${payload.event_id}`;
  const data = payload.data as { id?: number | string } | undefined;
  const id = data?.id ?? "unknown";
  const ts = payload.timestamp ?? 0;
  return `aircall:${payload.event}:${id}:${ts}`;
}

/**
 * Map an Aircall API/webhook call object to the cache row shape.
 * Status mapping:
 *   - "answered" if the call was picked up by an agent (answered_at is set)
 *   - "voicemail" if voicemail url is present
 *   - "missed" otherwise
 */
export function mapCallToCacheRow(call: AircallCall) {
  const startedAt = new Date(call.started_at * 1000);
  const answeredAt = call.answered_at ? new Date(call.answered_at * 1000) : null;
  const endedAt = call.ended_at ? new Date(call.ended_at * 1000) : null;

  const isVoicemail = Boolean(call.voicemail);
  const isAnswered = Boolean(call.answered_at);
  const status: "answered" | "missed" | "voicemail" = isAnswered ? "answered" : isVoicemail ? "voicemail" : "missed";

  // talk_time = ended - answered when both are set.
  let talkTimeSec = 0;
  if (call.answered_at && call.ended_at) {
    talkTimeSec = Math.max(0, call.ended_at - call.answered_at);
  }
  // duration = ended - started (Aircall provides `duration` directly when available)
  const durationSec = typeof call.duration === "number" && call.duration > 0
    ? call.duration
    : call.ended_at && call.started_at
      ? Math.max(0, call.ended_at - call.started_at)
      : 0;

  const timeToAnswerSec = call.answered_at ? Math.max(0, call.answered_at - call.started_at) : null;

  return {
    id: String(call.id),
    provider: "aircall" as const,
    direction: call.direction,
    status,
    startedAt,
    answeredAt,
    endedAt,
    durationSec,
    talkTimeSec,
    timeToAnswerSec,
    userAircallId: call.user?.id != null ? String(call.user.id) : null,
    userName: call.user?.name ?? null,
    userEmail: call.user?.email ?? null,
    customerNumber: call.raw_digits ?? null,
    rawPayload: call as unknown as object,
  };
}
