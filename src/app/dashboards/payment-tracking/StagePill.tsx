/**
 * Stage display: shows the human-readable stage name as a colored pill,
 * with a small "phase" indicator (Pre-Install / Install / Post-Install / Closeout)
 * so accounting can quickly see where the project is in its lifecycle.
 */

// Mapped from DEAL_STAGE_MAP in src/lib/hubspot.ts (Project pipeline stages,
// since this dashboard only shows post-RTB Project pipeline deals).
type Phase = "presale" | "presurvey" | "design" | "permitting" | "rtb" | "construction" | "inspection" | "pto" | "closeout";

const STAGE_PHASE: Record<string, Phase> = {
  // Project pipeline numeric IDs
  "20461935": "presale", // Project Rejected
  "20461936": "presurvey", // Site Survey
  "20461937": "design", // Design & Engineering
  "20461938": "permitting", // Permitting & Interconnection
  "71052436": "rtb", // RTB - Blocked
  "22580871": "rtb", // Ready To Build
  "20440342": "construction", // Construction
  "22580872": "inspection", // Inspection
  "20461940": "pto", // Permission To Operate
  "24743347": "closeout", // Close Out
  "20440343": "closeout", // Project Complete
};

const PHASE_COLOR: Record<Phase, string> = {
  presale: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  presurvey: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  design: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  permitting: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  rtb: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  construction: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  inspection: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  pto: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  closeout: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const PHASE_ORDER: Phase[] = [
  "presale",
  "presurvey",
  "design",
  "permitting",
  "rtb",
  "construction",
  "inspection",
  "pto",
  "closeout",
];

export function StagePill({ stageId, label }: { stageId: string; label: string }) {
  const phase = STAGE_PHASE[stageId];
  if (!phase) {
    // Unknown stage — render as muted text with the raw label
    return (
      <span className="text-muted text-[11px]" title={`Stage ID: ${stageId}`}>
        {label}
      </span>
    );
  }
  const idx = PHASE_ORDER.indexOf(phase) + 1;
  const total = PHASE_ORDER.length;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border whitespace-nowrap ${PHASE_COLOR[phase]}`}
      title={`${label} (phase ${idx} of ${total})`}
    >
      <span className="opacity-60 tabular-nums">{idx}/{total}</span>
      <span>{label}</span>
    </span>
  );
}
