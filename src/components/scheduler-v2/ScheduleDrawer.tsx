"use client";

/**
 * ScheduleDrawer — slide-in panel to assign / reschedule a construction WorkItem
 * to a Resource + date.
 *
 * Write posture (CRITICAL): this is the only v2 component that performs a real
 * write against the production schedule spine. It NEVER fires on open or on drop
 * — a human must click "Confirm & Sync". `testMode` defaults ON (suppresses crew
 * email) while the feature is in beta. The request body is built by the pure
 * `buildScheduleBody()` so create-vs-reschedule + timezone logic is unit-tested.
 *
 * Endpoint: PUT /api/zuper/jobs/schedule (exact body shape copied from the
 * construction-scheduler confirmSchedule contract).
 *
 * Partial-failure handling (spec §7):
 *   - success → success toast
 *   - data.assignmentFailed → warning toast ("scheduled, assignment failed —
 *     reassign in Zuper")
 *   - data.hubspotWarnings → secondary (info) toast
 *   - data.action === "no_job_found" (reschedule path) → explain + offer to
 *     re-submit as a create.
 */

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { getCustomerName } from "@/lib/scheduler-v2/normalize";
import { CONSTRUCTION_DIRECTORS } from "@/lib/scheduler-v2/constants";
import {
  buildScheduleBody,
  resolveTimezone,
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  type ScheduleFormValues,
} from "@/lib/scheduler-v2/buildScheduleBody";
import type { Resource, WorkItem } from "@/lib/scheduler-v2/types";

/** Shape of the schedule endpoint's JSON response (subset we surface). */
interface ScheduleResponse {
  success?: boolean;
  action?: "rescheduled" | "created" | "no_job_found" | "reschedule_failed" | "create_failed";
  assignmentFailed?: boolean;
  assignmentError?: string;
  hubspotWarnings?: string[];
  error?: string;
}

export interface ScheduleWriteResult {
  /** True when the schedule write itself succeeded (job created/rescheduled). */
  ok: boolean;
  action?: ScheduleResponse["action"];
  /** Values actually committed, so callers (undo) can compute the inverse. */
  committed: { date: string; resource: Resource; testMode: boolean };
}

export interface ScheduleDrawerProps {
  open: boolean;
  workItem: WorkItem | null;
  /** The resource the item was dropped onto (or pre-selected). */
  resource: Resource | null;
  /** Target date (YYYY-MM-DD). */
  date: string;
  /** Default testMode for the toggle. Defaults ON. */
  defaultTestMode?: boolean;
  onClose: () => void;
  /** Called after a write whose schedule step succeeded (drives board refetch + undo). */
  onWriteSuccess?: (result: ScheduleWriteResult) => void;
}

/**
 * Enrich the dropped resource with director-team Zuper uids when the resource
 * itself lacks them. The board's Resource usually already carries
 * zuperUserUid/zuperTeamUid (resolved via getTeamUsersByLocation), but pooled or
 * synthetic rows may not — in that case we fall back to the location's
 * CONSTRUCTION_DIRECTORS entry so the write still targets the right team.
 */
function resolveAssignee(resource: Resource, location: string | undefined): Resource {
  if (resource.zuperUserUid || resource.zuperTeamUid) return resource;
  const director = location ? CONSTRUCTION_DIRECTORS[location] : undefined;
  if (!director) return resource;
  return {
    ...resource,
    // keep the resource's own name; borrow the director team for routing
    zuperUserUid: resource.zuperUserUid || director.userUid || undefined,
    zuperTeamUid: resource.zuperTeamUid || director.teamUid || undefined,
  };
}

export function ScheduleDrawer({
  open,
  workItem,
  resource,
  date,
  defaultTestMode = true,
  onClose,
  onWriteSuccess,
}: ScheduleDrawerProps) {
  const { addToast } = useToast();

  const [days, setDays] = useState(1);
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [installerNotes, setInstallerNotes] = useState("");
  const [testMode, setTestMode] = useState(defaultTestMode);
  const [submitting, setSubmitting] = useState(false);
  /** When set, the last reschedule returned no_job_found and we offer a create. */
  const [forceCreate, setForceCreate] = useState(false);

  // Re-prime defaults whenever the target item changes (drawer reused per drop).
  useEffect(() => {
    if (!open || !workItem) return;
    setDays(Math.max(1, Math.floor(workItem.durationDays) || 1));
    setStartTime(DEFAULT_START_TIME);
    setEndTime(DEFAULT_END_TIME);
    setInstallerNotes("");
    setTestMode(defaultTestMode);
    setForceCreate(false);
  }, [open, workItem, defaultTestMode]);

  const enrichedResource = useMemo(
    () => (resource ? resolveAssignee(resource, workItem?.location) : null),
    [resource, workItem?.location],
  );

  const timezone = resolveTimezone(workItem?.location);
  // hasZuperJob false OR forceCreate (after no_job_found) → CREATE path.
  const isReschedule = (workItem?.hasZuperJob !== false) && !forceCreate;

  if (!open || !workItem || !enrichedResource) return null;

  const customer = getCustomerName(workItem.customer);

  async function handleConfirm() {
    if (!workItem || !enrichedResource) return;
    setSubmitting(true);

    const form: ScheduleFormValues = {
      date,
      days,
      startTime,
      endTime,
      installerNotes,
      testMode,
    };
    const body = buildScheduleBody(workItem, enrichedResource, form);
    // Honor a forced create after a no_job_found response.
    if (forceCreate) body.rescheduleOnly = false;

    try {
      const res = await fetch("/api/zuper/jobs/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data: ScheduleResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        addToast({
          type: "error",
          title: `${customer} — schedule failed`,
          message: data.error || `HTTP ${res.status}`,
        });
        setSubmitting(false);
        return;
      }

      // Reschedule path with no existing Zuper job: explain + offer create.
      if (data.action === "no_job_found") {
        setForceCreate(true);
        addToast({
          type: "warning",
          title: `${customer} — no Zuper job to reschedule`,
          message: "No existing Zuper job was found. Confirm again to create one and assign the crew.",
        });
        setSubmitting(false);
        return;
      }

      if (data.action === "reschedule_failed" || data.action === "create_failed") {
        addToast({
          type: "error",
          title: `${customer} — ${data.action.replace("_", " ")}`,
          message: data.error || "The schedule write failed.",
        });
        setSubmitting(false);
        return;
      }

      // Schedule step succeeded (created / rescheduled).
      if (data.assignmentFailed) {
        addToast({
          type: "warning",
          title: `${customer} scheduled — assignment failed`,
          message: "Reassign the crew in Zuper. " + (data.assignmentError || ""),
        });
      } else {
        addToast({
          type: "success",
          title: `${customer} ${data.action === "created" ? "scheduled" : "rescheduled"}`,
          message: testMode ? "Test mode — crew email suppressed." : "Crew notified.",
        });
      }

      if (data.hubspotWarnings && data.hubspotWarnings.length > 0) {
        addToast({
          type: "info",
          title: `${customer} — HubSpot warnings`,
          message: data.hubspotWarnings.join("; "),
        });
      }

      onWriteSuccess?.({
        ok: true,
        action: data.action,
        committed: { date, resource: enrichedResource, testMode },
      });
      onClose();
    } catch (err) {
      addToast({
        type: "error",
        title: `${customer} — schedule error`,
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-t-border bg-surface-elevated shadow-card animate-slideUp">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-t-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{customer}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {workItem.projectNumber && <span className="font-mono">{workItem.projectNumber}</span>}
              <span>{workItem.location}</span>
              <span className="capitalize">{workItem.workType}{workItem.subSystem ? `/${workItem.subSystem}` : ""}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label="Close drawer"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode banner */}
        <div
          className={`mx-4 mt-4 rounded-lg border px-3 py-2 text-xs ${
            isReschedule
              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300"
          }`}
        >
          {isReschedule ? (
            <span>Reschedule mode — updates the existing Zuper job and reconciles crew.</span>
          ) : (
            <span>
              Create mode — no Zuper job exists yet; a new job will be created and the crew assigned at
              creation (the only moment Zuper allows it).
            </span>
          )}
        </div>

        {/* Form */}
        <div className="flex-1 space-y-4 p-4">
          <Field label="Assignee">
            <div className="rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: enrichedResource.color }}
                  aria-hidden
                />
                <span className="font-medium">{enrichedResource.name}</span>
              </div>
              {!enrichedResource.zuperUserUid && (
                <p className="mt-1 text-[0.65rem] text-amber-400">
                  No Zuper user uid — the endpoint will resolve the assignee by name at runtime.
                </p>
              )}
            </div>
          </Field>

          <Field label="Date">
            <div className="rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground">
              {date} <span className="ml-1 text-[0.65rem] text-muted">({timezone})</span>
            </div>
          </Field>

          <Field label="Install days">
            <input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </Field>

          <div className="flex gap-3">
            <Field label="Start">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </Field>
            <Field label="End">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </Field>
          </div>

          <Field label="Installer notes">
            <textarea
              value={installerNotes}
              onChange={(e) => setInstallerNotes(e.target.value)}
              rows={3}
              placeholder="Notes for the crew (optional)"
              className="w-full resize-y rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </Field>

          {/* Test mode toggle */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-t-border bg-surface-2/60 p-3">
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              className="mt-0.5 accent-blue-500"
            />
            <span className="text-xs">
              <span className="font-medium text-foreground">Test mode</span>
              <span className="block text-muted">
                Suppresses the crew email. Keep ON during beta unless you intend to notify the crew.
              </span>
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-t-border bg-surface-elevated p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-t-border bg-surface-2 px-4 py-2 text-sm text-foreground hover:brightness-110 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting
              ? "Syncing…"
              : forceCreate
                ? "Confirm & Create"
                : isReschedule
                  ? "Confirm & Reschedule"
                  : "Confirm & Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
