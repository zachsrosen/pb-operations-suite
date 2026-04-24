import { formatMoney } from "@/lib/format";
import type { IcProjectDetail } from "@/lib/ic-hub";

export function OverviewTab({ detail }: { detail: IcProjectDetail }) {
  const { deal } = detail;
  const fields: Array<[string, string | null]> = [
    ["Address", deal.address],
    ["Location", deal.pbLocation],
    ["System size", deal.systemSizeKw ? `${deal.systemSizeKw.toFixed(2)} kW` : null],
    ["Amount", deal.amount != null ? formatMoney(deal.amount) : null],
    ["IC lead", deal.icLead],
    ["Project manager", deal.pm],
    ["Current status", deal.interconnectionStatus || null],
    ["Next action", deal.actionLabel],
    ["Deal stage", deal.dealStage],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted text-xs uppercase tracking-wide">{label}</dt>
          <dd className="mt-0.5 font-medium">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
