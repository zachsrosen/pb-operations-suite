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

      if (matches.length > 0 || !hasMore) break;
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
