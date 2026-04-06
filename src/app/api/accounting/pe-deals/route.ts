import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { searchWithRetry, hubspotClient, updateDealProperty } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS, getStageMaps } from "@/lib/deals-pipeline";
import {
  PE_LEASE,
  calcLeaseFactorAdjustment,
  DC_QUALIFYING_MODULE_BRANDS,
  DC_QUALIFYING_BATTERY_BRANDS,
  type PeSystemType,
} from "@/lib/pricing-calculator";
import { safeWaitUntil } from "@/lib/safe-wait-until";
import { EC_QUALIFYING_ZIPS } from "@/lib/ec-qualifying-zips";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round to 2dp and serialise as a string for HubSpot compare / store. */
function currencyStr(n: number | null): string | null {
  return n === null ? null : n.toFixed(2);
}

/** Normalise a fetched HubSpot number property to the same 2dp string shape. */
function currencyPropStr(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pending HubSpot write for a single deal's PE payment properties. */
interface PeSyncEntry {
  dealId: string;
  properties: Record<string, string>;
}

interface PeDeal {
  dealId: string;
  dealName: string;
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
// EC lookup — static zip set from Treasury IRS Notice 2025-31 data
// Source: EC_MSA_FFE_U2024 (Statistical Area) + Census ZCTA-County crosswalk
// Covers all CO (53 counties) + CA (35 counties) qualifying under FFE+unemployment
// ---------------------------------------------------------------------------

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
  "tags",
  // PE-specific
  "participate_energy_status",
  "is_participate_energy",
  // PE milestone statuses (confirmed via HubSpot property search)
  "pe_m1_status",
  "pe_m2_status",
  // PE payment properties — synced back to HubSpot on each load
  "pe_payment_ic",
  "pe_payment_pc",
  "pe_total_pb_revenue",
];

// ---------------------------------------------------------------------------
// Fetch PE deals from a single pipeline
// ---------------------------------------------------------------------------

const PE_TAG_VALUE = "Participate Energy";

async function fetchPeDealsFromPipeline(
  pipelineKey: string,
): Promise<Record<string, unknown>[]> {
  const pipelineId = PIPELINE_IDS[pipelineKey];
  if (!pipelineId) return [];

  const allDeals: Record<string, unknown>[] = [];

  // Project pipeline uses a numeric ID — filter by pipeline + tag
  let after: string | undefined;
  do {
    const searchRequest = {
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId },
          { propertyName: "tags", operator: FilterOperatorEnum.ContainsToken, value: PE_TAG_VALUE },
        ],
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

  return allDeals;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  try {
    // Only project pipeline — active deals (exclude Project Complete + Cancelled)
    const INACTIVE_PROJECT_STAGES = ["20440343", "68229433"];
    const projectDeals = await fetchPeDealsFromPipeline("project");
    const rawDeals = projectDeals.filter(
      (d) => !INACTIVE_PROJECT_STAGES.includes(String(d.dealstage)),
    );

    // Resolve stage labels
    const stageMaps = await getStageMaps();
    const allStageMaps = (stageMaps.project || {}) as Record<string, string>;

    // EC lookup — static set, no network calls needed

    // Transform deals + build HubSpot sync batch in one pass
    // (raw `deal` properties are only in scope inside this .map())
    const syncBatch: PeSyncEntry[] = [];

    const deals: PeDeal[] = rawDeals.map((deal) => {
      const dealId = String(deal.hs_object_id);
      const amount = deal.amount ? parseFloat(String(deal.amount)) : null;
      const epcPrice = amount && amount > 0 ? amount : null;
      const postalCode = String(deal.postal_code || "").trim() || null;
      // Extract first 5 digits — handles ZIP+4 ("80027-8024") and leading spaces
      const zipMatch = postalCode?.match(/^(\d{5})/);
      const zip5 = zipMatch ? zipMatch[1] : null;
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

      // Energy Community — static lookup, no network calls
      const energyCommunity = zip5 ? EC_QUALIFYING_ZIPS.has(zip5) : false;
      const ecLookupFailed = false;

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

      // ------------------------------------------------------------------
      // HubSpot sync: compare calculated values against fetched properties.
      // Uses currencyStr() for both compare and store so rounding is
      // identical and floating-point drift never triggers a false write.
      // ------------------------------------------------------------------
      if (epcPrice !== null) {
        const calcIC = currencyStr(pePaymentIC)!;
        const calcPC = currencyStr(pePaymentPC)!;
        const calcRev = currencyStr(totalPBRevenue)!;

        const storedIC = currencyPropStr(deal.pe_payment_ic);
        const storedPC = currencyPropStr(deal.pe_payment_pc);
        const storedRev = currencyPropStr(deal.pe_total_pb_revenue);

        const propsToUpdate: Record<string, string> = {};
        if (storedIC !== calcIC) propsToUpdate.pe_payment_ic = calcIC;
        if (storedPC !== calcPC) propsToUpdate.pe_payment_pc = calcPC;
        if (storedRev !== calcRev) propsToUpdate.pe_total_pb_revenue = calcRev;

        if (Object.keys(propsToUpdate).length > 0) {
          syncBatch.push({ dealId, properties: propsToUpdate });
        }
      }

      return {
        dealId,
        dealName: String(deal.dealname || "Untitled"),
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
        hubspotUrl: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`,
      };
    });

    // Sync stale PE payment properties to HubSpot in the background
    if (syncBatch.length > 0) {
      safeWaitUntil(
        (async () => {
          const results = await Promise.allSettled(
            syncBatch.map(({ dealId, properties }) =>
              updateDealProperty(dealId, properties),
            ),
          );
          const synced = results.filter(
            (r) => r.status === "fulfilled" && r.value === true,
          ).length;
          const failed = results.length - synced;
          console.log(
            `[pe-deals] PE payment sync: ${synced} updated, ${failed} failed out of ${results.length} stale deals`,
          );
        })(),
      );
    }

    return NextResponse.json({ deals, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error("[pe-deals] Error fetching PE deals:", err);
    return NextResponse.json({ error: "Failed to fetch PE deals" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update M1/M2 status on a deal in HubSpot
// ---------------------------------------------------------------------------

const VALID_M1M2_VALUES = [
  "Ready to Submit",
  "Waiting on Information",
  "Submitted",
  "Rejected",
  "Ready to Resubmit",
  "Resubmitted",
  "Approved",
  "Paid",
];

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { dealId, field, value } = body as {
      dealId: string;
      field: "pe_m1_status" | "pe_m2_status";
      value: string;
    };

    if (!dealId || !field) {
      return NextResponse.json({ error: "Missing dealId or field" }, { status: 400 });
    }

    if (field !== "pe_m1_status" && field !== "pe_m2_status") {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    // Allow clearing (empty string) or setting to a valid value
    if (value && !VALID_M1M2_VALUES.includes(value)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }

    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: { [field]: value || "" },
    });

    console.log(`[pe-deals] ${user.email} updated ${field}="${value}" on deal ${dealId}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[pe-deals] Error updating milestone status:", err);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
