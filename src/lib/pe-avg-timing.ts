import { hubspotClient } from "@/lib/hubspot";

/**
 * Maintains the fleet-wide "avg submission → payment (days)" number on every PE
 * deal, so a HubSpot calc property can forecast an expected payment date that
 * self-updates: add_time(pe_m{1,2}_submission_date, pe_m{1,2}_avg_submission_to_payment_days, "day").
 *
 * HubSpot can't reference a cross-deal average inside a per-record formula, so
 * we compute it here and write the same value onto all PE deals. Only deals
 * whose stored value differs get written, so steady-state runs are near no-ops.
 */

const FETCH_PROPS = [
  "pe_m1_submission_date",
  "pe_m1_paid_date",
  "pe_m2_submission_date",
  "pe_m2_paid_date",
  "pe_m1_avg_submission_to_payment_days",
  "pe_m2_avg_submission_to_payment_days",
];

const M1_PROP = "pe_m1_avg_submission_to_payment_days";
const M2_PROP = "pe_m2_avg_submission_to_payment_days";

/** Whole-day gap between two HubSpot date values, or null if unusable/negative. */
function dayGap(sub: string | null | undefined, paid: string | null | undefined): number | null {
  if (!sub || !paid) return null;
  const s = Date.parse(String(sub).length <= 10 ? `${sub}T00:00:00Z` : String(sub));
  const p = Date.parse(String(paid).length <= 10 ? `${paid}T00:00:00Z` : String(paid));
  if (Number.isNaN(s) || Number.isNaN(p)) return null;
  const g = Math.round((p - s) / 86_400_000);
  return g >= 0 ? g : null;
}

function mean(a: number[]): number | null {
  return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
}

export interface AvgTimingResult {
  m1Avg: number | null;
  m1Count: number;
  m2Avg: number | null;
  m2Count: number;
  examined: number;
  updated: number;
}

export async function syncPeAvgTiming(opts: { dryRun?: boolean } = {}): Promise<AvgTimingResult> {
  // 1. All PE deals + their submission/paid dates and current stored averages.
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

  // 2. Fleet averages, measured straight from submission → paid (authoritative,
  //    independent of the per-deal calc props backfilling).
  const m1Gaps = deals.map((d) => dayGap(d.p.pe_m1_submission_date, d.p.pe_m1_paid_date)).filter((v): v is number => v !== null);
  const m2Gaps = deals.map((d) => dayGap(d.p.pe_m2_submission_date, d.p.pe_m2_paid_date)).filter((v): v is number => v !== null);
  const m1Avg = mean(m1Gaps);
  const m2Avg = mean(m2Gaps);

  // 3. Write to every PE deal whose stored value differs (skip no-ops).
  const inputs: { id: string; properties: Record<string, string> }[] = [];
  for (const d of deals) {
    const props: Record<string, string> = {};
    if (m1Avg !== null && String(d.p[M1_PROP] ?? "") !== String(m1Avg)) props[M1_PROP] = String(m1Avg);
    if (m2Avg !== null && String(d.p[M2_PROP] ?? "") !== String(m2Avg)) props[M2_PROP] = String(m2Avg);
    if (Object.keys(props).length) inputs.push({ id: d.id, properties: props });
  }

  let updated = 0;
  if (!opts.dryRun) {
    for (let i = 0; i < inputs.length; i += 100) {
      await hubspotClient.crm.deals.batchApi.update({ inputs: inputs.slice(i, i + 100) });
      updated += Math.min(100, inputs.length - i);
    }
  }

  return { m1Avg, m1Count: m1Gaps.length, m2Avg, m2Count: m2Gaps.length, examined: deals.length, updated: opts.dryRun ? 0 : updated };
}
