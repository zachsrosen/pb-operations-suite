import { formatMoney } from "@/lib/format";
import type { PermitProjectDetail } from "@/lib/permit-hub";

export function OverviewTab({ detail }: { detail: PermitProjectDetail }) {
  const { deal } = detail;
  const fields: Array<[string, string | null]> = [
    ["Address", deal.address],
    ["Location", deal.pbLocation],
    ["System size", deal.systemSizeKw ? `${deal.systemSizeKw.toFixed(2)} kW` : null],
    ["Amount", deal.amount != null ? formatMoney(deal.amount) : null],
    ["Permit lead", deal.permitLead],
    ["Project manager", deal.pm],
    ["Current status", deal.permittingStatus || null],
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
