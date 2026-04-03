"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import type { IdrItem } from "./IdrMeetingClient";
import { InstallPlanningForm } from "./InstallPlanningForm";
import { StatusActionsForm } from "./StatusActionsForm";
import { MeetingNotesForm } from "./MeetingNotesForm";

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "7086286";

interface Props {
  item: IdrItem | null;
  onChange: (itemId: string, updates: Partial<IdrItem>) => Promise<void>;
  readOnly: boolean;
  isPreview: boolean;
  sessionId: string | null;
  userEmail: string;
  onSkipItem?: () => void;
  skipping?: boolean;
}

interface ReadinessChecklistItem {
  item: string;
  status: "pass" | "missing" | "not_found" | "na" | "unable_to_verify";
  severity: "error" | "warning" | "info";
  count: number;
  note: string;
}

interface ReadinessReport {
  checklist: ReadinessChecklistItem[];
  readyForIDR: boolean;
  totalFiles: number;
}

const STATUS_EMOJI: Record<string, string> = {
  pass: "\u2705",
  missing: "\u274C",
  not_found: "\u274C",
  na: "\u2796",
  unable_to_verify: "\u26A0\uFE0F",
};

export function ProjectDetail({ item, onChange, readOnly, isPreview, sessionId, userEmail, onSkipItem, skipping }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const lineItemsQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.root, "lineItems", item?.dealId ?? ""],
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/line-items/${item!.dealId}`);
      if (!res.ok) throw new Error("Failed to fetch line items");
      return res.json() as Promise<{ lineItems: Array<{ name: string; quantity: number; manufacturer: string; productCategory: string }> }>;
    },
    enabled: !!item,
    staleTime: 5 * 60 * 1000,
  });

  const readinessQuery = useQuery({
    queryKey: queryKeys.idrMeeting.readiness(item?.id ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/items/${item!.id}/readiness`);
      if (!res.ok) throw new Error("Readiness check failed");
      return res.json() as Promise<ReadinessReport>;
    },
    // Only fetch readiness for session items (not preview)
    enabled: !!item && !isPreview,
    staleTime: 5 * 60 * 1000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item selected");
      const res = await fetch(`/api/idr-meeting/items/${item.id}/sync`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? body.error ?? "Sync failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      addToast({
        type: "success",
        title: "Synced to HubSpot",
        message: data.noteWarning ?? undefined,
      });
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
      }
    },
    onError: (err: Error) => {
      addToast({ type: "error", title: "Sync failed", message: err.message });
    },
  });

  const handleFieldChange = useCallback(
    (updates: Partial<IdrItem>) => {
      if (!item) return;
      onChange(item.id, updates);
    },
    [item, onChange],
  );

  if (!item) {
    return (
      <div className="flex-1 rounded-xl border border-t-border bg-surface flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted">Select a project to begin.</p>
          {isPreview && (
            <p className="text-xs text-muted mt-1">
              Edits here are saved as prep and carry into the next meeting.
            </p>
          )}
        </div>
      </div>
    );
  }

  const amountStr = item.dealAmount
    ? `$${item.dealAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : null;

  const canSync = !isPreview && !readOnly;

  return (
    <div className="flex-1 rounded-xl border border-t-border bg-surface overflow-y-auto">
      <div className="p-4 space-y-3">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground truncate">{item.dealName}</h2>
              {item.type === "ESCALATION" && (
                <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shrink-0">
                  ESCALATION
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
              {item.address && <span className="text-xs text-muted truncate">{item.address}</span>}
              {item.projectType && <span className="text-xs text-muted">{item.projectType}</span>}
            </div>
            {item.escalationReason && (
              <p className="text-xs text-orange-500 mt-1">
                <span className="font-medium">Reason:</span> {item.escalationReason}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Mark as reviewed */}
            {!readOnly && !isPreview && (
              <button
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  item.reviewed
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-500"
                    : "border-t-border bg-surface-2 text-muted hover:text-foreground"
                }`}
                onClick={() => handleFieldChange({ reviewed: !item.reviewed } as Partial<IdrItem>)}
                title={item.reviewed ? "Mark as not reviewed" : "Mark as reviewed"}
              >
                {item.reviewed ? "✓ Reviewed" : "Mark Reviewed"}
              </button>
            )}
            {/* Skip / push to next meeting */}
            {onSkipItem && (
              <button
                className="rounded-lg border border-t-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
                onClick={onSkipItem}
                disabled={skipping}
                title="Remove from this meeting, will appear in next one"
              >
                {skipping ? "Skipping..." : "Skip \u2192"}
              </button>
            )}
            {canSync && (
              <button
                className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                {syncMutation.isPending ? "Syncing..." : "Sync to HubSpot"}
              </button>
            )}
          </div>
        </div>

        {/* ── Quick links ── */}
        <div className="flex flex-wrap gap-1.5">
          <QuickLink
            href={`https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${item.dealId}`}
            label="HubSpot"
          />
          {item.designFolderUrl && <QuickLink href={item.designFolderUrl} label="Design" />}
          {item.surveyFolderUrl && <QuickLink href={item.surveyFolderUrl} label="Survey" />}
          {item.openSolarUrl && <QuickLink href={item.openSolarUrl} label="OpenSolar" />}
          {item.driveFolderUrl && <QuickLink href={item.driveFolderUrl} label="Drive" />}
        </div>

        {/* ── Two-column body ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* LEFT: Deal info + readiness */}
          <div className="space-y-3">
            <Section title="Deal Details">
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                <InfoCell label="System Size" value={item.systemSizeKw ? `${item.systemSizeKw} kW` : null} />
                <InfoCell label="Amount" value={amountStr} />
                <InfoCell label="Design Status" value={item.designStatus} />
                <InfoCell label="AHJ" value={item.ahj} />
                <InfoCell label="Utility" value={item.utilityCompany} />
                <InfoCell label="Survey Date" value={item.surveyDate} />
                <InfoCell label="Deal Owner" value={item.dealOwner} />
                <InfoCell label="Surveyor" value={item.siteSurveyor} />
                <InfoCell label="Project Mgr" value={item.projectManager} />
                <InfoCell label="Ops Mgr" value={item.operationsManager} />
              </div>
            </Section>

            <Section title="Equipment">
              {lineItemsQuery.isLoading && (
                <div className="h-5 w-48 rounded bg-surface-2 animate-pulse" />
              )}
              {lineItemsQuery.data && lineItemsQuery.data.lineItems.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {lineItemsQuery.data.lineItems.map((li, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded bg-surface-2 px-1.5 py-0.5 text-xs text-foreground"
                    >
                      {li.name}{li.quantity > 1 ? ` x${li.quantity}` : ""}
                    </span>
                  ))}
                </div>
              ) : lineItemsQuery.data ? (
                <p className="text-xs text-muted">No line items</p>
              ) : null}
            </Section>

            {/* Survey Readiness — only in session mode */}
            {!isPreview && readinessQuery.data && (
              <Section title="Survey Readiness">
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {readinessQuery.data.checklist.map((check, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <span className="shrink-0 text-[11px]">{STATUS_EMOJI[check.status] ?? "\u2139\uFE0F"}</span>
                      <span className="font-medium text-foreground truncate">{check.item}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          {/* RIGHT: Planning + actions + notes */}
          <div className="space-y-3">
            <Section title="Install Planning">
              <InstallPlanningForm item={item} onChange={handleFieldChange} readOnly={readOnly} />
            </Section>

            <Section title="DA Status Actions">
              <StatusActionsForm item={item} onChange={handleFieldChange} readOnly={readOnly} />
            </Section>

            <Section title="Meeting Notes">
              <MeetingNotesForm item={item} onChange={handleFieldChange} readOnly={readOnly} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted leading-tight">{label}</p>
      <p className="text-xs font-medium text-foreground truncate leading-snug">{value || "--"}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 rounded border border-t-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-surface transition-colors"
    >
      {label}
      <span className="text-muted">&#8599;</span>
    </a>
  );
}
