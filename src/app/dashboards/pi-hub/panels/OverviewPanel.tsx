import { formatMoney } from "@/lib/format";
import type { ProjectDetail } from "@/lib/pi-hub/types";

/**
 * Team-generic overview. Ported from permit-hub's OverviewTab, with the
 * permit-specific "Permit lead" / "Next action" rows dropped: the unified
 * detail carries a resolved `deal.lead` (whatever the team's lead property is)
 * and no per-status action, so the labels stay neutral.
 */
export function OverviewPanel({ detail }: { detail: ProjectDetail }) {
  const { deal } = detail;
  const fields: Array<[string, string | null]> = [
    ["Address", deal.address],
    ["Location", deal.pbLocation],
    ["System size", deal.systemSizeKw ? `${deal.systemSizeKw.toFixed(2)} kW` : null],
    ["Amount", deal.amount != null ? formatMoney(deal.amount) : null],
    ["Lead", deal.lead],
    ["Project manager", deal.pm],
    ["Current status", deal.statusLabel || deal.status || null],
    ["Deal stage", deal.dealStage],
  ];
  // Identifier rows only when present: application # exists on IC/PTO deals,
  // the IA number only on Xcel deals.
  if (deal.applicationNumber) fields.push(["Application #", deal.applicationNumber]);
  if (deal.xcelIaNumber) fields.push(["Xcel IA #", deal.xcelIaNumber]);
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
