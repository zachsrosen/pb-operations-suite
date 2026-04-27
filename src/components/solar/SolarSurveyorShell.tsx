"use client";

import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { EagleViewPanel } from "@/components/EagleViewPanel";
import ProjectBrowser from "./ProjectBrowser";
import ClassicWorkspace from "./ClassicWorkspace";
import SetupWizard from "./SetupWizard";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import type { SolarMode, ModeReason } from "@/lib/solar/native-mode";

const AnalysisWorkspace = lazy(() => import("./analysis/AnalysisWorkspace"));

type ViewState = "native" | "classic" | "wizard" | "analysis";

interface SolarSurveyorShellProps {
  initialMode: SolarMode;
  modeReason: ModeReason;
  userPreference?: "wizard" | "classic" | "browser" | null;
}

const SUITE_BREADCRUMBS: Record<string, { label: string; href: string }> = {
  de: { label: "D&E", href: "/suites/design-engineering" },
  service: { label: "Service", href: "/suites/service" },
};

/**
 * Strict resolution order (first match wins):
 *
 * 1. FORCE_CLASSIC env → classic (toggle hidden, wizard blocked)
 * 2. NATIVE_DEFAULT + pref "wizard" → wizard
 * 3. NATIVE_DEFAULT + pref "classic" → classic
 * 4. NATIVE_DEFAULT + pref "browser" or null → native
 * 5. Env unset + pref "wizard" → wizard
 * 6. Env unset + pref "classic" or null → classic
 * 7. Env unset + pref "browser" → native
 */
function resolveInitialView(
  mode: SolarMode,
  reason: ModeReason,
  pref: string | null
): ViewState {
  if (reason === "env_force_classic") return "classic";
  if (pref === "wizard") return "wizard";
  if (pref === "browser") return "native";
  if (pref === "classic") return "classic";
  return mode === "native" ? "native" : "classic";
}

export default function SolarSurveyorShell({
  initialMode,
  modeReason,
  userPreference,
}: SolarSurveyorShellProps) {
  const forceClassicLocked = modeReason === "env_force_classic";

  const initialView = resolveInitialView(
    initialMode,
    modeReason,
    userPreference ?? null
  );
  const [activeView, setActiveView] = useState<ViewState>(initialView);
  const [viewSource, setViewSource] = useState<"initial" | "toggle">("initial");
  const [wizardDraftId, setWizardDraftId] = useState<string | undefined>();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { trackFeature } = useActivityTracking();
  const searchParams = useSearchParams();

  // Breadcrumb points back to whichever suite the user came from
  const breadcrumbs = useMemo(() => {
    const from = searchParams.get("suite");
    const parent = from ? SUITE_BREADCRUMBS[from] : null;
    return parent ? [parent] : undefined;
  }, [searchParams]);

  // Optional HubSpot deal link via ?dealId= URL param. When set, renders the
  // EagleView panel above the workspace so surveyors/designers can pull
  // TrueDesign files without leaving Solar Surveyor.
  const linkedDealId = useMemo(() => {
    const v = searchParams.get("dealId");
    return v && /^[0-9]+$/.test(v) ? v : null;
  }, [searchParams]);

  // CSRF bootstrap — call /api/solar/session to set csrf_token cookie
  useEffect(() => {
    fetch("/api/solar/session").catch(() => {});
  }, []);

  const switchView = useCallback(
    (target: ViewState) => {
      if (forceClassicLocked && target !== "classic") return;
      trackFeature("solar_mode_switch", undefined, {
        from: activeView,
        to: target,
        serverDefault: initialMode,
        modeReason,
      });
      setViewSource("toggle");
      setActiveView(target);
    },
    [activeView, initialMode, modeReason, forceClassicLocked, trackFeature]
  );

  const handleStartWizard = useCallback(
    (draftId?: string) => {
      setWizardDraftId(draftId);
      switchView("wizard");
    },
    [switchView]
  );

  const handleWizardComplete = useCallback(
    (projectId: string) => {
      trackFeature("solar_wizard_completed_shell", undefined, { projectId });
      setSelectedProjectId(projectId);
      switchView("classic");
    },
    [switchView, trackFeature]
  );

  const handleWizardCancel = useCallback(() => {
    switchView("native");
  }, [switchView]);

  const handleRunAnalysis = useCallback(
    (projectId: string) => {
      trackFeature("solar_analysis_started", undefined, { projectId });
      setSelectedProjectId(projectId);
      switchView("analysis");
    },
    [switchView, trackFeature]
  );

  const handleOpenInClassic = useCallback(
    (projectId?: string) => {
      trackFeature("solar_open_in_classic", undefined, { projectId: projectId ?? "none" });
      if (projectId) setSelectedProjectId(projectId);
      switchView("classic");
    },
    [switchView, trackFeature]
  );

  const handleBackFromAnalysis = useCallback(() => {
    setSelectedProjectId(null);
    switchView("native");
  }, [switchView]);

  // Toggle button — hidden when force-classic is locked
  const headerRight =
    !forceClassicLocked ? (
      activeView === "native" ? (
        <button
          onClick={() => handleOpenInClassic()}
          className="text-xs px-2 sm:px-3 py-1.5 rounded border border-t-border text-muted hover:text-orange-400 hover:border-orange-500/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50"
        >
          <span className="hidden sm:inline">Use </span>Classic<span className="hidden sm:inline"> (V12)</span>
        </button>
      ) : activeView === "classic" ? (
        <button
          onClick={() => switchView("native")}
          className="text-xs px-2 sm:px-3 py-1.5 rounded border border-t-border text-muted hover:text-blue-400 hover:border-blue-500/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
        >
          <span className="hidden sm:inline">Try </span>Project Browser
        </button>
      ) : activeView === "analysis" ? (
        <button
          onClick={handleBackFromAnalysis}
          className="text-xs px-2 sm:px-3 py-1.5 rounded border border-t-border text-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50"
        >
          &larr; Back<span className="hidden sm:inline"> to Projects</span>
        </button>
      ) : (
        // wizard — show cancel-to-browser link
        <button
          onClick={handleWizardCancel}
          className="text-xs px-2 sm:px-3 py-1.5 rounded border border-t-border text-muted hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50"
        >
          Back<span className="hidden sm:inline"> to Projects</span>
        </button>
      )
    ) : undefined;

  const subtitle =
    activeView === "native"
      ? "Project Browser"
      : activeView === "wizard"
        ? "New Project"
        : activeView === "analysis"
          ? "Analysis"
          : "Classic Workspace (V12)";

  return (
    <DashboardShell
      title="Solar Surveyor"
      subtitle={subtitle}
      accentColor="orange"
      fullWidth={activeView === "classic"}
      headerRight={headerRight}
      breadcrumbs={breadcrumbs}
    >
      {linkedDealId && (
        <div className="mb-4">
          <EagleViewPanel dealId={linkedDealId} />
        </div>
      )}

      {activeView === "native" && (
        <ProjectBrowser
          onOpenClassic={handleOpenInClassic}
          onStartWizard={handleStartWizard}
          onRunAnalysis={handleRunAnalysis}
          serverDefault={initialMode}
          modeReason={modeReason}
          source={viewSource}
        />
      )}

      {activeView === "classic" && (
        <ClassicWorkspace
          serverDefault={initialMode}
          modeReason={modeReason}
          source={viewSource}
          projectId={selectedProjectId}
        />
      )}

      {activeView === "wizard" && (
        <SetupWizard
          onComplete={handleWizardComplete}
          onCancel={handleWizardCancel}
          existingDraftId={wizardDraftId}
        />
      )}

      {activeView === "analysis" && selectedProjectId && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-2 border-orange-500 border-t-transparent rounded-full" />
              <span className="ml-3 text-sm text-muted">Loading analysis...</span>
            </div>
          }
        >
          <AnalysisWorkspace
            projectId={selectedProjectId}
            onBack={handleBackFromAnalysis}
            onOpenInClassic={handleOpenInClassic}
          />
        </Suspense>
      )}
    </DashboardShell>
  );
}
