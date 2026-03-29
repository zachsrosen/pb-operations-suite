"use client";

import { formatCurrency, formatShortDate } from "@/lib/format";

export interface ConstructionProjectDetailPanelProject {
  id: string;
  name: string;
  address: string;
  location: string;
  amount: number;
  type: string;
  systemSize: number;
  batteries: number;
  evCount: number;
  installStatus: string;
  completionDate: string | null;
  closeDate: string | null;
  hubspotUrl: string;
  zuperJobUid?: string;
  zuperJobStatus?: string;
  zuperAssignedTo?: string[];
}

interface ConstructionProjectDetailPanelProps {
  project: ConstructionProjectDetailPanelProject;
  scheduledDate: string | null;
  scheduleDurationDays: number;
  scheduleSourceLabel: string;
  isOverdue: boolean;
  isTentative: boolean;
  confirmingTentative: boolean;
  cancellingTentative: boolean;
  zuperWebBaseUrl: string;
  zuperRangeStart?: string;
  zuperRangeEnd?: string;
  onOpenSchedule: () => void;
  onClearSelection: () => void;
  onUnschedule?: () => void;
  onConfirmTentative?: () => void;
  onCancelTentative?: () => void;
}

function getCustomerName(fullName: string): string {
  return fullName.split(" | ")[1] || fullName;
}

function getProjectId(fullName: string): string {
  return fullName.split(" | ")[0];
}

function getStatusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes("tentative")) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (normalized.includes("complete")) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (normalized.includes("scheduled")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (normalized.includes("progress")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (normalized.includes("ready")) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (normalized.includes("hold")) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-zinc-500/20 text-muted border-muted/30";
}

function DetailRow(props: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted">{props.label}</span>
      <span className={`text-right ${props.valueClass || "text-foreground"}`}>{props.value}</span>
    </div>
  );
}

export function ConstructionProjectDetailPanel({
  project,
  scheduledDate,
  scheduleDurationDays,
  scheduleSourceLabel,
  isOverdue,
  isTentative,
  confirmingTentative,
  cancellingTentative,
  zuperWebBaseUrl,
  zuperRangeStart,
  zuperRangeEnd,
  onOpenSchedule,
  onClearSelection,
  onUnschedule,
  onConfirmTentative,
  onCancelTentative,
}: ConstructionProjectDetailPanelProps) {
  const assignedTo = project.zuperAssignedTo || [];

  return (
    <div className="mt-4 bg-surface border border-t-border rounded-xl overflow-hidden">
      <div className="p-3 border-b border-t-border bg-surface/50 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-cyan-400">Project Detail</h2>
        <button
          onClick={onClearSelection}
          className="text-xs text-muted hover:text-foreground"
        >
          Clear
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground truncate">{getCustomerName(project.name)}</p>
          <p className="text-xs text-muted truncate">{getProjectId(project.name)}</p>
          <p className="text-xs text-muted mt-0.5 line-clamp-2">{project.address}</p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[0.7rem] px-1.5 py-0.5 rounded border ${getStatusColor(project.installStatus)}`}>
            {project.installStatus}
          </span>
          {isOverdue && (
            <span className="text-[0.7rem] px-1.5 py-0.5 rounded border bg-red-500/20 text-red-300 border-red-500/40">
              Overdue
            </span>
          )}
          {isTentative && (
            <span className="text-[0.7rem] px-1.5 py-0.5 rounded border border-dashed bg-amber-500/15 text-amber-300 border-amber-500/40">
              Tentative
            </span>
          )}
        </div>

        <div className="space-y-1.5 border border-t-border rounded-lg p-2 bg-background/40">
          <DetailRow label="Location" value={project.location} />
          <DetailRow label="Type" value={project.type || "Solar"} />
          <DetailRow label="Amount" value={formatCurrency(project.amount)} valueClass="text-orange-400 font-semibold" />
          <DetailRow label="System" value={`${project.systemSize.toFixed(1)} kW`} />
          <DetailRow
            label="Storage"
            value={`${project.batteries} battery${project.batteries === 1 ? "" : "ies"}${project.evCount > 0 ? `, ${project.evCount} EV` : ""}`}
          />
        </div>

        <div className="space-y-1.5 border border-t-border rounded-lg p-2 bg-background/40">
          <DetailRow
            label="Scheduled"
            value={scheduledDate ? formatShortDate(scheduledDate) : "Not scheduled"}
            valueClass={scheduledDate ? "text-blue-400 font-semibold" : "text-muted"}
          />
          <DetailRow
            label="Duration"
            value={`${scheduleDurationDays} day${scheduleDurationDays === 1 ? "" : "s"}`}
          />
          <DetailRow label="Source" value={scheduleSourceLabel} valueClass="text-cyan-300" />
          {assignedTo.length > 0 && (
            <DetailRow label="Assigned" value={assignedTo.join(", ")} valueClass="text-cyan-400" />
          )}
          {project.zuperJobStatus && (
            <DetailRow label="Zuper Status" value={project.zuperJobStatus} valueClass="text-cyan-300" />
          )}
          {(zuperRangeStart || zuperRangeEnd) && (
            <DetailRow
              label="Zuper Span"
              value={
                zuperRangeStart && zuperRangeEnd && zuperRangeEnd !== zuperRangeStart
                  ? `${formatShortDate(zuperRangeStart)} -> ${formatShortDate(zuperRangeEnd)}`
                  : formatShortDate(zuperRangeStart || zuperRangeEnd)
              }
              valueClass="text-cyan-400/90"
            />
          )}
          {project.completionDate && (
            <DetailRow label="Completed" value={formatShortDate(project.completionDate)} valueClass="text-green-400" />
          )}
          {project.closeDate && (
            <DetailRow label="Close Date" value={formatShortDate(project.closeDate)} valueClass="text-muted" />
          )}
        </div>

        <div className="space-y-2">
          {isTentative && onConfirmTentative && onCancelTentative && (
            <div className="flex gap-2">
              <button
                onClick={onConfirmTentative}
                disabled={confirmingTentative}
                className="flex-1 px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {confirmingTentative ? "Confirming..." : "Confirm & Sync"}
              </button>
              <button
                onClick={onCancelTentative}
                disabled={cancellingTentative}
                className="flex-1 px-3 py-1.5 text-xs rounded-md bg-red-600/80 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancellingTentative ? "Cancelling..." : "Cancel Tentative"}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onOpenSchedule}
              className="flex-1 px-3 py-1.5 text-xs rounded-md bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30"
            >
              {scheduledDate ? "Edit Schedule" : "Schedule"}
            </button>
            {scheduledDate && onUnschedule && !isTentative && (
              <button
                onClick={onUnschedule}
                className="flex-1 px-3 py-1.5 text-xs rounded-md bg-red-600/10 border border-red-500/40 text-red-300 hover:bg-red-600/20"
              >
                Remove
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <a
              href={project.hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center px-3 py-1.5 text-xs rounded-md bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/25"
            >
              HubSpot
            </a>
            {project.zuperJobUid && (
              <a
                href={`${zuperWebBaseUrl}/jobs/${project.zuperJobUid}/details`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center px-3 py-1.5 text-xs rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25"
              >
                Zuper
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
