import type { SerializedDeal } from "./types";

interface TeamCardProps {
  deal: SerializedDeal;
}

function TeamRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted">{label}</span>
      <span className="text-xs text-foreground">{value || "—"}</span>
    </div>
  );
}

export default function TeamCard({ deal }: TeamCardProps) {
  const leads = deal.departmentLeads ?? {};

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Team
      </h3>
      <div className="space-y-0.5">
        <TeamRow label="Owner" value={deal.dealOwnerName} />
        <TeamRow label="PM" value={deal.projectManager} />
        <TeamRow label="Ops Manager" value={deal.operationsManager} />
        <TeamRow label="Surveyor" value={deal.siteSurveyor} />
        <TeamRow label="Design Lead" value={leads.design} />
        <TeamRow label="Permit Tech" value={leads.permit_tech} />
        <TeamRow label="IC Tech" value={leads.interconnections_tech} />
        <TeamRow label="RTB Lead" value={leads.rtb_lead} />
      </div>
    </div>
  );
}
