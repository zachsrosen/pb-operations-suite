"use client";

import type { ShitShowItem } from "./types";
import { ProjectInfoPanel } from "./ProjectInfoPanel";
import { HistoryStrip } from "./HistoryStrip";
import { IdrNotesContext } from "./IdrNotesContext";
import { MeetingNotesForm } from "./MeetingNotesForm";
import { AssignmentsPanel } from "./AssignmentsPanel";
import { DecisionActions } from "./DecisionActions";

export function ProjectDetail({
  item,
  onChanged,
  readOnly,
}: {
  item: ShitShowItem;
  onChanged: () => Promise<void>;
  readOnly: boolean;
}) {
  return (
    <div className="overflow-y-auto h-full p-4 space-y-3">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-foreground">{item.dealName}</h2>
        <div className="text-sm text-muted">
          {item.region} · {item.dealAmount ? `$${(item.dealAmount / 1000).toFixed(0)}k` : "—"}
          {item.flaggedSince && ` · flagged ${new Date(item.flaggedSince).toLocaleDateString()}`}
        </div>
      </div>

      {/* FAILED note retry banner */}
      {item.noteSyncStatus === "FAILED" && (
        <div className="rounded bg-red-900/40 border border-red-700 px-3 py-2 text-sm text-red-100 flex items-center justify-between gap-2">
          <span className="truncate">
            HubSpot note post failed: {item.noteSyncError ?? "(no detail)"}
          </span>
          <button
            onClick={async () => {
              await fetch(`/api/shit-show-meeting/items/${item.id}/retry-note`, {
                method: "POST",
              });
              await onChanged();
            }}
            className="bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-xs shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Reason */}
      <div className="bg-surface-2 rounded-lg p-3">
        <div className="text-xs uppercase tracking-wider text-muted mb-1">Why it's here</div>
        <div className="text-sm text-foreground whitespace-pre-wrap">
          {item.reasonSnapshot ?? "(no reason given)"}
        </div>
      </div>

      <ProjectInfoPanel item={item} />
      <HistoryStrip item={item} />
      <IdrNotesContext dealId={item.dealId} />

      {!readOnly && (
        <>
          <MeetingNotesForm item={item} onSaved={onChanged} />
          <AssignmentsPanel item={item} onChanged={onChanged} />
          <DecisionActions item={item} onChanged={onChanged} />
        </>
      )}

      {readOnly && (
        <>
          <div className="bg-surface-2 rounded-lg p-3">
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Meeting notes</div>
            <div className="text-sm text-foreground whitespace-pre-wrap">
              {item.meetingNotes ?? "(no notes)"}
            </div>
          </div>
          <div className="bg-surface-2 rounded-lg p-3">
            <div className="text-xs uppercase tracking-wider text-muted mb-1">Decision</div>
            <div className="text-sm text-foreground">
              {item.decision} {item.decisionRationale && `— ${item.decisionRationale}`}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
