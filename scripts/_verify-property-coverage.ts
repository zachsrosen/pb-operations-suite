// scripts/_verify-property-coverage.ts
//
// Verifies that every deal and ticket has at least one Property record
// associated with it. Reports gaps.
//
// Usage:
//   tsx scripts/_verify-property-coverage.ts

import "dotenv/config";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/objects/models/Filter";
import { withRetry } from "../src/lib/hubspot-custom-objects";

const hs = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

const PROP_TYPE = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE!;

// Pipeline IDs from CLAUDE.md
const PIPELINES = {
  SALES: "default",
  PROJECT: "6900017",
  DNR: "21997330",
  SERVICE: "23928924",
  ROOFING: "765928545",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MinimalRecord {
  id: string;
  name: string;
  pipeline: string;
  stage: string;
  contactId: string | null;
  hasProperty: boolean;
}

async function searchDeals(pipelineId: string): Promise<MinimalRecord[]> {
  const results: MinimalRecord[] = [];
  let after = "0";
  let page = 0;

  do {
    const response = await withRetry(() =>
      hs.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
            ],
          },
        ],
        properties: ["dealname", "pipeline", "dealstage"],
        limit: 100,
        after,
        sorts: [],
        query: "",
      })
    );

    results.push(
      ...response.results.map((r) => ({
        id: r.id,
        name: (r.properties as Record<string, string>).dealname ?? "",
        pipeline: pipelineId,
        stage: (r.properties as Record<string, string>).dealstage ?? "",
        contactId: null,
        hasProperty: false,
      }))
    );

    after = response.paging?.next?.after ?? "";
    page++;
    if (page % 20 === 0) console.log(`  ... ${pipelineId}: fetched ${results.length} deals`);
  } while (after);

  return results;
}

async function searchTickets(): Promise<MinimalRecord[]> {
  const results: MinimalRecord[] = [];
  let after = "0";
  let page = 0;

  do {
    const response = await withRetry(() =>
      hs.crm.tickets.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: "hs_pipeline", operator: FilterOperatorEnum.Eq, value: PIPELINES.SERVICE },
            ],
          },
        ],
        properties: ["subject", "hs_pipeline", "hs_pipeline_stage"],
        limit: 100,
        after,
        sorts: [],
        query: "",
      })
    );

    results.push(
      ...response.results.map((r) => ({
        id: r.id,
        name: (r.properties as Record<string, string>).subject ?? "",
        pipeline: PIPELINES.SERVICE,
        stage: (r.properties as Record<string, string>).hs_pipeline_stage ?? "",
        contactId: null,
        hasProperty: false,
      }))
    );

    after = response.paging?.next?.after ?? "";
    page++;
    if (page % 20 === 0) console.log(`  ... tickets: fetched ${results.length}`);
  } while (after);

  return results;
}

async function checkPropertyAssociation(
  objectType: "deals" | "tickets",
  objectId: string
): Promise<boolean> {
  try {
    const assocs = await withRetry(() =>
      hs.crm.associations.v4.basicApi.getPage(
        objectType,
        objectId,
        PROP_TYPE,
        undefined,
        undefined
      )
    );
    return assocs.results.length > 0;
  } catch {
    return false;
  }
}

async function checkContactAssociation(
  objectType: "deals" | "tickets",
  objectId: string
): Promise<string | null> {
  try {
    const assocs = await withRetry(() =>
      hs.crm.associations.v4.basicApi.getPage(
        objectType,
        objectId,
        "contacts",
        undefined,
        undefined
      )
    );
    return assocs.results[0]?.toObjectId?.toString() ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Property Coverage Verification ===\n");

  // 1. Fetch all deals from project + service pipelines
  console.log("Fetching deals...");
  const projectDeals = await searchDeals(PIPELINES.PROJECT);
  console.log(`  Project pipeline: ${projectDeals.length}`);
  const serviceDeals = await searchDeals(PIPELINES.SERVICE);
  console.log(`  Service pipeline: ${serviceDeals.length}`);
  const dnrDeals = await searchDeals(PIPELINES.DNR);
  console.log(`  D&R pipeline: ${dnrDeals.length}`);
  const roofingDeals = await searchDeals(PIPELINES.ROOFING);
  console.log(`  Roofing pipeline: ${roofingDeals.length}`);

  const allDeals = [...projectDeals, ...serviceDeals, ...dnrDeals, ...roofingDeals];
  console.log(`  Total deals: ${allDeals.length}`);

  // 2. Fetch all service tickets
  console.log("\nFetching service tickets...");
  const allTickets = await searchTickets();
  console.log(`  Total tickets: ${allTickets.length}`);

  // 3. Check Property associations
  console.log("\nChecking deal → Property associations...");
  const dealsWithoutProperty: MinimalRecord[] = [];
  const dealsWithoutContact: MinimalRecord[] = [];

  for (let i = 0; i < allDeals.length; i++) {
    const deal = allDeals[i];
    deal.hasProperty = await checkPropertyAssociation("deals", deal.id);
    if (!deal.hasProperty) {
      deal.contactId = await checkContactAssociation("deals", deal.id);
      if (!deal.contactId) {
        dealsWithoutContact.push(deal);
      } else {
        dealsWithoutProperty.push(deal);
      }
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ... checked ${i + 1}/${allDeals.length} deals (${dealsWithoutProperty.length} missing property)`);
    }
  }

  console.log("\nChecking ticket → Property associations...");
  const ticketsWithoutProperty: MinimalRecord[] = [];
  const ticketsWithoutContact: MinimalRecord[] = [];

  for (let i = 0; i < allTickets.length; i++) {
    const ticket = allTickets[i];
    ticket.hasProperty = await checkPropertyAssociation("tickets", ticket.id);
    if (!ticket.hasProperty) {
      ticket.contactId = await checkContactAssociation("tickets", ticket.id);
      if (!ticket.contactId) {
        ticketsWithoutContact.push(ticket);
      } else {
        ticketsWithoutProperty.push(ticket);
      }
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  ... checked ${i + 1}/${allTickets.length} tickets (${ticketsWithoutProperty.length} missing property)`);
    }
  }

  // 4. Report
  console.log("\n=== Results ===\n");

  const totalDeals = allDeals.length;
  const dealsWithProperty = totalDeals - dealsWithoutProperty.length - dealsWithoutContact.length;
  console.log(`Deals: ${dealsWithProperty}/${totalDeals} have a Property (${((dealsWithProperty / totalDeals) * 100).toFixed(1)}%)`);
  console.log(`  Missing Property (has contact): ${dealsWithoutProperty.length}`);
  console.log(`  Missing Property (no contact either): ${dealsWithoutContact.length}`);

  const totalTickets = allTickets.length;
  const ticketsWithProperty = totalTickets - ticketsWithoutProperty.length - ticketsWithoutContact.length;
  console.log(`\nTickets: ${ticketsWithProperty}/${totalTickets} have a Property (${((ticketsWithProperty / totalTickets) * 100).toFixed(1)}%)`);
  console.log(`  Missing Property (has contact): ${ticketsWithoutProperty.length}`);
  console.log(`  Missing Property (no contact either): ${ticketsWithoutContact.length}`);

  if (dealsWithoutProperty.length > 0) {
    console.log("\n--- Deals with contact but no Property (first 20) ---");
    for (const d of dealsWithoutProperty.slice(0, 20)) {
      console.log(`  Deal ${d.id}: "${d.name}" (pipeline: ${d.pipeline}, contact: ${d.contactId})`);
    }
  }

  if (ticketsWithoutProperty.length > 0) {
    console.log("\n--- Tickets with contact but no Property (first 20) ---");
    for (const t of ticketsWithoutProperty.slice(0, 20)) {
      console.log(`  Ticket ${t.id}: "${t.name}" (contact: ${t.contactId})`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
