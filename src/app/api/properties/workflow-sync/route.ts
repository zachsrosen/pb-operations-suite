/**
 * POST /api/properties/workflow-sync
 *
 * Entry point for HubSpot workflow webhook actions. Each of the three
 * property-sync workflows (Contact address change, Deal created, Ticket
 * created) POSTs here with the enrolled record's ID.
 *
 * When INNGEST_PROPERTY_SYNC_ENABLED=true, the work is queued via Inngest
 * with a global concurrency limit of 3. This prevents HubSpot API rate
 * limiting when thousands of records are re-enrolled at once — the direct
 * path silently fails ~90% of records under bulk enrollment.
 *
 * When the flag is off, falls back to direct in-process execution (fine for
 * single-record webhooks but breaks under bulk re-enrollment).
 *
 * Auth: Public route (no middleware auth) — gated by PROPERTY_SYNC_ENABLED
 * feature flag + strict Zod payload validation. Follows the same pattern as
 * all other HubSpot webhook endpoints in PUBLIC_API_ROUTES.
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

function extractObjectId(data: z.infer<typeof WorkflowSyncSchema>): string {
  switch (data.type) {
    case "contact": return data.contactId;
    case "deal":    return data.dealId;
    case "ticket":  return data.ticketId;
  }
}

export async function POST(req: NextRequest) {
  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  const body = await req.json().catch(() => null);
  console.log("[workflow-sync] raw payload:", JSON.stringify(body));
  const parsed = WorkflowSyncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;

  if (isInngestPropertySyncEnabled()) {
    try {
      await inngest.send(
        propertySyncRequested.create({
          objectType: data.type,
          objectId: extractObjectId(data),
        }),
      );
      return NextResponse.json({ ok: true, queued: true });
    } catch (err) {
      console.error("[workflow-sync] Inngest send failed, falling back to direct execution:", err);
    }
  }

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
