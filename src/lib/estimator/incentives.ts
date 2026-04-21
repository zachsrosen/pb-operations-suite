import type { AppliedIncentive, IncentiveRecord } from "./types";

export interface IncentiveApplicationInput {
  incentives: IncentiveRecord[];
  retailUsd: number;
  finalKwDc: number;
}

export interface IncentiveApplicationResult {
  applied: AppliedIncentive[];
  totalUsd: number;
}

export function applyIncentives(input: IncentiveApplicationInput): IncentiveApplicationResult {
  const applied: AppliedIncentive[] = input.incentives.map((i) => {
    let amount = 0;
    if (i.type === "fixed") {
      amount = i.value;
    } else if (i.type === "perWatt") {
      amount = i.value * input.finalKwDc * 1000;
    } else if (i.type === "percent") {
      amount = input.retailUsd * i.value;
    }
    if (typeof i.cap === "number" && Number.isFinite(i.cap)) {
      amount = Math.min(amount, i.cap);
    }
    amount = Math.max(0, amount);
    return { id: i.id, label: i.label, amountUsd: amount };
  });
  const totalUsd = applied.reduce((sum, a) => sum + a.amountUsd, 0);
  return { applied, totalUsd };
}
