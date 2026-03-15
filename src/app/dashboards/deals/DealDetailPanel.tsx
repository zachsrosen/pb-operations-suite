"use client";

import { useEffect, useCallback } from "react";
import StatusDot from "./StatusDot";
import { STATUS_COLUMNS, isProjectPipeline, formatStatusValue, type TableDeal } from "./deals-types";
import { STAGE_COLORS } from "@/lib/constants";
import { formatMoney } from "@/lib/format";

interface DealDetailPanelProps {
  deal: TableDeal | null;
  onClose: () => void;
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DealDetailPanel({ deal, onClose }: DealDetailPanelProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  if (!deal) return null;

  const isProject = isProjectPipeline(deal.pipeline);
  const stageColor = STAGE_COLORS[deal.stage]?.hex || "#71717A";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[400px] max-w-[90vw] bg-surface border-l border-t-border z-50 overflow-y-auto shadow-2xl animate-slideInRight">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-t-border px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate">{deal.name}</h2>
            <span
              className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: `${stageColor}22`,
                color: stageColor,
              }}
            >
              {deal.stage}
            </span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl leading-none mt-0.5">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* Quick actions */}
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 text-orange-400 border border-orange-500/30 rounded-lg text-xs font-medium hover:bg-orange-500/20 transition-colors"
          >
            Open in HubSpot
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>

          {/* Info section */}
          <Section title="Info">
            <InfoRow label="Address" value={[deal.address, deal.city, deal.state, deal.postalCode].filter(Boolean).join(", ") || "—"} />
            <InfoRow label="Location" value={deal.pbLocation} />
            <InfoRow label="Project Type" value={deal.projectType} />
            {isProject && <InfoRow label="Owner" value={deal.dealOwner || "—"} />}
            <InfoRow label="Amount" value={formatMoney(deal.amount)} />
            <InfoRow label="Close Date" value={formatDate(deal.closeDate)} />
            {deal.createDate && <InfoRow label="Create Date" value={formatDate(deal.createDate)} />}
            {isProject && deal.daysSinceStageMovement != null && (
              <InfoRow label="Days in Stage" value={`${deal.daysSinceStageMovement} days`} />
            )}
            {!isProject && deal.daysSinceCreate > 0 && (
              <InfoRow label="Days Since Created" value={`${deal.daysSinceCreate} days`} />
            )}
          </Section>

          {/* Status section — project pipeline only */}
          {isProject && (
            <Section title="Status">
              {STATUS_COLUMNS.map((col) => {
                const val = deal[col.key as keyof TableDeal] as string | null;
                return (
                  <div key={col.key} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-muted">{col.fullName}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <StatusDot value={val} />
                      <span className="text-foreground/80">{formatStatusValue(val, col.key)}</span>
                    </span>
                  </div>
                );
              })}
            </Section>
          )}

          {/* Dates section — project pipeline only */}
          {isProject && (
            <Section title="Key Dates">
              <InfoRow label="Site Survey Scheduled" value={formatDate(deal.siteSurveyScheduleDate ?? null)} />
              <InfoRow label="Site Survey Completed" value={formatDate(deal.siteSurveyCompletionDate ?? null)} />
              <InfoRow label="Design Drafted" value={formatDate(deal.designDraftDate ?? null)} />
              <InfoRow label="Design Approval Sent" value={formatDate(deal.designApprovalSentDate ?? null)} />
              <InfoRow label="Design Approved" value={formatDate(deal.designApprovalDate ?? null)} />
              <InfoRow label="Design Completed" value={formatDate(deal.designCompletionDate ?? null)} />
              <InfoRow label="Interconnection Submitted" value={formatDate(deal.interconnectionSubmitDate ?? null)} />
              <InfoRow label="Interconnection Approved" value={formatDate(deal.interconnectionApprovalDate ?? null)} />
              <InfoRow label="Permit Submitted" value={formatDate(deal.permitSubmitDate ?? null)} />
              <InfoRow label="Permit Issued" value={formatDate(deal.permitIssueDate ?? null)} />
              <InfoRow label="Ready To Build" value={formatDate(deal.readyToBuildDate ?? null)} />
              <InfoRow label="Construction Scheduled" value={formatDate(deal.constructionScheduleDate ?? null)} />
              <InfoRow label="Construction Complete" value={formatDate(deal.constructionCompleteDate ?? null)} />
              <InfoRow label="Inspection Scheduled" value={formatDate(deal.inspectionScheduleDate ?? null)} />
              <InfoRow label="Inspection Passed" value={formatDate(deal.inspectionPassDate ?? null)} />
              <InfoRow label="PTO Submitted" value={formatDate(deal.ptoSubmitDate ?? null)} />
              <InfoRow label="PTO Granted" value={formatDate(deal.ptoGrantedDate ?? null)} />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{title}</h3>
      <div className="bg-surface-2/50 rounded-lg px-3 py-2 divide-y divide-t-border/50">
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs text-foreground/80 text-right max-w-[200px] truncate" title={value}>
        {value}
      </span>
    </div>
  );
}
