import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { searchWithRetry, hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS, getStageMaps } from "@/lib/deals-pipeline";
import {
  PE_LEASE,
  calcLeaseFactorAdjustment,
  DC_QUALIFYING_MODULE_BRANDS,
  DC_QUALIFYING_BATTERY_BRANDS,
  type PeSystemType,
} from "@/lib/pricing-calculator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeDeal {
  dealId: string;
  dealName: string;
  companyName: string | null;
  pbLocation: string;
  dealStage: string;
  dealStageLabel: string;
  closeDate: string | null;
  systemType: "solar" | "battery" | "solar+battery";
  epcPrice: number | null;
  customerPays: number | null;
  pePaymentTotal: number | null;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  totalPBRevenue: number | null;
  postalCode: string | null;
  energyCommunity: boolean;
  ecLookupFailed: boolean;
  solarDC: boolean;
  batteryDC: boolean;
  leaseFactor: number;
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | null;
  hubspotUrl: string;
}

// ---------------------------------------------------------------------------
// EC cache — simple Map with 24h TTL (EC designations update annually)
// ---------------------------------------------------------------------------

const EC_TTL = 24 * 60 * 60 * 1000;
const ecCache = new Map<string, { result: boolean; ts: number }>();

async function lookupEC(zip: string): Promise<{ ec: boolean; failed: boolean }> {
  const cached = ecCache.get(zip);
  if (cached && Date.now() - cached.ts < EC_TTL) {
    return { ec: cached.result, failed: false };
  }
  try {
    const res = await fetch(
      `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/energy-community/check?zip=${zip}`,
    );
    if (!res.ok) return { ec: false, failed: true };
    const data = await res.json();
    ecCache.set(zip, { result: data.isEnergyCommunity, ts: Date.now() });
    return { ec: data.isEnergyCommunity, failed: false };
  } catch {
    return { ec: false, failed: true };
  }
}

// ---------------------------------------------------------------------------
// HubSpot deal properties to fetch
// ---------------------------------------------------------------------------

const PE_DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "pb_location",
  "postal_code",
  "project_type",
  "battery_count",
  "battery_brand",
  "module_brand",
  // PE-specific — update these after discovering exact property names
  "participate_energy_status",
  "is_participate_energy",
  // PE M1/M2 — placeholder names, update after HubSpot inspection
  "pe_m1_status",
  "pe_m2_status",
];

// ---------------------------------------------------------------------------
// Fetch PE deals from a single pipeline
// ---------------------------------------------------------------------------

async function fetchPeDealsFromPipeline(
  pipelineKey: string,
  peFilterProperty: string,
): Promise<Record<string, unknown>[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) return [];

  const allDeals: Record<string, unknown>[] = [];

  if (pipelineId === "default") {
    // HubSpot's search API rejects pipeline="default" as a filter value.
    // Workaround: query by deal stage IDs (same pattern as deals/route.ts).
    const stageMaps = await getStageMaps();
    const stageIds = Object.keys(stageMaps[pipelineKey] || {});
    const BATCH_SIZE = 5;

    for (let i = 0; i < stageIds.length; i += BATCH_SIZE) {
      const batch = stageIds.slice(i, i + BATCH_SIZE);
      if (i > 0) await new Promise((r) => setTimeout(r, 150));

      let after: string | undefined;
      do {
        const searchRequest = {
          filterGroups: batch.map((stageId) => ({
            filters: [
              { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: stageId },
              { propertyName: peFilterProperty, operator: FilterOperatorEnum.HasProperty },
            ] as any,
          })),
          properties: PE_DEAL_PROPERTIES,
          limit: 100,
          ...(after ? { after } : {}),
        } as any;
        const response = await searchWithRetry(searchRequest);
        allDeals.push(...response.results.map((d) => d.properties));
        after = response.paging?.next?.after;
      } while (after);
    }
  } else {
    // Non-default pipelines can filter by pipeline ID directly
    let after: string | undefined;
    do {
      const searchRequest = {
        filterGroups: [{
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
            { propertyName: peFilterProperty, operator: FilterOperatorEnum.HasProperty },
          ] as any,
        }],
        properties: PE_DEAL_PROPERTIES,
        sorts: [{ propertyName: "closedate", direction: "DESCENDING" }] as unknown as string[],
        limit: 100,
        ...(after ? { after } : {}),
      } as any;
      const response = await searchWithRetry(searchRequest);
      allDeals.push(...response.results.map((d) => d.properties));
      after = response.paging?.next?.after;
    } while (after);
  }

  return allDeals;
}

// ---------------------------------------------------------------------------
// Resolve company names from deal associations
// ---------------------------------------------------------------------------

async function resolveCompanyNames(
  dealIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (dealIds.length === 0) return map;

  try {
    const batchSize = 100;
    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batch = dealIds.slice(i, i + batchSize);
      const response =
        await hubspotClient.crm.associations.batchApi.read("deals", "companies", {
          inputs: batch.map((id) => ({ id })),
        });

      const companyIds = new Set<string>();
      const dealToCompany = new Map<string, string>();

      // IMPORTANT: use _from (underscore) — this codebase's HubSpot SDK version
      for (const result of response.results || []) {
        const dealId = result._from?.id;
        const companyId = (result.to || [])[0]?.id;
        if (dealId && companyId) {
          companyIds.add(companyId);
          dealToCompany.set(dealId, companyId);
        }
      }

      if (companyIds.size > 0) {
        const companies =
          await hubspotClient.crm.companies.batchApi.read({
            inputs: Array.from(companyIds).map((id) => ({ id })),
            properties: ["name"],
            propertiesWithHistory: [],
          });

        const companyNameMap = new Map<string, string>();
        for (const co of companies.results) {
          companyNameMap.set(co.id, co.properties.name || "Unknown");
        }

        for (const [dId, cId] of dealToCompany) {
          map.set(dId, companyNameMap.get(cId) || "Unknown");
        }
      }
    }
  } catch (err) {
    console.error("[pe-deals] Failed to resolve company names:", err);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = ["ADMIN", "EXECUTIVE"];
  if (!allowed.includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  try {
    const peFilterProperty = "participate_energy_status";

    // Only project pipeline — active deals (exclude Project Complete + Cancelled)
    const INACTIVE_PROJECT_STAGES = ["20440343", "68229433"];
    const projectDeals = await fetchPeDealsFromPipeline("project", peFilterProperty);
    const rawDeals = projectDeals.filter(
      (d) => !INACTIVE_PROJECT_STAGES.includes(String(d.dealstage)),
    );

    // Resolve stage labels
    const stageMaps = await getStageMaps();
    const allStageMaps = (stageMaps.project || {}) as Record<string, string>;

    // Resolve company names
    const dealIds = rawDeals.map((d) => String(d.hs_object_id));
    const companyNames = await resolveCompanyNames(dealIds);

    // Batch EC lookups by unique zip code
    const uniqueZips = new Set<string>();
    for (const deal of rawDeals) {
      const zip = String(deal.postal_code || "").trim();
      if (/^\d{5}$/.test(zip)) uniqueZips.add(zip);
    }

    const ecResults = new Map<string, { ec: boolean; failed: boolean }>();
    await Promise.all(
      Array.from(uniqueZips).map(async (zip) => {
        const result = await lookupEC(zip);
        ecResults.set(zip, result);
      }),
    );

    // Transform deals
    const deals: PeDeal[] = rawDeals.map((deal) => {
      const dealId = String(deal.hs_object_id);
      const amount = deal.amount ? parseFloat(String(deal.amount)) : null;
      const epcPrice = amount && amount > 0 ? amount : null;
      const postalCode = String(deal.postal_code || "").trim() || null;
      const zip5 = postalCode && /^\d{5}$/.test(postalCode) ? postalCode : null;
      const stageId = String(deal.dealstage || "");
      const stageLabel = allStageMaps[stageId] || stageId;

      // System type
      const projectType = String(deal.project_type || "").toLowerCase();
      const batteryCount = parseInt(String(deal.battery_count || "0")) || 0;
      let systemType: PeSystemType = "solar";
      if (projectType.includes("battery") && projectType.includes("solar")) {
        systemType = "solar+battery";
      } else if (projectType.includes("battery") || (batteryCount > 0 && !projectType)) {
        systemType = batteryCount > 0 && !projectType.includes("solar") ? "battery" : "solar+battery";
      }

      // DC qualifications
      const moduleBrand = String(deal.module_brand || "");
      const batteryBrand = String(deal.battery_brand || "");
      const solarDC =
        moduleBrand.length > 0 &&
        DC_QUALIFYING_MODULE_BRANDS.some((b) =>
          moduleBrand.toLowerCase().includes(b.toLowerCase()),
        );
      const batteryDC =
        batteryCount > 0 &&
        DC_QUALIFYING_BATTERY_BRANDS.some((b) =>
          batteryBrand.toLowerCase().includes(b.toLowerCase()),
        );

      // Energy Community
      const ecResult = zip5 ? ecResults.get(zip5) : undefined;
      const energyCommunity = ecResult?.ec ?? false;
      const ecLookupFailed = ecResult?.failed ?? false;

      // Lease factor
      const adjustment = calcLeaseFactorAdjustment(systemType, solarDC, batteryDC, energyCommunity);
      const leaseFactor = PE_LEASE.baselineFactor + adjustment;

      // Payment calculations — null if no EPC price
      let customerPays: number | null = null;
      let pePaymentTotal: number | null = null;
      let pePaymentIC: number | null = null;
      let pePaymentPC: number | null = null;
      let totalPBRevenue: number | null = null;

      if (epcPrice !== null) {
        customerPays = epcPrice * 0.7;
        pePaymentTotal = epcPrice - epcPrice / leaseFactor;
        pePaymentIC = pePaymentTotal * (2 / 3);
        pePaymentPC = pePaymentTotal * (1 / 3);
        totalPBRevenue = customerPays + pePaymentTotal;
      }

      return {
        dealId,
        dealName: String(deal.dealname || "Untitled"),
        companyName: companyNames.get(dealId) || null,
        pbLocation: String(deal.pb_location || ""),
        dealStage: stageId,
        dealStageLabel: stageLabel,
        closeDate: deal.closedate ? String(deal.closedate) : null,
        systemType,
        epcPrice,
        customerPays,
        pePaymentTotal,
        pePaymentIC,
        pePaymentPC,
        totalPBRevenue,
        postalCode,
        energyCommunity,
        ecLookupFailed,
        solarDC,
        batteryDC,
        leaseFactor,
        peM1Status: deal.pe_m1_status ? String(deal.pe_m1_status) : null,
        peM2Status: deal.pe_m2_status ? String(deal.pe_m2_status) : null,
        milestoneHighlight:
          stageLabel === "Permission To Operate" ? "m1" as const
          : stageLabel === "Close Out" ? "m2" as const
          : null,
        hubspotUrl: `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`,
      };
    });

    return NextResponse.json({ deals, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error("[pe-deals] Error fetching PE deals:", err);
    return NextResponse.json({ error: "Failed to fetch PE deals" }, { status: 500 });
  }
}
