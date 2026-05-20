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
    internalProductId: "TODO_POPULATE_FROM_CATALOG",
    defaultQty: 1,
    icon: "shield",
  },
  {
    label: "Backup Gateway",
    internalProductId: "TODO_POPULATE_FROM_CATALOG",
    defaultQty: 1,
    icon: "server",
  },
  {
    label: "TRM",
    internalProductId: "TODO_POPULATE_FROM_CATALOG",
    defaultQty: 1,
    icon: "zap",
  },
];
