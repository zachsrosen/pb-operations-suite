import type { EstimatorResult, AddressParts } from "./types";

const HUBSPOT_BASE = "https://api.hubapi.com";

function hubspotToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not configured");
  return token;
}

async function hubspotFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      "authorization": `Bearer ${hubspotToken()}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HubSpot ${path} ${resp.status}: ${text.slice(0, 500)}`);
  }
  return (await resp.json()) as T;
}

export interface EstimatorContactInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address: AddressParts;
  lifecyclestage: "lead" | "marketingqualifiedlead";
  waitlistZip?: string;
}

export interface EstimatorContactResult {
  contactId: string;
  created: boolean;
}

export async function upsertEstimatorContact(input: EstimatorContactInput): Promise<EstimatorContactResult> {
  // Search by email first (dedupe).
  const search = await hubspotFetch<{ results: Array<{ id: string }> }>(
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: "email", operator: "EQ", value: input.email }] },
        ],
        limit: 1,
      }),
    },
  );
  const existingId = search.results?.[0]?.id;

  const properties: Record<string, string> = {
    email: input.email,
    firstname: input.firstName,
    lastname: input.lastName,
    lifecyclestage: input.lifecyclestage,
    address: input.address.street,
    city: input.address.city,
    state: input.address.state,
    zip: input.address.zip,
  };
  if (input.phone) properties.phone = input.phone;
  if (input.waitlistZip) properties.waitlist_zip = input.waitlistZip;

  if (existingId) {
    await hubspotFetch(`/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return { contactId: existingId, created: false };
  }
  const created = await hubspotFetch<{ id: string }>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  return { contactId: created.id, created: true };
}

export interface EstimatorDealInput {
  contactId: string;
  dealName: string;
  pipelineId: string;
  stageId: string;
  amount: number;
  source: string;
  resultsToken: string;
  result?: EstimatorResult;
  considerations: {
    planningEv: boolean;
    needsPanelUpgrade: boolean;
    mayNeedNewRoof: boolean;
  };
  addOns: {
    evCharger: boolean;
    panelUpgrade: boolean;
  };
}

export async function createEstimatorDeal(input: EstimatorDealInput): Promise<{ dealId: string }> {
  // Consolidated HubSpot property set (3 custom deal props total, down from 14)
  // so it fits portals near their custom-property cap. All numeric detail is
  // packed into estimator_summary as human-readable multi-line text; ops can
  // pull the full snapshot via estimator_results_token at /estimator/results/[token].
  const properties: Record<string, string> = {
    dealname: input.dealName,
    pipeline: input.pipelineId,
    dealstage: input.stageId,
    amount: String(input.amount),
    estimator_source: input.source,
    estimator_results_token: input.resultsToken,
    estimator_summary: buildSummary(input),
  };

  const deal = await hubspotFetch<{ id: string }>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties,
      associations: [
        {
          to: { id: input.contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }], // deal-to-contact (HUBSPOT_DEFINED typeId 3)
        },
      ],
    }),
  });
  return { dealId: deal.id };
}

/**
 * Build a single human-readable summary block packed into the
 * `estimator_summary` multi-line text deal property. Sales reps can
 * read it directly in the deal view without opening the results page.
 */
function buildSummary(input: EstimatorDealInput): string {
  const r = input.result;
  const lines: string[] = [];
  if (r) {
    lines.push(`System size: ${r.systemKwDc.toFixed(2)} kW DC (${r.panelCount} panels)`);
    lines.push(`Annual production: ${Math.round(r.annualProductionKwh).toLocaleString()} kWh (${Math.round(r.offsetPercent)}% offset)`);
    lines.push(`Retail: $${Math.round(r.pricing.retailUsd).toLocaleString()}`);
    lines.push(`Discount: -$${Math.round(r.pricing.discountUsd).toLocaleString()}`);
    lines.push(`Final: $${Math.round(r.pricing.finalUsd).toLocaleString()}`);
    lines.push(`Monthly payment: $${Math.round(r.pricing.monthlyPaymentUsd).toLocaleString()}/mo`);
  }
  const flags: string[] = [];
  if (input.addOns.evCharger || input.considerations.planningEv) flags.push("EV");
  if (input.addOns.panelUpgrade || input.considerations.needsPanelUpgrade) flags.push("Panel upgrade");
  if (input.considerations.mayNeedNewRoof) flags.push("May need new roof");
  if (flags.length) lines.push(`Considerations: ${flags.join(", ")}`);
  lines.push(`Source: ${input.source}`);
  lines.push(`Token: ${input.resultsToken}`);
  return lines.join("\n");
}
