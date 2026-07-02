/**
 * Monthly "poke" that keeps the NOW-based PE KPI calculated properties fresh.
 *
 * HubSpot only recomputes a calculation property when a property its formula
 * references physically changes on the record — the calendar advancing is NOT
 * such an event, so `month(NOW())`-based properties go stale at each month
 * rollover (a June-paid deal keeps reading as "this month" into July).
 *
 * Each of the 6 time-windowed PE KPI properties references `pe_recalc_nonce`
 * in a zero-valued term (`+ (if is_present(pe_recalc_nonce) then 0 else 0)`),
 * so it contributes nothing to the value but IS tracked as a dependency.
 * Bumping the nonce is therefore a real referenced-field change, which forces
 * HubSpot to recompute those properties with the current date. We only need to
 * do this once per month; the last-bumped month is tracked in SystemConfig so
 * the hourly cron is a no-op the rest of the time.
 *
 * Affected properties (all month-granularity):
 *   pe_received_this_month, pe_approved_this_month, pe_submitted_this_month,
 *   pe_expected_remaining_this_month, pe_expected_next_month, pe_overdue_total
 */
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { searchWithRetry } from "@/lib/hubspot";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";
import { PE_TAG_VALUE } from "@/lib/pe-payment-split";
import { prisma } from "@/lib/db";

const NONCE_PROP = "pe_recalc_nonce";
const CONFIG_KEY = "pe_recalc_nonce_month";

/** UTC year-month key, e.g. "2026-07". */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * If the calendar month has changed since the last bump, write a fresh nonce
 * value to every Project-pipeline PE deal, forcing HubSpot to recompute the
 * NOW-based KPI calc properties. Idempotent within a month (no-op after the
 * first run of the month). `now` is injectable for testing.
 */
export async function bumpPeRecalcNonceIfMonthChanged(opts?: {
  now?: Date;
}): Promise<{ bumped: boolean; month: string; deals: number }> {
  const now = opts?.now ?? new Date();
  const month = monthKey(now);

  const existing = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (existing?.value === month) return { bumped: false, month, deals: 0 };

  // Collect all Project-pipeline PE deal ids.
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const resp = (await searchWithRetry({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PIPELINE_IDS.project },
            { propertyName: "tags", operator: FilterOperatorEnum.ContainsToken, value: PE_TAG_VALUE },
          ],
        },
      ],
      properties: ["hs_object_id"],
      limit: 100,
      ...(after ? { after } : {}),
    } as never)) as { results: { id: string }[]; paging?: { next?: { after?: string } } };
    for (const d of resp.results) ids.push(d.id);
    after = resp.paging?.next?.after;
  } while (after);

  // Bump the nonce (a new, distinct value) on every deal in batches of 100.
  const nonce = String(now.getTime());
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  for (let i = 0; i < ids.length; i += 100) {
    const inputs = ids.slice(i, i + 100).map((id) => ({ id, properties: { [NONCE_PROP]: nonce } }));
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/batch/update", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs }),
    });
    if (!res.ok) {
      throw new Error(`nonce batch update failed (${res.status}): ${await res.text()}`);
    }
  }

  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: month },
    update: { value: month },
  });

  return { bumped: true, month, deals: ids.length };
}
