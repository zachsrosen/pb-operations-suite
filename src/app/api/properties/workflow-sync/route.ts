/**
 * POST /api/properties/workflow-sync
 *
 * Entry point for HubSpot workflow webhook actions. Accepts two payload
 * formats:
 *
 * 1. HubSpot native — the default body HubSpot sends from a workflow
 *    webhook action: `{ objectId, objectType, ... }`. The objectType is
 *    mapped from HubSpot type IDs (0-1=contact, 0-3=deal, 0-5=ticket)
 *    or string names (CONTACT, DEAL, TICKET).
 *
 * 2. Explicit — `{ type: "ticket", ticketId: "123" }` for manual/curl
 *    testing.
 *
 * When INNGEST_PROPERTY_SYNC_ENABLED=true, the work is queued via Inngest
 * with a global concurrency limit of 3, preventing HubSpot API rate
 * limiting when thousands of records re-enroll at once.
 *
 * Auth: Public route (no middleware auth) — gated by PROPERTY_SYNC_ENABLED
 * feature flag. Follows the same pattern as all other HubSpot webhook
 * endpoints in PUBLIC_API_ROUTES.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  onContactAddressChange,
  onDealOrTicketCreated,
} from "@/lib/property-sync";
import {
  inngest,
  propertySyncRequested,
  isInngestPropertySyncEnabled,
} from "@/lib/inngest-client";

export const maxDuration = 120;

// Format 1: Explicit type + ID (manual testing, curl)
const ExplicitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contact"), contactId: z.coerce.string().min(1) }),
  z.object({ type: z.literal("deal"), dealId: z.coerce.string().min(1) }),
  z.object({ type: z.literal("ticket"), ticketId: z.coerce.string().min(1) }),
]);

// Format 2: HubSpot native webhook payload
const OBJECT_TYPE_MAP: Record<string, "contact" | "deal" | "ticket"> = {
  "0-1": "contact", CONTACT: "contact", contact: "contact",
  "0-3": "deal",    DEAL: "deal",       deal: "deal",
  "0-5": "ticket",  TICKET: "ticket",   ticket: "ticket",
};

const HubSpotNativeSchema = z.object({
  objectId: z.coerce.string().min(1),
  objectType: z.string().optional(),
  objectTypeId: z.string().optional(),
}).passthrough();

type NormalizedPayload = { objectType: "contact" | "deal" | "ticket"; objectId: string };

function normalizePayload(body: unknown): NormalizedPayload | null {
  // Try explicit format first
  const explicit = ExplicitSchema.safeParse(body);
  if (explicit.success) {
    const d = explicit.data;
    switch (d.type) {
      case "contact": return { objectType: "contact", objectId: d.contactId };
      case "deal":    return { objectType: "deal",    objectId: d.dealId };
      case "ticket":  return { objectType: "ticket",  objectId: d.ticketId };
    }
  }

  // Try HubSpot native format
  const native = HubSpotNativeSchema.safeParse(body);
  if (native.success) {
    const { objectId, objectType, objectTypeId } = native.data;
    const resolved = OBJECT_TYPE_MAP[objectTypeId ?? ""] ?? OBJECT_TYPE_MAP[objectType ?? ""];
    if (resolved) return { objectType: resolved, objectId };
  }

  return null;
}

export async function POST(req: NextRequest) {
  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  const body = await req.json().catch(() => null);
  const payload = normalizePayload(body);
  if (!payload) {
    console.log("[workflow-sync] unrecognized payload:", JSON.stringify(body));
    return NextResponse.json(
      { error: "Invalid payload — expected {type,contactId/dealId/ticketId} or HubSpot native {objectId,objectType/objectTypeId}" },
      { status: 400 },
    );
  }

  if (isInngestPropertySyncEnabled()) {
    try {
      await inngest.send(
        propertySyncRequested.create(payload),
      );
      return NextResponse.json({ ok: true, queued: true });
    } catch (err) {
      console.error("[workflow-sync] Inngest send failed, falling back to direct execution:", err);
    }
  }

  try {
    let outcome;
    switch (payload.objectType) {
      case "contact":
        outcome = await onContactAddressChange(payload.objectId);
        break;
      case "deal":
        outcome = await onDealOrTicketCreated("deal", payload.objectId);
        break;
      case "ticket":
        outcome = await onDealOrTicketCreated("ticket", payload.objectId);
        break;
    }

    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[workflow-sync] Error:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 },
    );
  }
}
