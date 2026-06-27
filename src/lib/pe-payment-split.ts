/**
 * Canonical PE (Participate Energy) payment-split calculation.
 *
 * This is the SINGLE SOURCE OF TRUTH for deriving a deal's PE milestone
 * payments (M1 = IC, M2 = PC) and PB revenue from its EPC price and
 * lease-factor inputs. Consumed by:
 *   - the PE Deals route (display + opportunistic HubSpot write-back)
 *   - the pe-api-sync cron (self-healing write-back)
 *   - scripts/backfill-pe-payment-splits.ts (one-time backfill)
 *
 * If you change the formula, every consumer updates automatically.
 */
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  PE_LEASE,
  calcLeaseFactorAdjustment,
  DC_QUALIFYING_MODULE_BRANDS,
  DC_QUALIFYING_BATTERY_BRANDS,
  type PeSystemType,
} from "@/lib/pricing-calculator";
import { EC_QUALIFYING_ZIPS } from "@/lib/ec-qualifying-zips";
import { searchWithRetry, updateDealProperty } from "@/lib/hubspot";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";

/** HubSpot `tags` value that flags a Participate Energy deal. */
export const PE_TAG_VALUE = "Participate Energy";

/** Round to 2dp and serialise as a string for HubSpot compare / store. */
export function currencyStr(n: number | null): string | null {
  return n === null ? null : n.toFixed(2);
}

/** Normalise a fetched HubSpot number property to the same 2dp string shape. */
export function currencyPropStr(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

export interface PeSplit {
  systemType: PeSystemType;
  solarDC: boolean;
  batteryDC: boolean;
  energyCommunity: boolean;
  leaseFactor: number;
  /** Deal contract price (= deal amount); null if amount missing/<= 0. */
  epcPrice: number | null;
  /** Payment fields are null when epcPrice is null. */
  customerPays: number | null;
  pePaymentTotal: number | null;
  /** Milestone 1 (Installation Complete). */
  ic: number | null;
  /** Milestone 2 (Permission to Operate / Close Out). */
  pc: number | null;
  totalPbRevenue: number | null;
}

/**
 * Compute the PE payment split for a deal from its HubSpot properties.
 * Mirrors the calculation in the PE Deals route exactly.
 */
export function computePeSplit(p: Record<string, unknown>): PeSplit {
  const amount = p.amount ? parseFloat(String(p.amount)) : null;
  const epcPrice = amount && amount > 0 ? amount : null;

  // System type
  const projectType = String(p.project_type || "").toLowerCase();
  const batteryCount = parseInt(String(p.battery_count || "0")) || 0;
  let systemType: PeSystemType = "solar";
  if (projectType.includes("battery") && projectType.includes("solar")) {
    systemType = "solar+battery";
  } else if (projectType.includes("battery") || (batteryCount > 0 && !projectType)) {
    systemType = batteryCount > 0 && !projectType.includes("solar") ? "battery" : "solar+battery";
  }

  // DC qualifications
  const moduleBrand = String(p.module_brand || "");
  const batteryBrand = String(p.battery_brand || "");
  const solarDC =
    moduleBrand.length > 0 &&
    DC_QUALIFYING_MODULE_BRANDS.some((b) => moduleBrand.toLowerCase().includes(b.toLowerCase()));
  const batteryDC =
    batteryCount > 0 &&
    DC_QUALIFYING_BATTERY_BRANDS.some((b) => batteryBrand.toLowerCase().includes(b.toLowerCase()));

  // Energy Community — static lookup, no network calls
  const zip5 = String(p.postal_code || "").trim().match(/^(\d{5})/)?.[1] ?? null;
  const energyCommunity = zip5 ? EC_QUALIFYING_ZIPS.has(zip5) : false;

  // Lease factor
  const leaseFactor =
    PE_LEASE.baselineFactor + calcLeaseFactorAdjustment(systemType, solarDC, batteryDC, energyCommunity);

  // Payment calculations — null if no EPC price
  let customerPays: number | null = null;
  let pePaymentTotal: number | null = null;
  let ic: number | null = null;
  let pc: number | null = null;
  let totalPbRevenue: number | null = null;
  if (epcPrice !== null) {
    customerPays = epcPrice * 0.7;
    pePaymentTotal = epcPrice - epcPrice / leaseFactor;
    ic = pePaymentTotal * (2 / 3);
    pc = pePaymentTotal * (1 / 3);
    totalPbRevenue = customerPays + pePaymentTotal;
  }

  return {
    systemType,
    solarDC,
    batteryDC,
    energyCommunity,
    leaseFactor,
    epcPrice,
    customerPays,
    pePaymentTotal,
    ic,
    pc,
    totalPbRevenue,
  };
}

export interface PePaymentSplitBackfillResult {
  scanned: number;
  /** Deals written (or that WOULD be written when dryRun). */
  updated: number;
  failed: number;
  /** Deals skipped because they have no usable amount (epcPrice null). */
  skippedNoAmount: number;
  /** Deals already correct (no write needed). */
  unchanged: number;
  dryRun: boolean;
  samples: { dealId: string; dealName: string; ic: string; pc: string }[];
}

/**
 * Self-healing backfill: scan all Project-pipeline PE-tagged deals and write
 * pe_payment_ic / pe_payment_pc / pe_total_pb_revenue wherever the stored value
 * diverges from the canonical calculation. Idempotent — only writes deltas.
 */
export async function backfillPePaymentSplits(opts?: {
  dryRun?: boolean;
}): Promise<PePaymentSplitBackfillResult> {
  const dryRun = opts?.dryRun ?? false;
  const properties = [
    "hs_object_id",
    "dealname",
    "amount",
    "project_type",
    "battery_count",
    "module_brand",
    "battery_brand",
    "postal_code",
    "pe_payment_ic",
    "pe_payment_pc",
    "pe_total_pb_revenue",
  ];

  const result: PePaymentSplitBackfillResult = {
    scanned: 0,
    updated: 0,
    failed: 0,
    skippedNoAmount: 0,
    unchanged: 0,
    dryRun,
    samples: [],
  };

  const toUpdate: { dealId: string; dealName: string; properties: Record<string, string> }[] = [];

  let after: string | undefined;
  do {
    const response = (await searchWithRetry({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PIPELINE_IDS.project },
            { propertyName: "tags", operator: FilterOperatorEnum.ContainsToken, value: PE_TAG_VALUE },
          ],
        },
      ],
      properties,
      limit: 100,
      ...(after ? { after } : {}),
    } as never)) as {
      results: { properties: Record<string, unknown> }[];
      paging?: { next?: { after?: string } };
    };

    for (const d of response.results) {
      result.scanned++;
      const p = d.properties;
      const split = computePeSplit(p);
      if (split.ic === null || split.pc === null || split.totalPbRevenue === null) {
        result.skippedNoAmount++;
        continue;
      }
      const calcIC = currencyStr(split.ic)!;
      const calcPC = currencyStr(split.pc)!;
      const calcRev = currencyStr(split.totalPbRevenue)!;

      const upd: Record<string, string> = {};
      if (currencyPropStr(p.pe_payment_ic) !== calcIC) upd.pe_payment_ic = calcIC;
      if (currencyPropStr(p.pe_payment_pc) !== calcPC) upd.pe_payment_pc = calcPC;
      if (currencyPropStr(p.pe_total_pb_revenue) !== calcRev) upd.pe_total_pb_revenue = calcRev;

      if (Object.keys(upd).length === 0) {
        result.unchanged++;
        continue;
      }
      toUpdate.push({
        dealId: String(p.hs_object_id),
        dealName: String(p.dealname || "Untitled"),
        properties: upd,
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  for (const u of toUpdate) {
    if (result.samples.length < 10) {
      result.samples.push({
        dealId: u.dealId,
        dealName: u.dealName,
        ic: u.properties.pe_payment_ic ?? "(unchanged)",
        pc: u.properties.pe_payment_pc ?? "(unchanged)",
      });
    }
    if (dryRun) {
      result.updated++;
      continue;
    }
    const ok = await updateDealProperty(u.dealId, u.properties);
    if (ok) result.updated++;
    else result.failed++;
  }

  return result;
}
