"use client";

import { useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import type { IdrItem } from "./IdrMeetingClient";
import { InstallPlanningForm } from "./InstallPlanningForm";
import { MeetingNotesForm } from "./MeetingNotesForm";
import { NoteHistory } from "./NoteHistory";

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "7086286";

interface Props {
  item: IdrItem | null;
  onChange: (itemId: string, updates: Partial<IdrItem>) => Promise<void>;
  readOnly: boolean;
  sessionId: string | null;
  userEmail: string;
}

interface ReadinessCheck {
  label: string;
  status: "pass" | "fail" | "warn" | "info";
  message?: string;
}

interface ReadinessReport {
  checks: ReadinessCheck[];
  score?: number;
}

const STATUS_EMOJI: Record<string, string> = {
  pass: "\u2705",
  fail: "\u274C",
  warn: "\u26A0\uFE0F",
  info: "\u2139\uFE0F",
};

export function ProjectDetail({ item, onChange, readOnly, sessionId, userEmail }: Props) {
  const { addToast } = useToast();

  // Readiness query — lazy-loaded per item
  const readinessQuery = useQuery({
    queryKey: queryKeys.idrMeeting.readiness(item?.id ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/items/${item!.id}/readiness`);
      if (!res.ok) throw new Error("Readiness check failed");
      return res.json() as Promise<ReadinessReport>;
    },
    enabled: !!item,
    staleTime: 5 * 60 * 1000,
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item selected");
      const res = await fetch(`/api/idr-meeting/items/${item.id}/sync`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Sync failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      addToast({
        type: "success",
        title: "Synced to HubSpot",
        message: data.noteWarning ?? undefined,
      });
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
        <p className="text-sm text-muted">Select a project from the queue to begin review.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-xl border border-t-border bg-surface overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Deal Info */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Deal Info
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <InfoCell label="Name" value={item.dealName} />
            <InfoCell label="Type" value={item.projectType} />
            <InfoCell label="System Size" value={item.systemSizeKw ? `${item.systemSizeKw} kW` : null} />
            <InfoCell label="AHJ" value={item.ahj} />
            <InfoCell label="Utility" value={item.utilityCompany} />
            <InfoCell label="Survey Date" value={item.surveyDate} />
            <InfoCell label="Design Status" value={item.designStatus} />
            <InfoCell label="Planset Date" value={item.plansetDate} />
            {item.equipmentSummary && (
              <div className="col-span-2">
                <InfoCell label="Equipment" value={item.equipmentSummary} />
              </div>
            )}
          </div>
        </section>

        {/* Quick Links */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Quick Links
          </h2>
          <div className="flex flex-wrap gap-2">
            {item.designFolderUrl && (
              <QuickLink href={item.designFolderUrl} label="Design Folder" />
            )}
            {item.surveyFolderUrl && (
              <QuickLink href={item.surveyFolderUrl} label="Survey Folder" />
            )}
            <QuickLink
              href={`https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${item.dealId}`}
              label="HubSpot Deal"
            />
            {item.openSolarUrl && (
              <QuickLink href={item.openSolarUrl} label="OpenSolar" />
            )}
            {item.driveFolderUrl && (
              <QuickLink href={item.driveFolderUrl} label="Drive Folder" />
            )}
          </div>
        </section>

        {/* Survey Readiness */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Survey Readiness
          </h2>
          {readinessQuery.isLoading && (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-6 rounded bg-surface-2 animate-pulse" />
              ))}
            </div>
          )}
          {readinessQuery.error && (
            <p className="text-sm text-red-500">Failed to load readiness checks.</p>
          )}
          {readinessQuery.data && (
            <div className="space-y-1.5">
              {readinessQuery.data.checks.map((check, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0">{STATUS_EMOJI[check.status] ?? STATUS_EMOJI.info}</span>
                  <div>
                    <span className="font-medium text-foreground">{check.label}</span>
                    {check.message && (
                      <span className="text-muted ml-1">-- {check.message}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Install Planning */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Install Planning
          </h2>
          <InstallPlanningForm item={item} onChange={handleFieldChange} readOnly={readOnly} />
        </section>

        {/* Meeting Notes */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Meeting Notes
          </h2>
          <MeetingNotesForm item={item} onChange={handleFieldChange} readOnly={readOnly} />
        </section>

        {/* History */}
        <NoteHistory item={item} userEmail={userEmail} />

        {/* Save & Sync */}
        {!readOnly && (
          <div className="flex justify-end pt-2 border-t border-t-border">
            <button
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? "Syncing..." : "Save & Sync to HubSpot"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-medium text-foreground truncate">{value || "--"}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-lg border border-t-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface transition-colors"
    >
      {label}
      <span className="text-muted">&#8599;</span>
    </a>
  );
}
