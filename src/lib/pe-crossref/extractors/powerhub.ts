/**
 * PowerHub asset extractor.
 *
 * Pulls the most recent PowerhubSite row linked to the deal and lifts out
 * the Powerwall battery entries — used by HardwareAnalyzer to detect
 * PowerHub-vs-nameplate variant mismatches.
 *
 * Returns null when:
 *   - POWERHUB_ENABLED feature flag is not "true"
 *   - no PowerhubSite is linked to this deal yet
 *   - the row exists but has no battery devices in its JSON snapshot
 */

import { prisma } from "@/lib/db";
import type { PowerHubAssetSummary } from "@/lib/pe-crossref/types";

interface PowerhubBatteryJson {
  device_id?: string;
  din?: string;
  part_number?: string;
  serial_number?: string;
}

interface PowerhubDevicesJson {
  batteries?: PowerhubBatteryJson[];
}

export async function fetchPowerHubAsset(dealId: string): Promise<PowerHubAssetSummary | null> {
  if (process.env.POWERHUB_ENABLED !== "true") return null;

  const site = await prisma.powerhubSite.findFirst({
    where: { dealId },
    orderBy: { lastAssetSyncAt: "desc" },
    select: { id: true, devices: true },
  });
  if (!site) return null;

  const devices = (site.devices ?? {}) as PowerhubDevicesJson;
  const batteries = devices.batteries ?? [];
  if (batteries.length === 0) return null;

  return {
    siteId: site.id,
    powerwallEntries: batteries.map((b) => ({
      model: b.part_number ?? "unknown",
      serial: b.serial_number ?? undefined,
    })),
  };
}
