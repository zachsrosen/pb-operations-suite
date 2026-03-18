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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOMER_LOOKUP_MAX_PAGES = 5;

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
  dealName: string;
  dealAddress: string;
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

/**
 * Find or create a Zoho customer by company name.
 *
 * Paginates through fetchCustomerPage (max 5 pages / 1000 customers).
 * If no match found, creates a new customer in Zoho.
 * If multiple matches, uses first match + logs warning (pragmatic for Phase 4).
 */
export async function resolveZohoCustomer(
  companyName: string,
  contactEmail?: string
): Promise<string> {
  const matches: Array<{ contact_id: string; contact_name: string }> = [];

  for (let page = 1; page <= CUSTOMER_LOOKUP_MAX_PAGES; page++) {
    try {
      const { contacts, hasMore } = await zohoInventory.fetchCustomerPage(page);

      for (const c of contacts) {
        if (c.contact_name?.toLowerCase() === companyName.toLowerCase()) {
          matches.push({ contact_id: c.contact_id, contact_name: c.contact_name });
        }
      }

      if (!hasMore) break;
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[ServiceSO] Customer page ${page} fetch failed:`, err);
      break;
    }
  }

  if (matches.length === 1) {
    return matches[0].contact_id;
  }

  if (matches.length > 1) {
    console.warn(
      `[ServiceSO] Multiple Zoho customers matched "${companyName}": ${matches.map(m => m.contact_id).join(", ")}. Using first match.`
    );
    return matches[0].contact_id;
  }

  console.warn(
    `[ServiceSO] No Zoho customer matched "${companyName}" within ${CUSTOMER_LOOKUP_MAX_PAGES} pages. Creating new customer.`
  );

  const { contact_id } = await zohoInventory.createContact({
    contact_name: companyName,
    email: contactEmail,
    contact_type: "customer",
  });

  return contact_id;
}

// ---------------------------------------------------------------------------
// HubSpot Helpers
// ---------------------------------------------------------------------------

async function resolveCompanyForDeal(
  dealId: string
): Promise<{ companyId: string; companyName: string; contactEmail?: string }> {
  const assocResp = await hubspotClient.crm.associations.batchApi.read(
    "deals",
    "companies",
    { inputs: [{ id: dealId }] }
  );
  const companyIds = (assocResp.results?.[0]?.to || []).map(
    (t: { id: string }) => t.id
  );
  if (companyIds.length === 0) {
    throw new Error("Deal must have an associated company to create a Sales Order");
  }

  const companyResp = await hubspotClient.crm.companies.batchApi.read({
    inputs: [{ id: companyIds[0] }],
    properties: ["name", "domain"],
    propertiesWithHistory: [],
  });
  const company = companyResp.results?.[0];
  const companyName = company?.properties?.name || `Company ${companyIds[0]}`;

  let contactEmail: string | undefined;
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
      const contactResp = await hubspotClient.crm.contacts.batchApi.read({
        inputs: [{ id: contactIds[0] }],
        properties: ["email"],
        propertiesWithHistory: [],
      });
      contactEmail = contactResp.results?.[0]?.properties?.email || undefined;
    }
  } catch {
    // Non-critical — email is optional for customer creation
  }

  return { companyId: companyIds[0], companyName, contactEmail };
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
    if (!product || product.category !== "SERVICE" || !product.isActive) {
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
      `The following product IDs are not valid SERVICE products: ${invalid.join(", ")}`
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
  const { dealId, dealName, dealAddress, requestToken, items, createdBy } = input;

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
      throw new Error("Service SO request already in progress (concurrent create)");
    }
    throw err;
  }

  try {

    // 3. Resolve HubSpot company → Zoho customer
    const { companyName, contactEmail } = await resolveCompanyForDeal(dealId);
    const zohoCustomerId = await resolveZohoCustomer(companyName, contactEmail);

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
