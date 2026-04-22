import type { AdderWithOverrides, AppliesToContext, ResolvedAdder } from "./types";
import { evaluateAppliesTo } from "./applies-to";

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

/**
 * Pure resolver: given a set of adders + context, return the auto-apply
 * matches as ResolvedAdder[]. Has no DB dependency — easy to unit-test.
 *
 * For each adder:
 *   - must be autoApply
 *   - must pass evaluateAppliesTo(appliesTo, context)
 *   - unit price is base + active shop override
 *   - qty defaults to 1 (percentage math handled downstream by the caller)
 *   - amount is signed: negative when direction=DISCOUNT
 */
export function resolveAddersFromList(
  adders: AdderWithOverrides[],
  context: { shop: string } & AppliesToContext
): ResolvedAdder[] {
  const matches: ResolvedAdder[] = [];
  for (const a of adders) {
    if (!a.autoApply) continue;
    if (!evaluateAppliesTo(a.appliesTo, context)) continue;
    const unitPrice = resolveShopPrice(a, context.shop);
    const qty = 1;
    const sign = a.direction === "DISCOUNT" ? -1 : 1;
    matches.push({
      code: a.code,
      name: a.name,
      category: a.category,
      type: a.type,
      direction: a.direction,
      unit: a.unit,
      unitPrice,
      qty,
      amount: sign * unitPrice * qty,
    });
  }
  return matches;
}

// Note: `resolveAddersForCalc` (the DB-aware wrapper around
// `resolveAddersFromList`) lives in `./resolve-for-calc.ts`. Keeping it
// out of this file preserves `pricing.ts` as client-safe (no prisma /
// node:module imports via `./catalog`).
