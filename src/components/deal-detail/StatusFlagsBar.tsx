import type { SerializedDeal } from "./types";

/** Boolean flags with their associated pipeline stage for relevance logic */
const PROJECT_FLAGS: { key: string; label: string; stage: string }[] = [
  { key: "isSiteSurveyScheduled", label: "Survey Scheduled", stage: "Site Survey" },
  { key: "isSiteSurveyCompleted", label: "Survey Completed", stage: "Site Survey" },
  { key: "isDaSent", label: "DA Sent", stage: "Design & Engineering" },
  { key: "isLayoutApproved", label: "Design Approved", stage: "Design & Engineering" },
  { key: "isDesignDrafted", label: "Design Drafted", stage: "Design & Engineering" },
  { key: "isDesignCompleted", label: "Design Completed", stage: "Design & Engineering" },
  { key: "isPermitSubmitted", label: "Permit Submitted", stage: "Permitting & Interconnection" },
  { key: "isPermitIssued", label: "Permit Issued", stage: "Permitting & Interconnection" },
  { key: "isIcSubmitted", label: "IC Submitted", stage: "Permitting & Interconnection" },
  { key: "isIcApproved", label: "IC Approved", stage: "Permitting & Interconnection" },
  { key: "isInspectionPassed", label: "Inspection Passed", stage: "Inspection" },
  { key: "hasInspectionFailed", label: "Inspection Failed", stage: "Inspection" },
];

interface StatusFlagsBarProps {
  deal: SerializedDeal;
  stageOrder: string[];
}

export default function StatusFlagsBar({ deal, stageOrder }: StatusFlagsBarProps) {
  // Only show for PROJECT pipeline
  if (deal.pipeline !== "PROJECT") return null;

  const currentStageIdx = stageOrder.findIndex(
    (s) => s.toLowerCase() === (deal.stage ?? "").toLowerCase()
  );

  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {PROJECT_FLAGS.map((flag) => {
        const value = !!deal[flag.key];
        const flagStageIdx = stageOrder.findIndex(
          (s) => s.toLowerCase() === flag.stage.toLowerCase()
        );
        const isRelevant = flagStageIdx <= currentStageIdx;

        let chipClass: string;
        let icon: string;

        if (value) {
          // True — green
          chipClass = "bg-green-500/15 text-green-500 border-green-500/30";
          icon = "✓";
        } else if (isRelevant) {
          // False but relevant (should be done by now) — orange warning
          chipClass = "bg-orange-500/15 text-orange-500 border-orange-500/30";
          icon = "◌";
        } else {
          // False and future — gray
          chipClass = "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
          icon = "—";
        }

        return (
          <span
            key={flag.key}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${chipClass}`}
          >
            {icon} {flag.label}
          </span>
        );
      })}
    </div>
  );
}
