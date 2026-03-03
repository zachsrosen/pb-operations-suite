/**
 * Shared multi-strategy customer resolution for BOM pipeline and BOM tool UI.
 *
 * Strategies (tried in order, stops on first match):
 * 1. HubSpot contact ID → Zoho customer mapping
 * 2. Deal name parsing → Zoho name search (full, no-comma, last name)
 * 3. HubSpot contact email/phone/name → Zoho lookup
 * 4. Address disambiguation (last name + address word)
 */

import {
  ensureCustomerCacheLoaded,
  findByHubSpotContactId,
  searchCustomersByName,
  findByEmail,
  findByPhone,
} from "@/lib/zoho-customer-cache";
import { fetchContactDetails } from "@/lib/bom-pipeline";

export interface ResolveCustomerResult {
  customerId: string | null;
  customerName: string | null;
  matchMethod: string;
  searchAttempts: string[];
}

export async function resolveCustomer(params: {
  dealName: string;
  primaryContactId: string | null;
  dealAddress?: string | null;
}): Promise<ResolveCustomerResult> {
  const { dealName, primaryContactId, dealAddress } = params;

  let customerId: string | null = null;
  let customerName: string | null = null;
  let matchMethod: string = "none";
  const searchAttempts: string[] = [];

  await ensureCustomerCacheLoaded();

  // Helper: try a name search and auto-select if exactly 1 match or exact-name match
  const tryNameSearch = (query: string, fullName: string | null, label: string): boolean => {
    if (customerId || query.length < 2) return false;
    const matches = searchCustomersByName(query);

    if (matches.length === 1) {
      customerId = matches[0].contact_id;
      customerName = matches[0].contact_name;
      matchMethod = `${label}_single`;
      return true;
    }
    if (matches.length > 1 && fullName) {
      const exact = matches.find((c) => c.contact_name.toLowerCase() === fullName.toLowerCase());
      if (exact) {
        customerId = exact.contact_id;
        customerName = exact.contact_name;
        matchMethod = `${label}_exact`;
        return true;
      }
    }
    searchAttempts.push(`${label} "${query}" → ${matches.length} match(es), no unique`);
    return false;
  };

  // --- Strategy 1: HubSpot contact ID → Zoho customer mapping ---
  if (primaryContactId) {
    const match = findByHubSpotContactId(primaryContactId);
    if (match) {
      customerId = match.contact_id;
      customerName = match.contact_name;
      matchMethod = "hubspot_contact_id";
    } else {
      searchAttempts.push(`HubSpot ID ${primaryContactId} → no match`);
    }
  }

  // --- Strategy 2: Deal name (after pipe) → Zoho name search ---
  if (!customerId && dealName) {
    const segments = dealName.split("|").map((s) => s.trim());
    const afterPipe = segments.length >= 2 ? segments[1] : null;
    if (afterPipe) {
      tryNameSearch(afterPipe, afterPipe, "deal_name_full");

      if (!customerId && afterPipe.includes(",")) {
        const noComma = afterPipe.replace(/,/g, "").trim();
        tryNameSearch(noComma, afterPipe, "deal_name_nocomma");
      }

      if (!customerId) {
        const lastName = afterPipe.split(/[,\s]+/)[0];
        if (lastName && lastName !== afterPipe) {
          tryNameSearch(lastName, afterPipe, "deal_name_lastname");
        }
      }
    }
  }

  // --- Strategy 3: HubSpot contact email/phone/name → Zoho lookup ---
  if (!customerId && primaryContactId) {
    const contactInfo = await fetchContactDetails(primaryContactId);
    if (contactInfo) {
      if (!customerId && contactInfo.email) {
        const emailMatch = findByEmail(contactInfo.email);
        if (emailMatch) {
          customerId = emailMatch.contact_id;
          customerName = emailMatch.contact_name;
          matchMethod = "email";
        } else {
          searchAttempts.push(`email "${contactInfo.email}" → no match`);
        }
      }

      if (!customerId && contactInfo.phone) {
        const phoneMatch = findByPhone(contactInfo.phone);
        if (phoneMatch) {
          customerId = phoneMatch.contact_id;
          customerName = phoneMatch.contact_name;
          matchMethod = "phone";
        } else {
          searchAttempts.push(`phone "${contactInfo.phone}" → no match`);
        }
      }

      if (!customerId && contactInfo.lastName) {
        tryNameSearch(contactInfo.lastName, contactInfo.fullName, "contact_lastname");
      }
      if (!customerId && contactInfo.fullName) {
        tryNameSearch(contactInfo.fullName, contactInfo.fullName, "contact_fullname");
      }
      if (!customerId && contactInfo.company) {
        tryNameSearch(contactInfo.company, contactInfo.company, "contact_company");
      }
    }
  }

  // --- Strategy 4: Deal address → disambiguation ---
  if (!customerId && dealAddress) {
    const afterPipe = dealName.includes("|") ? dealName.split("|")[1]?.trim() : null;
    const lastName = afterPipe?.split(/[,\s]+/)[0];
    if (lastName && lastName.length >= 2) {
      const matches = searchCustomersByName(lastName);
      if (matches.length > 1) {
        const addressWord = dealAddress.split(/\s+/)[0];
        if (addressWord && addressWord.length >= 3) {
          const addressMatch = matches.find((c) =>
            c.contact_name.toLowerCase().includes(addressWord.toLowerCase())
          );
          if (addressMatch) {
            customerId = addressMatch.contact_id;
            customerName = addressMatch.contact_name;
            matchMethod = "address_disambiguate";
          } else {
            searchAttempts.push(`address disambiguate "${lastName}" + "${addressWord}" → no match among ${matches.length}`);
          }
        }
      }
    }
  }

  return { customerId, customerName, matchMethod, searchAttempts };
}
