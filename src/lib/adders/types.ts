import type {
  Adder,
  AdderShopOverride,
  AdderRevision,
} from "@/generated/prisma/client";
import {
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
} from "@/generated/prisma/enums";

export type { Adder, AdderShopOverride, AdderRevision };
export {
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
};

/** Adder row enriched with its shop overrides. */
export type AdderWithOverrides = Adder & { overrides: AdderShopOverride[] };

/**
 * `triggerLogic` predicate evaluated against a triage answer.
 * Phase 1: single-predicate only — no and/or combinators.
 */
export type TriggerLogic = {
  op: "lt" | "lte" | "eq" | "gte" | "gt" | "contains" | "truthy";
  value?: number | string | boolean;
  qtyFrom?: "answer" | "constant";
  qtyConstant?: number;
};

/**
 * `appliesTo` predicate for auto-apply adders.
 * Phase 1: single-predicate only — no boolean combinators.
 *
 * Supported LHS identifiers: shop, deal.dealType, deal.valueCents, now.
 * Supported ops: ==, !=, <, <=, >, >=, in, not in.
 */
export type AppliesToContext = {
  shop?: string;
  deal?: { dealType?: string; valueCents?: number };
  now?: Date;
};

/** A pricing-ready adder with its shop-resolved unit price. */
export type ResolvedAdder = {
  code: string;
  name: string;
  category: AdderCategory;
  type: AdderType;
  direction: AdderDirection;
  unit: AdderUnit;
  unitPrice: number; // basePrice + shop delta; positive even for DISCOUNT
  qty: number;
  amount: number; // signed: negative when direction=DISCOUNT
};
