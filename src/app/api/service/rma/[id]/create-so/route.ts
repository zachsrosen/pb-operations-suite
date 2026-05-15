import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { ZohoSalesOrderPayload } from "@/lib/zoho-inventory";
import {
  resolveZohoWarehouse,
  buildZohoLineItems,
  type RmaLineItem,
} from "@/lib/zoho-so-helpers";
import { resolveCustomer } from "@/lib/bom-customer-resolve";
import { hubspotClient } from "@/lib/hubspot";

async function resolveCustomerFromTicket(
  ticketId: string
): Promise<{ customerId: string | null; dealName: string; primaryContactId: string | null }> {
  let dealName = "";
  let primaryContactId: string | null = null;
  let dealAddress: string | null = null;

  try {
    const ticket = await hubspotClient.crm.tickets.basicApi.getById(
      ticketId,
      [],
      undefined,
      ["deals", "contacts"]
    );

    const contactIds = (ticket.associations?.contacts?.results || []).map(
      (a: { id: string }) => a.id
    );
    if (contactIds.length > 0) {
      primaryContactId = contactIds[0];
    }

    const dealIds = (ticket.associations?.deals?.results || []).map(
      (a: { id: string }) => a.id
    );
    if (dealIds.length > 0) {
      const dealBatch = await hubspotClient.crm.deals.batchApi.read({
        inputs: dealIds.map((id: string) => ({ id })),
        properties: ["dealname", "property_address"],
        propertiesWithHistory: [],
      });
      const deal = dealBatch.results?.[0];
      if (deal) {
        dealName = deal.properties.dealname || "";
        dealAddress = deal.properties.property_address || null;
      }
    }
  } catch (err) {
    console.warn("[rma-create-so] Failed to resolve ticket associations:", err);
  }

  const result = await resolveCustomer({
    dealName,
    primaryContactId,
    dealAddress,
  });

  return {
    customerId: result.customerId,
    dealName,
    primaryContactId,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.RMA_ENABLED !== "true") {
    return NextResponse.json({ error: "RMA disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!zohoInventory.isConfigured()) {
    return NextResponse.json({ error: "Zoho Inventory not configured" }, { status: 503 });
  }

  const { id } = await params;
  const rmaOrder = await prisma.rmaOrder.findUnique({ where: { id } });
  if (!rmaOrder) {
    return NextResponse.json({ error: "RMA order not found" }, { status: 404 });
  }
  if (rmaOrder.status !== "DRAFT") {
    return NextResponse.json(
      { error: `RMA order is in ${rmaOrder.status} status, expected DRAFT` },
      { status: 400 }
    );
  }

  // Idempotency guard
  if (rmaOrder.zohoSoId) {
    return NextResponse.json({
      salesorder_id: rmaOrder.zohoSoId,
      salesorder_number: rmaOrder.zohoSoNumber,
      alreadyExisted: true,
    });
  }

  // Parse optional customerId override from body
  let customerIdOverride: string | undefined;
  try {
    const body = await request.json();
    customerIdOverride = body?.customerId;
  } catch {
    // No body or invalid JSON — auto-resolve
  }

  // Resolve Zoho customer
  let customerId = customerIdOverride;
  if (!customerId) {
    const resolved = await resolveCustomerFromTicket(rmaOrder.ticketId);
    customerId = resolved.customerId ?? undefined;
  }
  if (!customerId) {
    return NextResponse.json(
      {
        error: "Could not auto-resolve Zoho customer from ticket associations. Provide customerId in the request body.",
        needsCustomerId: true,
      },
      { status: 422 }
    );
  }

  // Build SO payload
  const outboundItems = rmaOrder.outboundItems as unknown as RmaLineItem[];
  const inboundItems = rmaOrder.inboundItems as unknown as RmaLineItem[] | null;
  const warehouseId = resolveZohoWarehouse(rmaOrder.pbLocation);
  const lineItems = buildZohoLineItems(outboundItems, warehouseId);

  const soNumber = `SO-RMA-${rmaOrder.id}`;
  const referenceNumber = `Ticket ${rmaOrder.ticketId} | ${rmaOrder.ticketSubject}`.slice(0, 50);

  const inboundSummary = inboundItems
    ?.map((i) => `${i.brand} ${i.model} x${i.quantity}`)
    .join(", ") ?? "N/A";
  const outboundSummary = outboundItems
    .map((i) => `${i.brand} ${i.model} x${i.quantity}`)
    .join(", ");

  const buildPayload = (includeCustomFields: boolean): ZohoSalesOrderPayload => ({
    customer_id: customerId!,
    salesorder_number: soNumber,
    reference_number: referenceNumber,
    notes: `RMA — Replacing: ${inboundSummary}. Sending: ${outboundSummary}.`,
    status: "draft",
    line_items: lineItems,
    ...(includeCustomFields
      ? {
          custom_fields: [
            { label: "RMA", value: "true" },
            { label: "HubSpot Ticket Record ID", value: rmaOrder.ticketId },
          ],
        }
      : {}),
  });

  let soResult: { salesorder_id: string; salesorder_number: string } | undefined;
  try {
    soResult = await zohoInventory.createSalesOrder(buildPayload(true));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoho API error";

    // Custom field fallback
    if (/custom field with the label.*does[\s']?n[o]?[\s']?t exist/i.test(message)) {
      console.warn("[rma-create-so] Zoho missing custom field — retrying without custom fields");
      try {
        soResult = await zohoInventory.createSalesOrder(buildPayload(false));
      } catch (retryErr) {
        return NextResponse.json(
          { error: retryErr instanceof Error ? retryErr.message : "Zoho API error" },
          { status: 500 }
        );
      }
    } else if (message.includes("already exists")) {
      // Crash recovery: SO already exists in Zoho
      try {
        const existing = await zohoInventory.getSalesOrder(soNumber);
        if (existing?.salesorder_id) {
          await prisma.rmaOrder.update({
            where: { id: rmaOrder.id },
            data: {
              zohoSoId: existing.salesorder_id,
              zohoSoNumber: existing.salesorder_number,
              status: "SO_CREATED",
            },
          });
          return NextResponse.json({
            salesorder_id: existing.salesorder_id,
            salesorder_number: existing.salesorder_number,
            alreadyExisted: true,
          });
        }
      } catch (recoveryErr) {
        console.error("[rma-create-so] Recovery lookup failed:", recoveryErr);
      }
      return NextResponse.json({ error: message }, { status: 500 });
    } else {
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!soResult) {
    return NextResponse.json({ error: "Zoho SO creation failed" }, { status: 500 });
  }

  // Update RMA order
  await prisma.rmaOrder.update({
    where: { id: rmaOrder.id },
    data: {
      zohoSoId: soResult.salesorder_id,
      zohoSoNumber: soResult.salesorder_number,
      status: "SO_CREATED",
    },
  });

  await logActivity({
    type: "RMA_SO_CREATED",
    description: `Created Zoho SO ${soResult.salesorder_number} for RMA on ticket ${rmaOrder.ticketId}`,
    userEmail: session.user.email,
    userName: user.name || session.user.email,
    entityType: "rma_order",
    entityId: rmaOrder.id,
    metadata: {
      ticketId: rmaOrder.ticketId,
      rmaOrderId: rmaOrder.id,
      zohoSoId: soResult.salesorder_id,
      zohoSoNumber: soResult.salesorder_number,
      itemCount: outboundItems.length,
    },
  });

  return NextResponse.json({
    salesorder_id: soResult.salesorder_id,
    salesorder_number: soResult.salesorder_number,
    alreadyExisted: false,
  });
}
