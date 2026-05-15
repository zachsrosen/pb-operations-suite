import { ZOHO_WAREHOUSE_IDS } from "@/lib/constants";
import type { ZohoSalesOrderLineItem } from "@/lib/zoho-inventory";
import type { EquipmentCategory } from "@/generated/prisma/enums";

export interface RmaLineItem {
  productId: string;
  brand: string;
  model: string;
  category: EquipmentCategory;
  quantity: number;
  unitSpecLabel?: string | null;
  zohoItemId?: string | null;
  hubspotProductId?: string | null;
  condition?: string | null;
}

export function resolveZohoWarehouse(
  pbLocation: string | null | undefined
): string | undefined {
  if (!pbLocation) return undefined;
  const id =
    ZOHO_WAREHOUSE_IDS[pbLocation] ??
    ZOHO_WAREHOUSE_IDS[pbLocation.toLowerCase()];
  if (!id) {
    console.warn(
      `[zoho-so-helpers] Unknown pb_location "${pbLocation}" — no warehouse mapped`
    );
  }
  return id;
}

export function buildZohoLineItems(
  items: RmaLineItem[],
  warehouseId?: string
): ZohoSalesOrderLineItem[] {
  return items.map((item) => ({
    ...(item.zohoItemId ? { item_id: item.zohoItemId } : {}),
    name: `${item.brand} ${item.model}`.trim() || "Unnamed Product",
    quantity: item.quantity,
    ...(warehouseId ? { warehouse_id: warehouseId } : {}),
  }));
}
