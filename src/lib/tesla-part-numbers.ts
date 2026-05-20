/**
 * Tesla part-number prefix → human-readable product name.
 *
 * Tesla's partner API reports devices under generic class buckets
 * (`gateways`, `batteries`, `inverters`, `meters`), but for integrated
 * products like Powerwall 3 the same physical unit shows up in the
 * `gateways` bucket — leading to a confusing "Gateway: 1707000-..." label
 * even though the hardware is actually a Powerwall 3.
 *
 * This map lets the UI re-label devices by their actual product type
 * based on part-number prefix.
 *
 * Known prefixes (from Tesla product literature + observed partner-API data):
 *   1707000  Powerwall 3                  (integrated battery + gateway + inverter)
 *   3012170  Powerwall+                   (PW2 with integrated solar inverter)
 *   2012170  Powerwall 2                  (battery only)
 *   1092170  Powerwall 2                  (older revision)
 *   1232100  Backup Gateway 2             (standalone gateway)
 *   1538100  Tesla Solar Inverter         (gen 1, paired with PW2)
 *   1707001  Powerwall 3 Expansion Pack   (battery-only PW3 add-on)
 *   NEURIO   Neurio energy monitor        (Powerwall 2 site meter)
 */
export interface TeslaProduct {
  name: string;
  /**
   * If true, this device's appearance in the "gateways" bucket is misleading —
   * it's actually an integrated battery+gateway unit (Powerwall 3 / Powerwall+).
   * UI should label it as the product name, not "Gateway".
   */
  integratedBatteryGateway?: boolean;
}

const PREFIXES: Array<{ prefix: string; product: TeslaProduct }> = [
  { prefix: "1707000", product: { name: "Powerwall 3", integratedBatteryGateway: true } },
  { prefix: "1707001", product: { name: "Powerwall 3 Expansion Pack" } },
  { prefix: "3012170", product: { name: "Powerwall+", integratedBatteryGateway: true } },
  { prefix: "2012170", product: { name: "Powerwall 2" } },
  { prefix: "1092170", product: { name: "Powerwall 2" } },
  { prefix: "1232100", product: { name: "Tesla Backup Gateway 2" } },
  { prefix: "1538100", product: { name: "Tesla Solar Inverter" } },
];

/**
 * Look up the friendly product name for a Tesla part number, or null
 * if the prefix isn't recognized.
 */
export function teslaProductFromPartNumber(partNumber: string | null | undefined): TeslaProduct | null {
  if (!partNumber) return null;
  const upper = partNumber.toUpperCase().trim();
  if (upper === "NEURIO") return { name: "Neurio Energy Monitor" };
  for (const { prefix, product } of PREFIXES) {
    if (upper.startsWith(prefix)) return product;
  }
  return null;
}

/**
 * Best-effort human label for a device given its part number.
 * Returns the product name if recognized, otherwise the raw part number.
 */
export function teslaDeviceLabel(partNumber: string | null | undefined): string {
  if (!partNumber) return "—";
  const product = teslaProductFromPartNumber(partNumber);
  return product ? product.name : partNumber;
}
