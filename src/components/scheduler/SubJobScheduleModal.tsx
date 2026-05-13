"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { SYSTEM_TAGS, SYSTEM_TAG_CLASSES } from "@/lib/scheduler-subjobs";
import type { SystemType } from "@/lib/zuper-construction";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PerSubJobSchedule = {
  jobUid: string;
  systemType: SystemType;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  installDays: number;
  assigneeNames: string[];
  notes: string;
};

type CrewOption = { name: string; uid?: string };

/** Project context displayed above the scheduling controls — mirrors the regular schedule modal. */
export type SubJobProjectContext = {
  id: string;
  name: string;
  address: string;
  location: string;
  type: string;
  amount: number;
  stage: string;
  hubspotUrl: string;
  zuperJobUid?: string;
  zuperJobStatus?: string;
  zuperWebBaseUrl?: string;
  /** Zuper project UID — reserved for future project-level linking */
  zuperProjectUid?: string;
  // Equipment
  systemSize: number;
  moduleCount: number;
  moduleBrand: string;
  moduleModel: string;
  moduleWattage: number;
  inverterCount: number;
  inverterBrand: string;
  inverterModel: string;
  inverterSizeKwac: number;
  batteries: number;
  batteryModel: string | null;
  batterySizeKwh: number;
  batteryExpansion: number;
  evCount: number;
  // Install requirements
  daysInstall: number;
  daysElec: number;
  totalDays: number;
  roofersCount: number;
  electriciansCount: number;
  difficulty: number;
  installNotes: string;
};

type SubJobScheduleModalProps = {
  subJobs: SubJobInfo[];
  projectName: string;
  projectContext?: SubJobProjectContext;
  availableCrew: CrewOption[];
  defaultDate?: string;
  defaultInstallDays?: number;
  zuperConfigured?: boolean;
  syncToZuper?: boolean;
  onSyncToZuperChange?: (value: boolean) => void;
  internalDealUrl?: string;
  onSubmit: (schedules: PerSubJobSchedule[]) => Promise<void>;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Display name map
// ---------------------------------------------------------------------------

const SYSTEM_DISPLAY_NAMES: Record<SystemType, string> = {
  solar: "Solar",
  battery: "Battery",
  ev: "EV Charger",
  legacy: "Construction",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateInput(isoOrCustom?: string): string {
  if (!isoOrCustom) return "";
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrCustom)) return isoOrCustom;
  // ISO or Zuper timestamp — extract date portion
  const d = new Date(isoOrCustom);
  if (!Number.isFinite(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function computeEndDate(startDate: string, installDays: number): string {
  if (!startDate || installDays < 1) return startDate || "";
  const d = new Date(startDate + "T00:00:00");
  if (!Number.isFinite(d.getTime())) return startDate;
  d.setDate(d.getDate() + Math.max(installDays - 1, 0));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function initPerJobState(
  subJobs: SubJobInfo[],
  defaultDate?: string,
  defaultInstallDays?: number,
): Map<string, PerSubJobSchedule> {
  const map = new Map<string, PerSubJobSchedule>();
  const fallbackDate = defaultDate ? formatDateInput(defaultDate) : "";
  const fallbackDays = defaultInstallDays ?? 1;

  for (const sj of subJobs) {
    const startDate = formatDateInput(sj.scheduledDate) || fallbackDate;
    const days = sj.scheduledDays ?? fallbackDays;
    map.set(sj.jobUid, {
      jobUid: sj.jobUid,
      systemType: sj.systemType,
      startDate,
      endDate: computeEndDate(startDate, days),
      installDays: days,
      assigneeNames: sj.assignedTo ?? [],
      notes: "",
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValid(schedules: PerSubJobSchedule[], requireAssignees: boolean): boolean {
  return schedules.every(
    (s) => s.startDate !== "" && (!requireAssignees || s.assigneeNames.length > 0),
  );
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "---";
  const d = new Date(dateStr + "T00:00:00");
  if (!Number.isFinite(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubJobScheduleModal({
  subJobs,
  projectName,
  projectContext,
  availableCrew,
  defaultDate,
  defaultInstallDays,
  zuperConfigured,
  syncToZuper,
  onSyncToZuperChange,
  internalDealUrl,
  onSubmit,
  onClose,
}: SubJobScheduleModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"same" | "separate">("same");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // ── Shared state (same-for-all mode) ──────────────────────────────────
  const firstJob = subJobs[0];
  const [sharedDate, setSharedDate] = useState(() =>
    formatDateInput(firstJob?.scheduledDate) || (defaultDate ? formatDateInput(defaultDate) : ""),
  );
  const [sharedDays, setSharedDays] = useState(() => firstJob?.scheduledDays ?? defaultInstallDays ?? 1);
  const [sharedCrew, setSharedCrew] = useState<string[]>(() => firstJob?.assignedTo ?? []);
  const [sharedNotes, setSharedNotes] = useState("");

  // ── Per-job state (separate mode) ─────────────────────────────────────
  const [perJob, setPerJob] = useState<Map<string, PerSubJobSchedule>>(() =>
    initPerJobState(subJobs, defaultDate, defaultInstallDays),
  );

  // ── Mode toggle ───────────────────────────────────────────────────────
  const toggleMode = useCallback(() => {
    if (mode === "same") {
      // Copy shared values into every row
      setPerJob((prev) => {
        const next = new Map(prev);
        for (const [uid, row] of next) {
          next.set(uid, {
            ...row,
            startDate: sharedDate,
            endDate: computeEndDate(sharedDate, sharedDays),
            installDays: sharedDays,
            assigneeNames: [...sharedCrew],
            notes: sharedNotes,
          });
        }
        return next;
      });
      setMode("separate");
    } else {
      // Discard per-row overrides, revert to shared
      setMode("same");
    }
  }, [mode, sharedDate, sharedDays, sharedCrew, sharedNotes]);

  // ── Build final schedules array ───────────────────────────────────────
  const buildSchedules = useCallback((): PerSubJobSchedule[] => {
    if (mode === "same") {
      return subJobs.map((sj) => ({
        jobUid: sj.jobUid,
        systemType: sj.systemType,
        startDate: sharedDate,
        endDate: computeEndDate(sharedDate, sharedDays),
        installDays: sharedDays,
        assigneeNames: [...sharedCrew],
        notes: sharedNotes,
      }));
    }
    return subJobs.map((sj) => perJob.get(sj.jobUid)!);
  }, [mode, subJobs, sharedDate, sharedDays, sharedCrew, sharedNotes, perJob]);

  const schedules = useMemo(() => buildSchedules(), [buildSchedules]);
  const canSubmit = isValid(schedules, syncToZuper ?? true);

  // ── Per-job field updater ─────────────────────────────────────────────
  const updatePerJob = useCallback(
    (uid: string, patch: Partial<PerSubJobSchedule>) => {
      setPerJob((prev) => {
        const next = new Map(prev);
        const row = next.get(uid);
        if (!row) return prev;
        const updated = { ...row, ...patch };
        // Recompute end date when start or days change
        if ("startDate" in patch || "installDays" in patch) {
          updated.endDate = computeEndDate(updated.startDate, updated.installDays);
        }
        next.set(uid, updated);
        return next;
      });
    },
    [],
  );

  // ── Keyboard: Escape closes ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showConfirm) setShowConfirm(false);
        else onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, showConfirm]);

  // ── Submit flow ───────────────────────────────────────────────────────
  const handleSubmitClick = () => setShowConfirm(true);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onSubmit(schedules);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Crew toggle helper ────────────────────────────────────────────────
  const toggleCrewMember = (
    current: string[],
    name: string,
    setter: (next: string[]) => void,
  ) => {
    if (current.includes(name)) {
      setter(current.filter((n) => n !== name));
    } else {
      setter([...current, name]);
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subjob-schedule-title"
        className="bg-surface-elevated border border-t-border rounded-xl shadow-card-lg w-full max-w-2xl animate-fadeIn flex flex-col"
        style={{ maxHeight: "85vh" }}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-t-border flex items-center justify-between shrink-0">
          <h2 id="subjob-schedule-title" className="text-base font-semibold text-foreground">
            Schedule Construction &mdash; {projectName}
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-muted hover:text-foreground transition-colors p-1 -mr-1"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Body (scrollable) ───────────────────────────────────────── */}
        <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0">
          {/* ── Project context sections (matches regular schedule modal) ── */}
          {projectContext && (
            <div className="mb-4 space-y-3">
              {/* Project Info */}
              <ContextSection title="Project">
                <ContextRow label="Customer" value={projectName} />
                <ContextRow label="Address" value={projectContext.address} />
                <ContextRow label="Location" value={projectContext.location} />
                <ContextRow
                  label="Type"
                  value={(projectContext.type || "Service").split(";").filter(t => t.trim()).join(", ")}
                />
                <ContextRow
                  label="Amount"
                  value={`$${projectContext.amount.toLocaleString()}`}
                  valueClass="text-orange-400 font-semibold"
                />
                <ContextRow
                  label="Stage"
                  value={
                    projectContext.stage === "rtb" ? "RTB Ready"
                      : projectContext.stage === "blocked" ? "Blocked"
                      : projectContext.stage === "construction" ? "Construction"
                      : projectContext.stage
                  }
                  valueClass={
                    projectContext.stage === "rtb" ? "text-emerald-400"
                      : projectContext.stage === "blocked" ? "text-red-400"
                      : projectContext.stage === "construction" ? "text-blue-400"
                      : ""
                  }
                />
                {projectContext.zuperJobStatus && (
                  <ContextRow
                    label="Job Status"
                    value={projectContext.zuperJobStatus.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    valueClass={
                      projectContext.zuperJobStatus.toLowerCase().includes("complete") ? "text-emerald-400"
                        : projectContext.zuperJobStatus.toLowerCase().includes("progress") || projectContext.zuperJobStatus.toLowerCase().includes("started") ? "text-yellow-400"
                        : projectContext.zuperJobStatus.toLowerCase().includes("scheduled") ? "text-blue-400"
                        : "text-muted"
                    }
                  />
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[0.7rem] text-muted w-20">Links</span>
                  <div className="flex items-center gap-2">
                    {internalDealUrl && (
                      <>
                        <a href={internalDealUrl} className="text-[0.7rem] text-purple-400 hover:text-purple-300">Deal</a>
                        <span className="text-muted/70">|</span>
                      </>
                    )}
                    <a
                      href={projectContext.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[0.7rem] text-orange-400 hover:text-orange-300"
                    >
                      HubSpot
                    </a>
                    {projectContext.zuperWebBaseUrl && subJobs.length > 0 && subJobs.some((sj) => sj.jobUid) && (
                      <>
                        {subJobs.filter((sj) => sj.jobUid).map((sj, idx) => (
                          <span key={sj.jobUid} className="contents">
                            {(idx === 0 || idx > 0) && <span className="text-muted/70">|</span>}
                            <a
                              href={`${projectContext.zuperWebBaseUrl}/jobs/${sj.jobUid}/details`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-[0.7rem] hover:opacity-80 ${
                                sj.systemType === "solar" ? "text-amber-400"
                                  : sj.systemType === "battery" ? "text-emerald-400"
                                  : sj.systemType === "ev" ? "text-cyan-400"
                                  : "text-cyan-400"
                              }`}
                            >
                              {SYSTEM_TAGS[sj.systemType] || "Zuper"}
                            </a>
                          </span>
                        ))}
                      </>
                    )}
                    {/* Fallback: single Zuper link when no sub-jobs but a job UID exists */}
                    {projectContext.zuperJobUid && projectContext.zuperWebBaseUrl && subJobs.length === 0 && (
                      <>
                        <span className="text-muted/70">|</span>
                        <a
                          href={`${projectContext.zuperWebBaseUrl}/jobs/${projectContext.zuperJobUid}/details`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.7rem] text-cyan-400 hover:text-cyan-300"
                        >
                          Zuper
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </ContextSection>

              {/* Equipment */}
              <ContextSection title="Equipment">
                {projectContext.systemSize > 0 && (
                  <ContextRow label="System Size" value={`${projectContext.systemSize.toFixed(1)} kW`} />
                )}
                {projectContext.moduleCount > 0 && (
                  <ContextRow
                    label="Modules"
                    value={
                      projectContext.moduleBrand
                        ? `${projectContext.moduleCount}x ${projectContext.moduleBrand} ${projectContext.moduleModel}${projectContext.moduleWattage > 0 ? ` (${projectContext.moduleWattage}W)` : ""}`
                        : `${projectContext.moduleCount} panels`
                    }
                  />
                )}
                {projectContext.inverterCount > 0 && (
                  <ContextRow
                    label="Inverters"
                    value={
                      projectContext.inverterBrand
                        ? `${projectContext.inverterCount}x ${projectContext.inverterBrand} ${projectContext.inverterModel}${projectContext.inverterSizeKwac > 0 ? ` (${projectContext.inverterSizeKwac} kWac)` : ""}`
                        : `${projectContext.inverterCount}`
                    }
                  />
                )}
                {projectContext.batteries > 0 && (
                  <ContextRow
                    label="Batteries"
                    value={`${projectContext.batteries}x ${projectContext.batteryModel || "Tesla"}${projectContext.batterySizeKwh > 0 ? ` ${projectContext.batterySizeKwh} kWh` : ""}${projectContext.batteryExpansion ? ` + ${projectContext.batteryExpansion} expansion` : ""}`}
                  />
                )}
                {projectContext.evCount > 0 && (
                  <ContextRow label="EV Chargers" value={`${projectContext.evCount}`} />
                )}
              </ContextSection>

              {/* Install Requirements */}
              <ContextSection title="Install Requirements">
                {projectContext.daysInstall > 0 && (
                  <ContextRow label="Installer Days" value={`${projectContext.daysInstall}d`} />
                )}
                {projectContext.daysElec > 0 && (
                  <ContextRow label="Electrician Days" value={`${projectContext.daysElec}d`} />
                )}
                {!projectContext.daysInstall && !projectContext.daysElec && projectContext.totalDays > 0 && (
                  <ContextRow label="Total Days" value={`${projectContext.totalDays}d`} />
                )}
                {projectContext.roofersCount > 0 && (
                  <ContextRow label="Installers Needed" value={`${projectContext.roofersCount}`} />
                )}
                {projectContext.electriciansCount > 0 && (
                  <ContextRow label="Electricians Needed" value={`${projectContext.electriciansCount}`} />
                )}
                {projectContext.difficulty > 0 && (
                  <ContextRow label="Difficulty" value={`${"*".repeat(projectContext.difficulty)} (${projectContext.difficulty}/5)`} />
                )}
                {projectContext.installNotes && (
                  <ContextRow label="Notes" value={projectContext.installNotes} />
                )}
              </ContextSection>
            </div>
          )}

          {/* Toggle link */}
          <button
            onClick={toggleMode}
            disabled={submitting}
            className="text-xs text-orange-400 hover:text-orange-300 transition-colors mb-4 font-medium"
          >
            {mode === "same" ? "Schedule separately ▸" : "◂ Same for all"}
          </button>

          {mode === "same" ? (
            <SameForAllControls
              date={sharedDate}
              days={sharedDays}
              crew={sharedCrew}
              notes={sharedNotes}
              availableCrew={availableCrew}
              disabled={submitting}
              onDateChange={setSharedDate}
              onDaysChange={setSharedDays}
              onCrewToggle={(name) => toggleCrewMember(sharedCrew, name, setSharedCrew)}
              onNotesChange={setSharedNotes}
              subJobs={subJobs}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {subJobs.map((sj) => {
                const row = perJob.get(sj.jobUid)!;
                return (
                  <SeparateJobCard
                    key={sj.jobUid}
                    subJob={sj}
                    schedule={row}
                    availableCrew={availableCrew}
                    disabled={submitting}
                    onUpdate={(patch) => updatePerJob(sj.jobUid, patch)}
                    onCrewToggle={(name) =>
                      updatePerJob(sj.jobUid, {
                        assigneeNames: row.assigneeNames.includes(name)
                          ? row.assigneeNames.filter((n) => n !== name)
                          : [...row.assigneeNames, name],
                      })
                    }
                  />
                );
              })}
            </div>
          )}

          {/* Zuper Integration */}
          {zuperConfigured && (
            <div className="mt-4 pt-3 border-t border-t-border">
              <ContextSection title="Zuper Integration">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="subjob-syncZuper"
                    checked={syncToZuper ?? true}
                    onChange={(e) => onSyncToZuperChange?.(e.target.checked)}
                    disabled={submitting}
                    className="w-4 h-4 accent-orange-500"
                  />
                  <label htmlFor="subjob-syncZuper" className="text-[0.7rem] text-foreground/80 cursor-pointer">
                    Sync schedule to Zuper
                  </label>
                </div>
                <div className={`text-[0.6rem] mt-1 ${syncToZuper ? "text-cyan-400" : "text-amber-400"}`}>
                  {syncToZuper
                    ? "Mode: live sync (writes to Zuper now)."
                    : "Mode: tentative only (does not sync until confirmed)."}
                </div>
                <div className="text-[0.6rem] text-muted mt-1">
                  Updates existing Construction sub-jobs in Zuper (or creates them if none exist)
                </div>
                {syncToZuper && (
                  <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[0.6rem] text-amber-400">
                    ⚠️ <strong>Customer will receive EMAIL + SMS notification</strong> with their scheduled appointment
                  </div>
                )}
              </ContextSection>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-t border-t-border flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg border border-t-border text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmitClick}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 text-sm rounded-lg font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Schedule
          </button>
        </div>
      </div>

      {/* ── Confirmation overlay ──────────────────────────────────────── */}
      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && !submitting && setShowConfirm(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="subjob-confirm-title"
            className="bg-surface-elevated border border-t-border rounded-xl shadow-card-lg w-full max-w-lg animate-fadeIn"
          >
            <div className="px-5 py-4 border-b border-t-border">
              <h3 id="subjob-confirm-title" className="text-base font-semibold text-foreground">
                Confirm Schedule
              </h3>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
              {schedules.map((s) => (
                <div
                  key={s.jobUid}
                  className="flex items-start gap-3 text-sm border border-t-border rounded-lg p-3 bg-surface"
                >
                  <span
                    className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide min-w-[2.5rem] shrink-0 ${
                      SYSTEM_TAG_CLASSES[s.systemType]
                    }`}
                  >
                    {SYSTEM_TAGS[s.systemType]}
                  </span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-foreground font-medium">
                      {SYSTEM_DISPLAY_NAMES[s.systemType]}
                    </span>
                    <span className="text-muted text-xs">
                      {formatDisplayDate(s.startDate)}
                      {s.installDays > 1 && ` – ${formatDisplayDate(s.endDate)}`}
                      {" "}&middot; {s.installDays} day{s.installDays !== 1 ? "s" : ""}
                    </span>
                    <span className="text-muted text-xs truncate">
                      Crew: {s.assigneeNames.join(", ")}
                    </span>
                    {s.notes && (
                      <span className="text-muted text-xs italic truncate">
                        {s.notes}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-t-border flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg border border-t-border text-foreground hover:bg-surface-2 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Scheduling..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Same for all" controls
// ---------------------------------------------------------------------------

function SameForAllControls({
  date,
  days,
  crew,
  notes,
  availableCrew,
  disabled,
  onDateChange,
  onDaysChange,
  onCrewToggle,
  onNotesChange,
  subJobs,
}: {
  date: string;
  days: number;
  crew: string[];
  notes: string;
  availableCrew: CrewOption[];
  disabled: boolean;
  onDateChange: (v: string) => void;
  onDaysChange: (v: number) => void;
  onCrewToggle: (name: string) => void;
  onNotesChange: (v: string) => void;
  subJobs: SubJobInfo[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <ScheduleFields
        date={date}
        days={days}
        crew={crew}
        notes={notes}
        availableCrew={availableCrew}
        disabled={disabled}
        onDateChange={onDateChange}
        onDaysChange={onDaysChange}
        onCrewToggle={onCrewToggle}
        onNotesChange={onNotesChange}
      />

      {/* Sub-job chips */}
      <div className="pt-2 border-t border-t-border">
        <p className="text-xs text-muted mb-2">Applies to all sub-jobs:</p>
        <div className="flex flex-wrap gap-2">
          {subJobs.map((sj) => (
            <span
              key={sj.jobUid}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                SYSTEM_TAG_CLASSES[sj.systemType]
              }`}
            >
              <span className="font-semibold text-[0.65rem] tracking-wide">
                {SYSTEM_TAGS[sj.systemType]}
              </span>
              {SYSTEM_DISPLAY_NAMES[sj.systemType]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Separate-mode card
// ---------------------------------------------------------------------------

function SeparateJobCard({
  subJob,
  schedule,
  availableCrew,
  disabled,
  onUpdate,
  onCrewToggle,
}: {
  subJob: SubJobInfo;
  schedule: PerSubJobSchedule;
  availableCrew: CrewOption[];
  disabled: boolean;
  onUpdate: (patch: Partial<PerSubJobSchedule>) => void;
  onCrewToggle: (name: string) => void;
}) {
  return (
    <div className="border border-t-border rounded-lg bg-surface p-4">
      {/* Card header with system tag */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide min-w-[2.5rem] ${
            SYSTEM_TAG_CLASSES[subJob.systemType]
          }`}
        >
          {SYSTEM_TAGS[subJob.systemType]}
        </span>
        <span className="text-sm font-medium text-foreground">
          {SYSTEM_DISPLAY_NAMES[subJob.systemType]}
        </span>
      </div>

      <ScheduleFields
        date={schedule.startDate}
        days={schedule.installDays}
        crew={schedule.assigneeNames}
        notes={schedule.notes}
        availableCrew={availableCrew}
        disabled={disabled}
        onDateChange={(v) => onUpdate({ startDate: v })}
        onDaysChange={(v) => onUpdate({ installDays: v })}
        onCrewToggle={onCrewToggle}
        onNotesChange={(v) => onUpdate({ notes: v })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared schedule field group
// ---------------------------------------------------------------------------

function ScheduleFields({
  date,
  days,
  crew,
  notes,
  availableCrew,
  disabled,
  onDateChange,
  onDaysChange,
  onCrewToggle,
  onNotesChange,
}: {
  date: string;
  days: number;
  crew: string[];
  notes: string;
  availableCrew: CrewOption[];
  disabled: boolean;
  onDateChange: (v: string) => void;
  onDaysChange: (v: number) => void;
  onCrewToggle: (name: string) => void;
  onNotesChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Date + Days row */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted font-medium">Start Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            disabled={disabled}
            className="px-3 py-2 text-sm rounded-lg border border-t-border bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted font-medium">Install Days</span>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => onDaysChange(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            disabled={disabled}
            className="px-3 py-2 text-sm rounded-lg border border-t-border bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:opacity-50"
          />
        </label>
      </div>

      {/* End date hint */}
      {date && days > 1 && (
        <p className="text-xs text-muted -mt-1">
          Ends {formatDisplayDate(computeEndDate(date, days))}
        </p>
      )}

      {/* Crew checkboxes */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted font-medium">Crew</span>
        <div className="flex flex-wrap gap-2">
          {availableCrew.map((c) => {
            const selected = crew.includes(c.name);
            return (
              <label
                key={c.name}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors select-none ${
                  selected
                    ? "border-orange-500/50 bg-orange-500/10 text-orange-300"
                    : "border-t-border bg-surface text-muted hover:text-foreground hover:border-foreground/20"
                } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onCrewToggle(c.name)}
                  disabled={disabled}
                  className="sr-only"
                />
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                    selected
                      ? "bg-orange-500 border-orange-500"
                      : "border-t-border bg-surface-2"
                  }`}
                >
                  {selected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {c.name}
              </label>
            );
          })}
          {availableCrew.length === 0 && (
            <span className="text-xs text-muted italic">No crew members available</span>
          )}
        </div>
      </div>

      {/* Notes */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted font-medium">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder="Optional scheduling notes..."
          className="px-3 py-2 text-sm rounded-lg border border-t-border bg-surface text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none disabled:opacity-50"
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context display helpers (mirrors ModalSection / ModalRow from scheduler)
// ---------------------------------------------------------------------------

function ContextSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[0.65rem] text-muted uppercase mb-1 font-semibold">
        {title}
      </div>
      {children}
    </div>
  );
}

function ContextRow({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between py-1 border-b border-t-border last:border-b-0 text-[0.75rem]">
      <span className="text-muted">{label}</span>
      <span className={valueClass || "text-foreground/90"}>{value}</span>
    </div>
  );
}
