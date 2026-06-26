import { hubspotClient } from "@/lib/hubspot";

/**
 * Maintains fleet-wide forecast-lag numbers on every PE deal so HubSpot calc
 * properties can forecast an expected payment date that self-updates:
 *   - submission leg: add_time(pe_m{1,2}_submission_date, pe_m{1,2}_avg_submission_to_payment_days, "day")
 *   - approval leg:   add_time(pe_m{1,2}_approval_date,   pe_m{1,2}_avg_approval_to_payment_days,   "day")
 *   - CC leg:         add_time(construction_complete_date, pe_m{1,2}_avg_cc_to_payment_days,        "day")
 *
 * HubSpot can't reference a cross-deal average inside a per-record formula, so
 * we compute it here and write the same value onto all PE deals. Each leg uses
 * (mean + median) / 2 — a balanced central estimate that keeps the median's
 * resistance to slow-payer outliers while letting the mean nudge it. Only deals
 * whose stored value differs get written, so steady-state runs are near no-ops.
 */

const SUB_M1 = "pe_m1_avg_submission_to_payment_days";
const SUB_M2 = "pe_m2_avg_submission_to_payment_days";
const APP_M1 = "pe_m1_avg_approval_to_payment_days";
const APP_M2 = "pe_m2_avg_approval_to_payment_days";
const CC_M1 = "pe_m1_avg_cc_to_payment_days";
const CC_M2 = "pe_m2_avg_cc_to_payment_days";

const FETCH_PROPS = [
  "pe_m1_submission_date",
  "pe_m2_submission_date",
  "pe_m1_approval_date",
  "pe_m2_approval_date",
  "construction_complete_date",
  "pe_m1_paid_date",
  "pe_m2_paid_date",
  SUB_M1, SUB_M2, APP_M1, APP_M2, CC_M1, CC_M2,
];

/** Whole-day gap between two HubSpot date values, or null if unusable/negative. */
function dayGap(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(String(from).length <= 10 ? `${from}T00:00:00Z` : String(from));
  const b = Date.parse(String(to).length <= 10 ? `${to}T00:00:00Z` : String(to));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const g = Math.round((b - a) / 86_400_000);
  return g >= 0 ? g : null;
}

/** Balanced central estimate: the average of the mean and the median, rounded. */
function blend(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const mean = s.reduce((x, y) => x + y, 0) / s.length;
  const median = s[Math.floor(s.length / 2)];
  return Math.round((mean + median) / 2);
}

export interface AvgTimingResult {
  subM1: number | null; subM1Count: number;
  subM2: number | null; subM2Count: number;
  appM1: number | null; appM1Count: number;
  appM2: number | null; appM2Count: number;
  ccM1: number | null; ccM1Count: number;
  ccM2: number | null; ccM2Count: number;
  examined: number;
  updated: number;
}

export async function syncPeAvgTiming(opts: { dryRun?: boolean } = {}): Promise<AvgTimingResult> {
  // 1. All PE deals + their dates and current stored averages.
  const deals: { id: string; p: Record<string, string | null | undefined> }[] = [];
  let after: string | undefined;
  do {
    const res = await hubspotClient.crm.deals.searchApi.doSearch({
      filterGroups: [{ filters: [{ propertyName: "pe_project_id", operator: "HAS_PROPERTY" }] }],
      properties: FETCH_PROPS,
      limit: 100,
      after,
    } as Parameters<typeof hubspotClient.crm.deals.searchApi.doSearch>[0]);
    for (const r of res.results) deals.push({ id: r.id, p: r.properties });
    after = res.paging?.next?.after;
  } while (after);

  // 2. Fleet (mean+median)/2 per leg, measured straight from the dates
  //    (authoritative, independent of the per-deal calc props backfilling).
  const subM1Gaps = deals.map((d) => dayGap(d.p.pe_m1_submission_date, d.p.pe_m1_paid_date)).filter((v): v is number => v !== null);
  const subM2Gaps = deals.map((d) => dayGap(d.p.pe_m2_submission_date, d.p.pe_m2_paid_date)).filter((v): v is number => v !== null);
  const appM1Gaps = deals.map((d) => dayGap(d.p.pe_m1_approval_date, d.p.pe_m1_paid_date)).filter((v): v is number => v !== null);
  const appM2Gaps = deals.map((d) => dayGap(d.p.pe_m2_approval_date, d.p.pe_m2_paid_date)).filter((v): v is number => v !== null);
  const ccM1Gaps = deals.map((d) => dayGap(d.p.construction_complete_date, d.p.pe_m1_paid_date)).filter((v): v is number => v !== null);
  const ccM2Gaps = deals.map((d) => dayGap(d.p.construction_complete_date, d.p.pe_m2_paid_date)).filter((v): v is number => v !== null);
  const subM1 = blend(subM1Gaps), subM2 = blend(subM2Gaps);
  const appM1 = blend(appM1Gaps), appM2 = blend(appM2Gaps);
  const ccM1 = blend(ccM1Gaps), ccM2 = blend(ccM2Gaps);

  // 3. Write to every PE deal whose stored value differs (skip no-ops).
  const set = (props: Record<string, string>, key: string, val: number | null, cur: string | null | undefined) => {
    if (val !== null && String(cur ?? "") !== String(val)) props[key] = String(val);
  };
  const inputs: { id: string; properties: Record<string, string> }[] = [];
  for (const d of deals) {
    const props: Record<string, string> = {};
    set(props, SUB_M1, subM1, d.p[SUB_M1]);
    set(props, SUB_M2, subM2, d.p[SUB_M2]);
    set(props, APP_M1, appM1, d.p[APP_M1]);
    set(props, APP_M2, appM2, d.p[APP_M2]);
    set(props, CC_M1, ccM1, d.p[CC_M1]);
    set(props, CC_M2, ccM2, d.p[CC_M2]);
    if (Object.keys(props).length) inputs.push({ id: d.id, properties: props });
  }

  let updated = 0;
  if (!opts.dryRun) {
    for (let i = 0; i < inputs.length; i += 100) {
      await hubspotClient.crm.deals.batchApi.update({ inputs: inputs.slice(i, i + 100) });
      updated += Math.min(100, inputs.length - i);
    }
  }

  return {
    subM1, subM1Count: subM1Gaps.length, subM2, subM2Count: subM2Gaps.length,
    appM1, appM1Count: appM1Gaps.length, appM2, appM2Count: appM2Gaps.length,
    ccM1, ccM1Count: ccM1Gaps.length, ccM2, ccM2Count: ccM2Gaps.length,
    examined: deals.length, updated: opts.dryRun ? 0 : updated,
  };
}
