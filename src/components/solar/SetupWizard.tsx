"use client";

import { useState, useCallback, useEffect } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import WizardStepper from "./wizard/WizardStepper";
import StepBasics from "./wizard/StepBasics";
import StepEquipment from "./wizard/StepEquipment";
import StepShadeSource from "./wizard/StepShadeSource";
import StepReview from "./wizard/StepReview";
import type { EquipmentSelections } from "./wizard/StepEquipment";

const STEPS = ["Basics", "Equipment", "Shade", "Review"];

interface SetupWizardProps {
  onComplete: (projectId: string) => void;
  onCancel: () => void;
  existingDraftId?: string | null;
}

interface ConflictInfo {
  serverVersion: number;
  updatedBy: string;
  updatedAt: string;
}

export default function SetupWizard({
  onComplete,
  onCancel,
  existingDraftId,
}: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(
    existingDraftId ?? null
  );
  const [projectVersion, setProjectVersion] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const { trackFeature } = useActivityTracking();

  // Form data
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [equipment, setEquipment] = useState<EquipmentSelections>({
    panelKey: null,
    inverterKey: null,
    essKey: null,
    optimizerKey: null,
  });
  const [shadeSource, setShadeSource] = useState<
    "google_solar" | "dxf_upload" | null
  >(null);

  // Track wizard start
  useEffect(() => {
    trackFeature("solar_wizard_started", undefined, {
      source: existingDraftId ? "resume" : "new",
      draftId: existingDraftId ?? undefined,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume existing draft — fetch and pre-fill
  useEffect(() => {
    if (!existingDraftId) return;
    (async () => {
      try {
        const res = await fetch(`/api/solar/projects/${existingDraftId}`);
        if (!res.ok) return;
        const json = await res.json();
        const p = json.data;
        setName(p.name ?? "");
        setAddress(p.address ?? "");
        setProjectVersion(p.version ?? 1);

        if (p.equipmentConfig) {
          setEquipment({
            panelKey: p.equipmentConfig.panelKey ?? null,
            inverterKey: p.equipmentConfig.inverterKey ?? null,
            essKey: p.equipmentConfig.essKey ?? null,
            optimizerKey: p.equipmentConfig.optimizerKey ?? null,
          });
        }
        if (p.siteConditions?.shadeSource) {
          setShadeSource(p.siteConditions.shadeSource);
        }

        // Figure out which step to resume at
        if (p.siteConditions?.shadeSource) {
          setCurrentStep(3); // Review
        } else if (p.equipmentConfig?.panelKey) {
          setCurrentStep(2); // Shade
        } else {
          setCurrentStep(1); // Equipment (basics already done)
        }
      } catch {
        // If fetch fails, start from scratch
      }
    })();
  }, [existingDraftId]);

  const getCsrfToken = useCallback((): string => {
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match?.[1] ?? "";
  }, []);

  const handleApiError = useCallback(
    async (res: Response, step: number) => {
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setConflict({
          serverVersion: body?.serverVersion ?? 0,
          updatedBy: body?.updatedBy ?? "unknown",
          updatedAt: body?.updatedAt ?? "",
        });
        trackFeature("solar_wizard_conflict", undefined, {
          step,
          projectId,
          serverVersion: body?.serverVersion,
          clientVersion: projectVersion,
        });
        return true;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Request failed (${res.status})`);
      return true;
    },
    [projectId, projectVersion, trackFeature]
  );

  // ── Step 1: Basics → POST project ────────────────────────
  const handleBasicsNext = useCallback(
    async (data: { name: string; address: string }) => {
      setError(null);
      setSaving(true);
      setName(data.name);
      setAddress(data.address);

      try {
        if (projectId) {
          // Already have a project (resume case) — just advance
          setCurrentStep(1);
          trackFeature("solar_wizard_step_completed", undefined, {
            step: 0,
            stepName: "Basics",
            projectId,
          });
          return;
        }

        const res = await fetch("/api/solar/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
          },
          body: JSON.stringify({
            name: data.name,
            address: data.address || undefined,
            visibility: "PRIVATE",
          }),
        });

        if (!res.ok) {
          await handleApiError(res, 0);
          return;
        }

        const json = await res.json();
        setProjectId(json.data.id);
        setProjectVersion(json.data.version ?? 1);
        setCurrentStep(1);
        trackFeature("solar_wizard_step_completed", undefined, {
          step: 0,
          stepName: "Basics",
          projectId: json.data.id,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setSaving(false);
      }
    },
    [projectId, getCsrfToken, handleApiError, trackFeature]
  );

  // ── Step 2: Equipment → PUT equipmentConfig ──────────────
  const handleEquipmentNext = useCallback(
    async (selections: EquipmentSelections) => {
      if (!projectId) return;
      setError(null);
      setConflict(null);
      setSaving(true);
      setEquipment(selections);

      try {
        const res = await fetch(`/api/solar/projects/${projectId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
          },
          body: JSON.stringify({
            version: projectVersion,
            equipmentConfig: {
              panelKey: selections.panelKey,
              inverterKey: selections.inverterKey,
              essKey: selections.essKey,
              optimizerKey: selections.optimizerKey,
              source: "wizard_v1",
            },
          }),
        });

        if (!res.ok) {
          await handleApiError(res, 1);
          return;
        }

        const json = await res.json();
        setProjectVersion(json.data.version);
        setCurrentStep(2);
        trackFeature("solar_wizard_step_completed", undefined, {
          step: 1,
          stepName: "Equipment",
          projectId,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setSaving(false);
      }
    },
    [projectId, projectVersion, getCsrfToken, handleApiError, trackFeature]
  );

  // ── Step 3: Shade → PUT siteConditions ───────────────────
  const handleShadeNext = useCallback(
    async (source: "google_solar" | "dxf_upload") => {
      if (!projectId) return;
      setError(null);
      setConflict(null);
      setSaving(true);
      setShadeSource(source);

      trackFeature("solar_shade_source_selected", undefined, { source });

      try {
        const res = await fetch(`/api/solar/projects/${projectId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
          },
          body: JSON.stringify({
            version: projectVersion,
            siteConditions: {
              shadeSource: source,
              shadeConfiguredAt: new Date().toISOString(),
            },
          }),
        });

        if (!res.ok) {
          await handleApiError(res, 2);
          return;
        }

        const json = await res.json();
        setProjectVersion(json.data.version);
        setCurrentStep(3);
        trackFeature("solar_wizard_step_completed", undefined, {
          step: 2,
          stepName: "Shade",
          projectId,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setSaving(false);
      }
    },
    [projectId, projectVersion, getCsrfToken, handleApiError, trackFeature]
  );

  // ── Step 4: Review → PUT status + visibility, then complete
  const handleFinish = useCallback(
    async (visibility: "TEAM" | "PRIVATE", setWizardPreference: boolean) => {
      if (!projectId) return;
      setError(null);
      setConflict(null);
      setSaving(true);

      try {
        const res = await fetch(`/api/solar/projects/${projectId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
          },
          body: JSON.stringify({
            version: projectVersion,
            status: "ACTIVE",
            visibility,
          }),
        });

        if (!res.ok) {
          await handleApiError(res, 3);
          return;
        }

        // Optionally set wizard preference
        if (setWizardPreference) {
          await fetch("/api/solar/preferences", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": getCsrfToken(),
            },
            body: JSON.stringify({
              solarPreferredEntryMode: "wizard",
            }),
          }).catch(() => {}); // Non-critical
        }

        trackFeature("solar_wizard_completed", undefined, {
          projectId,
          panelKey: equipment.panelKey,
          inverterKey: equipment.inverterKey,
          essKey: equipment.essKey,
          shadeSource,
        });

        onComplete(projectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setSaving(false);
      }
    },
    [
      projectId,
      projectVersion,
      equipment,
      shadeSource,
      getCsrfToken,
      handleApiError,
      trackFeature,
      onComplete,
    ]
  );

  // ── Cancel with confirmation ─────────────────────────────
  const handleCancel = useCallback(() => {
    if (projectId) {
      const confirmed = window.confirm(
        "Your draft will be saved. You can resume it later from the project list. Leave the wizard?"
      );
      if (!confirmed) return;
    }
    trackFeature("solar_wizard_abandoned", undefined, {
      step: currentStep,
      projectId,
    });
    onCancel();
  }, [projectId, currentStep, trackFeature, onCancel]);

  // ── Conflict resolution ──────────────────────────────────
  const handleConflictReload = useCallback(async () => {
    if (!projectId) return;
    setConflict(null);
    setError(null);

    try {
      const res = await fetch(`/api/solar/projects/${projectId}`);
      if (!res.ok) {
        setError("Failed to reload project");
        return;
      }
      const json = await res.json();
      const p = json.data;

      // Full replace of local state with server state
      setName(p.name ?? "");
      setAddress(p.address ?? "");
      setProjectVersion(p.version ?? 1);

      if (p.equipmentConfig) {
        setEquipment({
          panelKey: p.equipmentConfig.panelKey ?? null,
          inverterKey: p.equipmentConfig.inverterKey ?? null,
          essKey: p.equipmentConfig.essKey ?? null,
          optimizerKey: p.equipmentConfig.optimizerKey ?? null,
        });
      } else {
        setEquipment({
          panelKey: null,
          inverterKey: null,
          essKey: null,
          optimizerKey: null,
        });
      }

      if (p.siteConditions?.shadeSource) {
        setShadeSource(p.siteConditions.shadeSource);
      } else {
        setShadeSource(null);
      }
    } catch {
      setError("Failed to reload project");
    }
  }, [projectId]);

  const handleConflictForce = useCallback(async () => {
    // Re-issue the last step's PUT with forceOverwrite
    setConflict(null);
    setError("Force save not yet supported. Please reload and retry.");
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6" role="region" aria-label="New project setup">
      {/* Stepper */}
      <WizardStepper
        steps={STEPS}
        currentStep={currentStep}
        onStepClick={(step) => {
          if (step < currentStep) setCurrentStep(step);
        }}
      />

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-300 hover:text-red-200 underline mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Conflict banner */}
      {conflict && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3" role="alert">
          <p className="text-sm text-yellow-400">
            This project was updated elsewhere (version {conflict.serverVersion}{" "}
            by {conflict.updatedBy}
            {conflict.updatedAt &&
              ` at ${new Date(conflict.updatedAt).toLocaleString()}`}
            ).
          </p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={handleConflictReload}
              className="text-xs px-3 py-1 rounded border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50"
            >
              Reload
            </button>
            <button
              onClick={handleConflictForce}
              className="text-xs px-3 py-1 rounded border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50"
            >
              Force Save
            </button>
          </div>
        </div>
      )}

      {/* Steps */}
      {currentStep === 0 && (
        <StepBasics
          initialName={name}
          initialAddress={address}
          onNext={handleBasicsNext}
          onCancel={handleCancel}
          saving={saving}
        />
      )}

      {currentStep === 1 && (
        <StepEquipment
          initial={equipment}
          onNext={handleEquipmentNext}
          onBack={() => setCurrentStep(0)}
          saving={saving}
        />
      )}

      {currentStep === 2 && (
        <StepShadeSource
          initialSource={shadeSource}
          onNext={handleShadeNext}
          onBack={() => setCurrentStep(1)}
          saving={saving}
        />
      )}

      {currentStep === 3 && (
        <StepReview
          projectName={name}
          projectAddress={address}
          panelKey={equipment.panelKey}
          inverterKey={equipment.inverterKey}
          essKey={equipment.essKey}
          optimizerKey={equipment.optimizerKey}
          shadeSource={shadeSource}
          onFinish={handleFinish}
          onBack={() => setCurrentStep(2)}
          onEditStep={(step) => setCurrentStep(step)}
          saving={saving}
        />
      )}
    </div>
  );
}
