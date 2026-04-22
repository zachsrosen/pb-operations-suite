import type { AdderWithOverrides } from "./types";

/** Canonical shop list — matches existing `CrewMember.location` strings. */
export const VALID_SHOPS = [
  "Westminster",
  "DTC",
  "Colorado Springs",
  "SLO",
  "Camarillo",
] as const;

export type Shop = (typeof VALID_SHOPS)[number];

export function isValidShop(value: string): value is Shop {
  return (VALID_SHOPS as readonly string[]).includes(value);
}

/** Resolve final unit price for an adder at a given shop. basePrice + active override delta. */
export function resolveShopPrice(adder: AdderWithOverrides, shop: string): number {
  if (!isValidShop(shop)) throw new Error(`invalid shop: ${shop}`);
  const base = Number(adder.basePrice);
  const override = adder.overrides.find((o) => o.shop === shop && o.active);
  return base + (override ? Number(override.priceDelta) : 0);
}
