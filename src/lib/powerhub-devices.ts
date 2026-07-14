/**
 * PowerHub device classification.
 *
 * Tesla's asset API reports Powerwall 3 units (part family 1707000) in the
 * `gateway` sub-object — because a PW3 contains the system gateway (the
 * "leader") — not in the `battery` sub-object. Taken at face value that makes
 * PW3 sites show "N gateways, 0 batteries", which is wrong: a PW3 IS a battery.
 *
 * This module is the single source of truth for turning a stored device
 * snapshot into gateway/battery/inverter counts, reclassifying PW3 units in
 * the gateway list as batteries. Genuine Backup Gateways (part family 1232100)
 * and other controllers stay gateways.
 */

/** Tesla part family for the Powerwall 3 (battery with integrated gateway). */
const POWERWALL_GATEWAY_PART_PREFIXES = ["1707000"];

export interface PowerhubDeviceEntry {
  part_number?: string | null;
  din?: string | null;
  serial_number?: string | null;
}

export interface PowerhubDeviceSnapshot {
  gateways?: PowerhubDeviceEntry[];
  batteries?: PowerhubDeviceEntry[];
  inverters?: PowerhubDeviceEntry[];
  meters?: PowerhubDeviceEntry[];
  evse?: PowerhubDeviceEntry[];
}

/**
 * A device in the gateway list that is really a Powerwall (battery). Matches on
 * the part-number family, tolerant of the `-11-L` / din suffixes.
 */
export function isPowerwallInGatewayList(entry: PowerhubDeviceEntry): boolean {
  const part = (entry.part_number || entry.din || "").trim();
  return POWERWALL_GATEWAY_PART_PREFIXES.some((p) => part.startsWith(p));
}

export interface PowerhubDeviceCounts {
  totalGateways: number;
  totalBatteries: number;
  totalInverters: number;
}

/**
 * Compute corrected device counts from a device snapshot, moving Powerwall 3
 * units out of the gateway count and into the battery count.
 *
 * `gatewayTotalFallback` is Tesla's `gateway.total_gateways` — used only when
 * the gateways array is empty (no part numbers to classify), since then we
 * can't tell PW3 from a real gateway.
 */
export function computeDeviceCounts(
  snapshot: PowerhubDeviceSnapshot | null | undefined,
  gatewayTotal?: number | null
): PowerhubDeviceCounts {
  const gateways = snapshot?.gateways ?? [];
  const batteriesArr = snapshot?.batteries ?? [];
  const invertersArr = snapshot?.inverters ?? [];

  // Preserve the original gateway-count source (Tesla's total_gateways when
  // present, else the array length) — matches the pre-fix behavior exactly.
  // Then MOVE Powerwall 3 units from gateways to batteries. Sites without a
  // PW3 in the gateway list are left completely unchanged.
  const rawGatewayCount = gatewayTotal ?? gateways.length;
  const pw3InGateways = gateways.filter(isPowerwallInGatewayList).length;

  return {
    totalGateways: Math.max(0, rawGatewayCount - pw3InGateways),
    totalBatteries: batteriesArr.length + pw3InGateways,
    totalInverters: invertersArr.length,
  };
}
