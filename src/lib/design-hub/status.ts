/**
 * Status-update only: validate → PATCH → note + activity log. Post-PATCH
 * failures are warnings, never errors — the status write already landed.
 * Ported from lib/pi-hub/status.ts.
 */

import { hubspotClient } from "@/lib/hubspot";
import { withHubSpotRetry } from "@/lib/bulk-sync-confirmation";
import { getActiveEnumOptions } from "@/lib/hubspot-enum-labels";
import { createDealNote } from "@/lib/hubspot-engagements";
import { prisma } from "@/lib/db";
import { TAB_CONFIGS } from "./config";
import type { SetStatusResult, Tab } from "./types";

export async function setStatus(opts: {
  tab: Tab;
  dealId: string;
  newValue: string;
  userEmail: string;
  userName?: string;
  userId: string | null;
}): Promise<SetStatusResult> {
  const config = TAB_CONFIGS[opts.tab];
  // ACTIVE options only — getEnumLabelMap merges archived values, and
  // offering those for writing would let a user set a dead status.
  const options = await getActiveEnumOptions(config.statusProperty);
  // Empty options means the definition fetch failed (or the property has no
  // enum options at all) — say so, rather than mislabeling every value as
  // "not an active option".
  if (options.length === 0) {
    throw new Error(
      `could not load ${config.statusProperty} options from HubSpot — try again`,
    );
  }
  const option = options.find((o) => o.value === opts.newValue);
  if (!option) {
    throw new Error(
      `"${opts.newValue}" is not an active ${config.statusProperty} option`,
    );
  }

  // THE write. Everything after is courtesy and may only warn.
  const patchResult = await withHubSpotRetry(
    () =>
      hubspotClient.crm.deals.basicApi.update(opts.dealId, {
        properties: { [config.statusProperty]: opts.newValue },
      }),
    `design-hub setStatus ${config.statusProperty}`,
  );
  if (!patchResult.ok) throw new Error(patchResult.error);

  const warnings: string[] = [];
  const noteBody = `<b>Status set via Design Hub</b><br>${config.label}: ${option.label}<br>By: ${opts.userEmail}`;
  try {
    await createDealNote(opts.dealId, noteBody);
  } catch (err) {
    warnings.push(
      `note failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    await prisma.activityLog.create({
      data: {
        type: "HUBSPOT_DEAL_UPDATED",
        description: `${config.label} status → ${option.label}`,
        userId: opts.userId ?? undefined,
        userEmail: opts.userEmail,
        userName: opts.userName,
        entityType: "deal",
        entityId: opts.dealId,
        metadata: { tab: opts.tab, value: opts.newValue } as never,
      },
    });
  } catch (err) {
    warnings.push(
      `activity log failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { ok: true, warnings };
}
