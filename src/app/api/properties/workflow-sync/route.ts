/**
 * POST /api/properties/workflow-sync
 *
 * Simplified entry point for HubSpot workflow webhook actions. Each of the
 * three property-sync workflows (Contact address change, Deal created,
 * Ticket created) POSTs here with the enrolled record's ID.
 *
 * Auth: Public route (no middleware auth) — gated by PROPERTY_SYNC_ENABLED
 * feature flag + strict Zod payload validation. Follows the same pattern as
 * all other HubSpot webhook endpoints in PUBLIC_API_ROUTES.
 *
 * This replaces the old HubSpot subscription webhook at
 * /api/webhooks/hubspot/property for new workflow-driven sync. HubSpot
 * workflows handle enrollment, retry, rate limiting, and backfill
 * ("enroll existing") natively — so this endpoint has no idempotency keys,
 * no signature validation, and no background processing.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  onContactAddressChange,
  onDealOrTicketCreated,
} from "@/lib/property-sync";

export const maxDuration = 120;

const WorkflowSyncSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("contact"),
    contactId: z.coerce.string().min(1),
  }),
  z.object({
    type: z.literal("deal"),
    dealId: z.coerce.string().min(1),
  }),
  z.object({
    type: z.literal("ticket"),
    ticketId: z.coerce.string().min(1),
  }),
]);

export async function POST(req: NextRequest) {
  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  const body = await req.json().catch(() => null);
  const parsed = WorkflowSyncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;

  try {
    let outcome;
    switch (data.type) {
      case "contact":
        outcome = await onContactAddressChange(data.contactId);
        break;
      case "deal":
        outcome = await onDealOrTicketCreated("deal", data.dealId);
        break;
      case "ticket":
        outcome = await onDealOrTicketCreated("ticket", data.ticketId);
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
