// src/lib/idr-line-item-presets.ts

export interface LineItemPreset {
  /** Button label shown in UI */
  label: string;
  /** InternalProduct ID for lookup (cuid) */
  internalProductId: string;
  /** Default quantity when adding */
  defaultQty: number;
  /** Optional icon hint for the UI */
  icon?: "shield" | "server" | "zap";
}

/**
 * Quick-add presets for the IDR meeting line item section.
 * Each maps to a known InternalProduct. IDs populated from catalog query.
 *
 * To add a new preset: find the product in /dashboards/catalog, copy its ID,
 * and add an entry here.
 */
export const LINE_ITEM_PRESETS: LineItemPreset[] = [
  {
    label: "Backup Switch",
    internalProductId: "cmm3k3p1c001n04i9vob5wrea", // Tesla 1624171-XX-Y (200A Backup Switch)
    defaultQty: 1,
    icon: "shield",
  },
  {
    label: "Backup Gateway",
    internalProductId: "cmm2xea3z01ma04js97gjek5u", // Tesla 1841000-X1-Y (200A Backup Gateway 3)
    defaultQty: 1,
    icon: "server",
  },
  {
    label: "TRM",
    internalProductId: "cmm4j73w401nybv8ouyy6ssz6", // Tesla 2045796-xx-y (Remote Meter Energy Kit)
    defaultQty: 1,
    icon: "zap",
  },
];
