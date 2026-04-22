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
  const properties: Record<string, string> = {
    dealname: input.dealName,
    pipeline: input.pipelineId,
    dealstage: input.stageId,
    amount: String(input.amount),
    estimator_source: input.source,
    estimator_results_token: input.resultsToken,
    estimator_has_ev: input.addOns.evCharger || input.considerations.planningEv ? "true" : "false",
    estimator_has_panel_upgrade:
      input.addOns.panelUpgrade || input.considerations.needsPanelUpgrade ? "true" : "false",
    estimator_considers_battery: "false",
    estimator_considers_new_roof: input.considerations.mayNeedNewRoof ? "true" : "false",
  };

  if (input.result) {
    properties.estimator_system_size_kw = String(input.result.systemKwDc);
    properties.estimator_panel_count = String(input.result.panelCount);
    properties.estimator_annual_production_kwh = String(Math.round(input.result.annualProductionKwh));
    properties.estimator_offset_percent = String(input.result.offsetPercent);
    properties.estimator_retail_usd = String(Math.round(input.result.pricing.retailUsd));
    properties.estimator_incentives_usd = String(Math.round(input.result.pricing.discountUsd));
    properties.estimator_final_usd = String(Math.round(input.result.pricing.finalUsd));
    properties.estimator_monthly_payment_usd = String(Math.round(input.result.pricing.monthlyPaymentUsd));
  }

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
