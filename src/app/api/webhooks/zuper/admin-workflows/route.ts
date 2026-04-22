/**
 * POST /api/webhooks/zuper/admin-workflows
 *
 * Zuper → PB Ops webhook for admin-workflow fan-out. Receives job update
 * events and fires matching ZUPER_PROPERTY_CHANGE admin workflows.
 *
 * Auth: Bearer token == process.env.ZUPER_WEBHOOK_SECRET.
 * Zuper doesn't provide a signed-webhook option in their dashboard, so
 * we use a shared secret configured in the Zuper webhook setup.
 *
 * Expected payload (normalized at route level — Zuper's actual shape varies):
 *   {
 *     event_type: string,         // e.g. "job.updated"
 *     job_uid: string,
 *     changed_fields: [
 *       { field_name: string, old_value: unknown, new_value: unknown }
 *     ]
 *   }
 *
 * This is listed in PUBLIC_API_ROUTES — signature validation happens inside.
 */

import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";

import { fanoutAdminWorkflows } from "@/lib/admin-workflows/fanout";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ZuperWebhookPayload {
  event_type?: string;
  job_uid?: string;
  changed_fields?: Array<{
    field_name: string;
    old_value?: unknown;
    new_value?: unknown;
  }>;
  // Allow unknown shape — defensive parsing below
  [key: string]: unknown;
}

export async function POST(request: NextRequest) {
  // ── Auth ──
  const secret = process.env.ZUPER_WEBHOOK_SECRET;
  if (!secret) {
    // Kill switch — if secret isn't configured, reject everything.
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const bearer = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse ──
  let payload: ZuperWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = typeof payload.event_type === "string" ? payload.event_type : "";
  const jobUid = typeof payload.job_uid === "string" ? payload.job_uid : "";
  if (!eventType || !jobUid) {
    return NextResponse.json({ error: "Missing event_type or job_uid" }, { status: 400 });
  }

  // ── Fan out one admin-workflow event per changed field ──
  // Zuper can send multiple changed fields in one webhook; each one is a
  // separate "property change" from the workflow's perspective.
  const changedFields = Array.isArray(payload.changed_fields) ? payload.changed_fields : [];

  waitUntil(
    (async () => {
      if (changedFields.length === 0) {
        // No field-level detail — fan out once with empty property info.
        await fanoutAdminWorkflows("ZUPER_PROPERTY_CHANGE", {
          eventType,
          objectId: jobUid,
          propertyName: "",
          propertyValue: "",
        }).catch((err) =>
          console.error("[zuper-webhook] Fan-out error (no-fields case):", err),
        );
        return;
      }

      for (const field of changedFields) {
        if (!field || typeof field.field_name !== "string") continue;
        try {
          await fanoutAdminWorkflows("ZUPER_PROPERTY_CHANGE", {
            eventType,
            objectId: jobUid,
            propertyName: field.field_name,
            propertyValue: field.new_value == null ? "" : String(field.new_value),
          });
        } catch (err) {
          console.error(
            "[zuper-webhook] Fan-out error for job %s field %s:",
            jobUid,
            field.field_name,
            err,
          );
        }
      }
    })(),
  );

  return NextResponse.json({ received: true, jobUid, changedFields: changedFields.length });
}
