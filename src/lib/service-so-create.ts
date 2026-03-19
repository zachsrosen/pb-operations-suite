/**
 * Service SO Creation Module
 *
 * Handles product resolution, Zoho customer lookup, and SO creation
 * for the service pipeline. Idempotent via ServiceSoRequest.requestToken.
 *
 * Spec: docs/superpowers/specs/2026-03-18-service-catalog-so-design.md
 */

import * as Sentry from "@sentry/nextjs";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { ZohoSalesOrderLineItem } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { resolveCustomer } from "@/lib/bom-customer-resolve";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// No service-specific constants — customer resolution uses shared bom-customer-resolve module

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceSoLineItem {
  productId: string;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  zohoItemId: string | null;
}

export interface CreateServiceSoInput {
  dealId: string;
  requestToken: string;
  items: Array<{ productId: string; quantity: number }>;
  createdBy: string;
}

export interface CreateServiceSoResult {
  zohoSoId: string;
  zohoSoNumber: string;
  zohoCustomerId: string;
  lineItems: ServiceSoLineItem[];
  totalAmount: number;
  alreadyExisted?: boolean;
}

// ---------------------------------------------------------------------------
// Zoho Customer Resolution
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HubSpot Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve deal properties + primary contact from HubSpot.
 * Uses the same customer resolution strategy as the BOM pipeline
 * (contact-based, not company-based).
 */
async function resolveDealContext(
  dealId: string
): Promise<{
  dealName: string;
  dealAddress: string;
  primaryContactId: string | null;
}> {
  // Fetch deal properties server-side (no client trust)
  const dealResp = await hubspotClient.crm.deals.batchApi.read({
    inputs: [{ id: dealId }],
    properties: ["dealname", "address_line_1", "city", "state", "postal_code"],
    propertiesWithHistory: [],
  });
  const dealProps = dealResp.results?.[0]?.properties || {};
  const dealName = dealProps.dealname || `Deal ${dealId}`;
  const dealAddress = [dealProps.address_line_1, dealProps.city, dealProps.state, dealProps.postal_code]
    .filter(Boolean)
    .join(", ");

  // Deal → primary contact association
  let primaryContactId: string | null = null;
  try {
    const contactAssocResp = await hubspotClient.crm.associations.batchApi.read(
      "deals",
      "contacts",
      { inputs: [{ id: dealId }] }
    );
    const contactIds = (contactAssocResp.results?.[0]?.to || []).map(
      (t: { id: string }) => t.id
    );
    if (contactIds.length > 0) {
      primaryContactId = contactIds[0];
    }
  } catch (err) {
    Sentry.captureException(err);
    console.warn("[ServiceSO] Failed to resolve primary contact:", err);
  }

  return { dealName, dealAddress, primaryContactId };
}

// ---------------------------------------------------------------------------
// Product Resolution
// ---------------------------------------------------------------------------

function resolveProducts(
  dbProducts: Array<{
    id: string;
    name: string | null;
    sku: string | null;
    description: string | null;
    sellPrice: number | null;
    category: string;
    isActive: boolean;
    zohoItemId: string | null;
  }>,
  requestedItems: Array<{ productId: string; quantity: number }>
): ServiceSoLineItem[] {
  const productMap = new Map(dbProducts.map(p => [p.id, p]));
  const invalid: string[] = [];

  const lineItems: ServiceSoLineItem[] = [];
  for (const item of requestedItems) {
    const product = productMap.get(item.productId);
    if (!product || !product.isActive) {
      invalid.push(item.productId);
      continue;
    }
    lineItems.push({
      productId: product.id,
      name: product.name || "Unnamed Product",
      sku: product.sku,
      description: product.description,
      quantity: item.quantity,
      unitPrice: product.sellPrice || 0,
      zohoItemId: product.zohoItemId,
    });
  }

  if (invalid.length > 0) {
    throw new Error(
      `The following product IDs are not valid active products: ${invalid.join(", ")}`
    );
  }

  return lineItems;
}

// ---------------------------------------------------------------------------
// Main: Create Service SO
// ---------------------------------------------------------------------------

export async function createServiceSo(
  input: CreateServiceSoInput
): Promise<CreateServiceSoResult> {
  const { dealId, requestToken, items, createdBy } = input;

  // 1. Idempotency: check for existing record
  const existing = await prisma!.serviceSoRequest.findUnique({
    where: { requestToken },
  });

  if (existing) {
    if (existing.zohoSoId) {
      return {
        zohoSoId: existing.zohoSoId,
        zohoSoNumber: existing.zohoSoNumber || "",
        zohoCustomerId: existing.zohoCustomerId || "",
        lineItems: existing.lineItems as unknown as ServiceSoLineItem[],
        totalAmount: existing.totalAmount,
        alreadyExisted: true,
      };
    }
    if (existing.status === "FAILED") {
      await prisma!.serviceSoRequest.delete({ where: { requestToken } });
    } else {
      throw new Error(
        `Service SO request already in progress (status: ${existing.status})`
      );
    }
  }

  // 2. Validate products BEFORE creating DRAFT record (pure validation, no DB write)
  const productIds = items.map(i => i.productId);
  const dbProducts = await prisma!.internalProduct.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true, name: true, sku: true, description: true, sellPrice: true,
      category: true, isActive: true, zohoItemId: true,
    },
  });

  const lineItems = resolveProducts(dbProducts, items);
  const totalAmount = lineItems.reduce(
    (sum, li) => sum + li.unitPrice * li.quantity, 0
  );

  // Create DRAFT record (after validation passes)
  let requestId: string;
  try {
    const record = await prisma!.serviceSoRequest.create({
      data: {
        dealId,
        requestToken,
        lineItems: [],
        totalAmount: 0,
        status: "DRAFT",
        createdBy,
      },
    });
    requestId = record.id;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      // Race condition: another request created the record between our findUnique and create.
      // Load and return it — this is the idempotent behavior the spec requires.
      const raceRecord = await prisma!.serviceSoRequest.findUnique({
        where: { requestToken },
      });
      if (raceRecord?.zohoSoId) {
        return {
          zohoSoId: raceRecord.zohoSoId,
          zohoSoNumber: raceRecord.zohoSoNumber || "",
          zohoCustomerId: raceRecord.zohoCustomerId || "",
          lineItems: raceRecord.lineItems as unknown as ServiceSoLineItem[],
          totalAmount: raceRecord.totalAmount,
          alreadyExisted: true,
        };
      }
      // Still DRAFT (concurrent request still in progress) — let the client retry
      throw new Error("Service SO request is being processed, please retry");
    }
    throw err;
  }

  try {

    // 3. Resolve deal context + Zoho customer (contact-based, same as BOM pipeline)
    const { dealName, dealAddress, primaryContactId } = await resolveDealContext(dealId);
    const customerResult = await resolveCustomer({
      dealName,
      primaryContactId,
      dealAddress: dealAddress || null,
    });

    if (!customerResult.customerId) {
      throw new Error(
        `Could not resolve Zoho customer for deal "${dealName}". ` +
        `Tried: ${customerResult.searchAttempts.join("; ") || "no strategies matched"}`
      );
    }
    const zohoCustomerId = customerResult.customerId;

    // 4. Update DRAFT with resolved data
    await prisma!.serviceSoRequest.update({
      where: { id: requestId },
      data: {
        lineItems: JSON.parse(JSON.stringify(lineItems)),
        totalAmount,
        zohoCustomerId,
      },
    });

    // 5. Build + send Zoho SO
    const zohoLineItems: ZohoSalesOrderLineItem[] = lineItems.map(li => ({
      ...(li.zohoItemId ? { item_id: li.zohoItemId } : {}),
      name: li.name,
      quantity: li.quantity,
      ...(li.description ? { description: li.description } : {}),
    }));

    const refNumber = dealName.length > 50 ? dealName.slice(0, 50) : dealName;

    const zohoResult = await zohoInventory.createSalesOrder({
      customer_id: zohoCustomerId,
      reference_number: refNumber,
      notes: `Service SO for ${dealAddress}`,
      status: "draft",
      line_items: zohoLineItems,
      custom_fields: [{ label: "HubSpot Deal Record ID", value: dealId }],
    });

    // 6. Update record → SUBMITTED
    await prisma!.serviceSoRequest.update({
      where: { id: requestId },
      data: {
        zohoSoId: zohoResult.salesorder_id,
        zohoSoNumber: zohoResult.salesorder_number,
        status: "SUBMITTED",
      },
    });

    return {
      zohoSoId: zohoResult.salesorder_id,
      zohoSoNumber: zohoResult.salesorder_number,
      zohoCustomerId,
      lineItems,
      totalAmount,
    };
  } catch (err) {
    try {
      await prisma!.serviceSoRequest.update({
        where: { id: requestId },
        data: {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // Best-effort status update
    }
    throw err;
  }
}
