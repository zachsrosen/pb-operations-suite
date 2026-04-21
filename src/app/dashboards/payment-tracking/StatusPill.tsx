import type { DaStatus, PeStatus } from "@/lib/payment-tracking-types";

type AnyStatus = DaStatus | PeStatus;

const DA_COLORS: Record<DaStatus, string> = {
  "Pending Approval": "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  "Open": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "Paid In Full": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const PE_COLORS: Record<PeStatus, string> = {
  "Ready to Submit": "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  "Waiting on Information": "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  "Submitted": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Resubmitted": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Rejected": "bg-red-500/20 text-red-300 border-red-500/30",
  "Ready to Resubmit": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "Approved": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  "Paid": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export function StatusPill({ status }: { status: AnyStatus | null }) {
  if (!status) return <span className="text-muted">—</span>;
  const cls =
    (DA_COLORS as Record<string, string>)[status] ??
    (PE_COLORS as Record<string, string>)[status];
  const label = status === "Waiting on Information" ? "Waiting" : status;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] border whitespace-nowrap ${cls ?? ""}`}
      title={status}
    >
      {label}
    </span>
  );
}
