import { registerChecks } from "./index";
import type { CheckFn, ReviewContext, Finding } from "./types";

const dealAmountReasonable: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const amount = parseFloat(ctx.properties.amount ?? "0");
  if (amount > 0 && amount < 5000) {
    return { check: "deal-amount-low", severity: "warning", message: `Deal amount $${amount.toLocaleString()} seems unusually low for a solar install`, field: "amount" };
  }
  if (amount > 200000) {
    return { check: "deal-amount-high", severity: "info", message: `Deal amount $${amount.toLocaleString()} is above $200k — verify this is correct`, field: "amount" };
  }
  return null;
};

const closeDateSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  if (!ctx.properties.closedate) {
    return { check: "close-date-set", severity: "warning", message: "Close date not set on deal", field: "closedate" };
  }
  return null;
};

registerChecks("sales-advisor", [dealAmountReasonable, closeDateSet]);
