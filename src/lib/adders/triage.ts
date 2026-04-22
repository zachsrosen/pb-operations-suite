import type {
  AdderWithOverrides,
  ResolvedAdder,
  TriggerLogic,
  AppliesToContext,
} from "./types";
import { resolveShopPrice } from "./pricing";
import { evaluateAppliesTo } from "./applies-to";

/**
 * Evaluate a single triage predicate against a user-supplied answer.
 * Returns false for null/undefined answers rather than throwing, so callers
 * can safely pass through partially-answered triage state.
 *
 * Numeric comparisons coerce string answers to numbers (survey inputs commonly
 * arrive as strings). `contains` always compares as strings. `truthy` is the
 * boolean-coercion escape hatch for yes/no questions.
 */
export function evaluateTriggerLogic(
  logic: TriggerLogic,
  answer: unknown
): boolean {
  if (answer === null || answer === undefined) return false;
  switch (logic.op) {
    case "truthy":
      return Boolean(answer);
    case "contains":
      return String(answer).includes(String(logic.value ?? ""));
    case "eq":
      return compareValues(answer, logic.value) === 0;
    case "lt": {
      const c = compareValues(answer, logic.value);
      return !Number.isNaN(c) && c < 0;
    }
    case "lte": {
      const c = compareValues(answer, logic.value);
      return !Number.isNaN(c) && c <= 0;
    }
    case "gt": {
      const c = compareValues(answer, logic.value);
      return !Number.isNaN(c) && c > 0;
    }
    case "gte": {
      const c = compareValues(answer, logic.value);
      return !Number.isNaN(c) && c >= 0;
    }
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof b === "number") {
    const n = typeof a === "number" ? a : Number(a);
    if (Number.isNaN(n)) return NaN;
    return n - b;
  }
  if (typeof b === "boolean") {
    return Boolean(a) === b ? 0 : 1;
  }
  return String(a).localeCompare(String(b ?? ""));
}

export type RecommendInput = {
  /** Triage answers keyed by adderId. */
  answers: Record<string, unknown>;
  adders: AdderWithOverrides[];
  shop: string;
  dealContext?: { dealType?: string; valueCents?: number };
};

/**
 * Pure-function recommendation engine. Given a set of candidate adders and
 * the rep's answers, return the adders that should be applied to the deal
 * with their resolved unit price (shop-aware) and signed amount.
 *
 * Evaluation order:
 *  1. Skip inactive adders.
 *  2. autoApply adders use `appliesTo` (deal/shop/now context). Qty defaults
 *     to 1 or `qtyConstant` if set.
 *  3. Non-autoApply adders with `triggerLogic` evaluate against
 *     `answers[adder.id]`. Qty comes from `qtyConstant` (default 1) or the
 *     numeric answer when `qtyFrom="answer"`.
 *
 * Amount = qty * unitPrice, signed negative for DISCOUNT direction. unitPrice
 * stays positive regardless of direction so callers can render it directly.
 */
export function recommendAdders(input: RecommendInput): ResolvedAdder[] {
  const out: ResolvedAdder[] = [];
  const ctx: AppliesToContext = {
    shop: input.shop,
    deal: input.dealContext,
    now: new Date(),
  };

  for (const adder of input.adders) {
    if (!adder.active) continue;

    let matched = false;
    let qty = 1;

    if (adder.autoApply) {
      matched = evaluateAppliesTo(adder.appliesTo, ctx);
      if (matched) {
        const logic = adder.triggerLogic as TriggerLogic | null;
        if (logic?.qtyConstant != null) qty = logic.qtyConstant;
      }
    } else {
      const logic = adder.triggerLogic as TriggerLogic | null;
      if (!logic) continue;
      const answer = input.answers[adder.id];
      matched = evaluateTriggerLogic(logic, answer);
      if (matched) {
        if (logic.qtyFrom === "answer") {
          const n = typeof answer === "number" ? answer : Number(answer);
          qty = Number.isNaN(n) ? 1 : n;
        } else if (logic.qtyConstant != null) {
          qty = logic.qtyConstant;
        }
      }
    }

    if (!matched) continue;

    const unitPrice = resolveShopPrice(adder, input.shop);
    const signed = adder.direction === "DISCOUNT" ? -1 : 1;
    const amount = qty * unitPrice * signed;

    out.push({
      code: adder.code,
      name: adder.name,
      category: adder.category,
      type: adder.type,
      direction: adder.direction,
      unit: adder.unit,
      unitPrice,
      qty,
      amount,
    });
  }

  return out;
}
