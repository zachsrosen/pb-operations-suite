/**
 * Solar Engine — Analysis Workspace
 *
 * Main native analysis container:
 * 1. Fetch project → fetch weather → build payload
 * 2. User clicks "Run Analysis" (explicit trigger [B2])
 * 3. useSimulation → progress/cancel/result/error
 * 4. Render result cards with architecture-aware metrics
 * 5. "Save Results" button (disabled for Quick Estimates)
 *
 * Save Results eligibility: requires both !isQuickEstimate AND status === "complete"
 */

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { useSimulation } from "@/lib/solar/hooks/useSimulation";
import {
  buildWorkerPayload,
  DesignDataRequired,
  type WeatherDataForAdapter,
} from "@/lib/solar/adapters/project-to-worker";
import {
  mapWorkerResultToUI,
  type AnalysisResult,
} from "@/lib/solar/adapters/worker-to-ui";
import RunControls from "./RunControls";
import ProductionSummary from "./ProductionSummary";
import MismatchCard from "./MismatchCard";
import DispatchSummary from "./DispatchSummary";
import EquipmentSummary from "./EquipmentSummary";
import RoofShadeSummary from "./RoofShadeSummary";
import LossBreakdown from "./LossBreakdown";

interface AnalysisWorkspaceProps {
  projectId: string;
  onBack: () => void;
  onOpenInClassic?: (projectId: string) => void;
}

type LoadPhase = "loading" | "ready" | "error";

interface ProjectData {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  equipmentConfig: Record<string, unknown> | null;
  stringsConfig: Record<string, unknown> | null;
  panelStats: Array<Record<string, unknown>> | null;
  lossProfile: Record<string, unknown> | null;
  siteConditions: Record<string, unknown> | null;
  homeConsumptionConfig: Record<string, unknown> | null;
  version: number;
}

export default function AnalysisWorkspace({
  projectId,
  onBack,
  onOpenInClassic,
}: AnalysisWorkspaceProps) {
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [, setWeatherData] = useState<WeatherDataForAdapter | null>(
    null
  );
  const [isQuickEstimate, setIsQuickEstimate] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { state: simState, run, cancel } = useSimulation();
  const { trackFeature } = useActivityTracking();
  const payloadRef = useRef<ReturnType<typeof buildWorkerPayload> | null>(null);

  // ── Phase 1: Fetch project ──────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadPhase("loading");
        setLoadError(null);

        // Fetch project
        const projRes = await fetch(`/api/solar/projects/${projectId}`);
        if (!projRes.ok) {
          if (projRes.status === 401) {
            window.location.href =
              "/login?callbackUrl=/dashboards/solar-surveyor";
            return;
          }
          throw new Error(`Failed to load project (${projRes.status})`);
        }
        const projJson = await projRes.json();
        const proj = projJson.data as ProjectData;

        if (cancelled) return;
        setProject(proj);

        // Fetch weather if we have coordinates
        let weather: WeatherDataForAdapter | null = null;
        if (proj.lat && proj.lng) {
          try {
            const weatherRes = await fetch(
              `/api/solar/weather?lat=${proj.lat}&lng=${proj.lng}`
            );
            if (weatherRes.ok) {
              const weatherJson = await weatherRes.json();
              weather = weatherJson.data as WeatherDataForAdapter;
            }
          } catch {
            // Weather fetch failure is non-fatal — engine uses synthetic data
          }
        }

        if (cancelled) return;
        setWeatherData(weather);

        // Build payload via adapter
        try {
          const result = buildWorkerPayload(proj, weather);
          payloadRef.current = result;
          setIsQuickEstimate(result.isQuickEstimate);
          setLoadPhase("ready");
        } catch (err) {
          if (err instanceof DesignDataRequired) {
            setLoadError(err.message);
          } else {
            setLoadError(
              err instanceof Error ? err.message : "Failed to prepare analysis"
            );
          }
          setLoadPhase("error");
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load project"
        );
        setLoadPhase("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Map simulation result to UI ─────────────────────────

  useEffect(() => {
    if (simState.status === "complete" && simState.result) {
      const uiResult = mapWorkerResultToUI(simState.result, isQuickEstimate);
      setAnalysisResult(uiResult);
      setSaved(false); // Reset saved state on new run
      setSaveError(null);
      trackFeature("solar_analysis_run_succeeded", "Analysis completed", {
        projectId,
        annualKwh: uiResult.annualKwh,
        panelCount: uiResult.panelCount,
        isQuickEstimate,
      });
    } else if (simState.status === "error") {
      trackFeature("solar_analysis_run_failed", "Analysis error", {
        projectId,
        error: simState.error || "unknown",
        isQuickEstimate,
      });
    }
  }, [simState.status, simState.result, simState.error, isQuickEstimate, projectId, trackFeature]);

  // ── Handlers ────────────────────────────────────────────

  const handleRun = useCallback(() => {
    if (!payloadRef.current) return;
    setAnalysisResult(null);
    setSaved(false);
    setSaveError(null);
    trackFeature("solar_analysis_run_started", "Run initiated", {
      projectId,
      isQuickEstimate,
      panelCount: payloadRef.current.payload.panelStats?.length ?? 0,
    });
    run(payloadRef.current.payload);
  }, [run, trackFeature, projectId, isQuickEstimate]);

  const handleCancel = useCallback(() => {
    trackFeature("solar_analysis_run_cancelled", "Run cancelled", { projectId, isQuickEstimate });
    cancel();
    setAnalysisResult(null);
  }, [cancel, trackFeature, projectId, isQuickEstimate]);

  /** Save Results — explicit revision creation [B2] */
  const handleSave = useCallback(async () => {
    if (!project || !analysisResult || isQuickEstimate) return;
    if (simState.status !== "complete") return; // Guard: must be complete

    try {
      setSaving(true);
      setSaveError(null);

      const res = await fetch(`/api/solar/projects/${projectId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({
          version: project.version,
          createRevision: true,
          revisionNote: "Native analysis results",
          analysisResults: {
            schemaVersion: analysisResult.schemaVersion,
            annualKwh: analysisResult.annualKwh,
            monthlyKwh: analysisResult.monthlyKwh,
            panelCount: analysisResult.panelCount,
            systemSizeKw: analysisResult.systemSizeKw,
            systemTsrf: analysisResult.systemTsrf,
            specificYield: analysisResult.specificYield,
            mismatchLossPct: analysisResult.mismatchLossPct,
            energyBalance: analysisResult.energyBalance,
            clippingLossPct: analysisResult.clippingLossPct,
            isQuickEstimate: false,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error || `Failed to save results (${res.status})`
        );
      }

      const updated = await res.json();
      // Update local version to prevent optimistic concurrency conflicts
      setProject((prev) =>
        prev ? { ...prev, version: updated.data.version } : prev
      );
      setSaved(true);
      trackFeature("solar_analysis_results_saved", "Results saved", {
        projectId,
        annualKwh: analysisResult.annualKwh,
        panelCount: analysisResult.panelCount,
      });
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save results"
      );
    } finally {
      setSaving(false);
    }
  }, [project, analysisResult, isQuickEstimate, projectId, simState.status]);

  // ── Render ──────────────────────────────────────────────

  if (loadPhase === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin h-6 w-6 border-2 border-orange-500 border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-muted">Loading project...</span>
      </div>
    );
  }

  if (loadPhase === "error") {
    return (
      <div className="space-y-4 max-w-lg mx-auto py-12">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{loadError}</p>
        </div>
        <button
          onClick={onBack}
          className="text-xs text-muted hover:text-foreground transition-colors"
        >
          &larr; Back to Projects
        </button>
      </div>
    );
  }

  const canSave =
    !isQuickEstimate &&
    simState.status === "complete" &&
    analysisResult !== null &&
    !saved;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl" role="main" aria-label="Analysis workspace">
      {/* Project header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-medium text-foreground">
            {project?.name || "Project Analysis"}
          </h2>
          {project?.address && (
            <p className="text-xs sm:text-sm text-muted">{project.address}</p>
          )}
        </div>
        {onOpenInClassic && (
          <button
            onClick={() => onOpenInClassic(projectId)}
            className="shrink-0 text-xs px-3 py-1.5 rounded border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-colors"
          >
            Open in Classic
          </button>
        )}
      </div>

      {/* Project details — always visible */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        <EquipmentSummary equipmentConfig={project?.equipmentConfig ?? null} />
        <RoofShadeSummary
          equipmentConfig={project?.equipmentConfig ?? null}
          siteConditions={project?.siteConditions ?? null}
          lat={project?.lat ?? null}
          lng={project?.lng ?? null}
        />
      </div>

      {/* Run controls */}
      <RunControls
        status={simState.status}
        progress={simState.progress}
        onRun={handleRun}
        onCancel={handleCancel}
        isQuickEstimate={isQuickEstimate}
        error={simState.error}
      />

      {/* Results */}
      {analysisResult && (
        <div className="space-y-4" aria-live="polite">
          {/* Quick Estimate badge on results */}
          {isQuickEstimate && (
            <div
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30"
              role="alert"
            >
              <span className="text-yellow-400 text-xs font-medium">
                ⚡ Quick Estimate Results
              </span>
              <span className="text-yellow-400/70 text-xs">
                These results use auto-derived panel layout and default TSRF. Full accuracy requires design data.
              </span>
            </div>
          )}

          <ProductionSummary result={analysisResult} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <MismatchCard result={analysisResult} />
            <DispatchSummary result={analysisResult} />
          </div>

          <LossBreakdown
            lossProfile={project?.lossProfile ?? null}
            siteConditions={project?.siteConditions ?? null}
          />

          {/* Save Results */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              aria-disabled={!canSave || saving}
              className={`px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${
                canSave && !saving
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              }`}
              title={
                isQuickEstimate
                  ? "Save requires full design data"
                  : saved
                    ? "Results already saved"
                    : simState.status !== "complete"
                      ? "Run analysis first"
                      : "Save results as a project revision"
              }
            >
              {saving
                ? "Saving..."
                : saved
                  ? "✓ Saved"
                  : "Save Results"}
            </button>

            {isQuickEstimate && (
              <span className="text-xs text-yellow-400/60">
                Save requires full design data
              </span>
            )}

            {saveError && (
              <span className="text-xs text-red-400" role="alert">{saveError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Read CSRF token from cookie */
function getCsrfToken(): string {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match?.[1] || "";
}
