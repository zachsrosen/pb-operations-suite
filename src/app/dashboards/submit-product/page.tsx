"use client";

import DashboardShell from "@/components/DashboardShell";
import WizardProgress from "@/components/catalog/WizardProgress";
import StartModeStep from "@/components/catalog/StartModeStep";
import BasicsStep from "@/components/catalog/BasicsStep";
import DetailsStep from "@/components/catalog/DetailsStep";
import ReviewStep from "@/components/catalog/ReviewStep";
import { type CloneResult } from "@/components/catalog/CloneSearch";
import { type ExtractedProduct } from "@/components/catalog/DatasheetImport";
import { getCategoryDefaults } from "@/lib/catalog-fields";
import {
  catalogFormReducer,
  initialFormState,
  type CatalogFormState,
} from "@/lib/catalog-form-state";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useReducer, useEffect, useCallback, Suspense } from "react";

type WizardStep = "start" | "basics" | "details" | "review";

// Spec relation keys returned by the clone search API
const SPEC_RELATIONS = [
  "moduleSpec",
  "inverterSpec",
  "batterySpec",
  "evChargerSpec",
  "mountingHardwareSpec",
  "electricalHardwareSpec",
  "relayDeviceSpec",
] as const;

// Top-level fields to copy from a clone result into form state
const CLONE_FIELD_MAP: (keyof CatalogFormState)[] = [
  "brand",
  "model",
  "description",
  "unitSpec",
  "unitLabel",
  "unitCost",
  "sellPrice",
  "hardToProcure",
  "sku",
  "vendorName",
  "vendorPartNumber",
];

/**
 * Normalize a clone search result into a shape compatible with
 * the PREFILL_FROM_PRODUCT reducer action:
 *  - copies top-level scalar fields
 *  - finds the non-null spec relation and flattens it into specValues
 */
function normalizeCloneResult(
  product: CloneResult
): Partial<CatalogFormState> {
  const data: Record<string, unknown> = {};

  // Copy category
  if (product.category) data.category = product.category;

  // Copy top-level fields, coerce numbers to strings for form inputs
  for (const key of CLONE_FIELD_MAP) {
    const value = product[key as keyof CloneResult];
    if (value !== undefined && value !== null) {
      data[key] =
        typeof value === "number" ? String(value) : value;
    }
  }

  // Find the non-null spec relation and flatten to specValues
  for (const rel of SPEC_RELATIONS) {
    const specObj = product[rel];
    if (specObj && typeof specObj === "object") {
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(specObj)) {
        // Skip Prisma relation keys
        if (k === "id" || k === "skuId" || k === "equipmentSkuId") continue;
        if (v !== null && v !== undefined && v !== "") {
          flat[k] = typeof v === "number" ? String(v) : v;
        }
      }
      if (Object.keys(flat).length > 0) {
        data.specValues = flat;
      }
      break; // only one spec relation per product
    }
  }

  return data as Partial<CatalogFormState>;
}

function CatalogWizard() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [state, dispatch] = useReducer(catalogFormReducer, initialFormState);
  const [currentStep, setCurrentStep] = useState<WizardStep>("start");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // URL query-param prefill from deal/BOM flows
  useEffect(() => {
    const paramFields = ["category", "brand", "model", "description", "unitSpec", "unitLabel"] as const;
    let hasAny = false;
    const explicitUnitLabel = searchParams.get("unitLabel");

    for (const field of paramFields) {
      const value = searchParams.get(field);
      if (value) {
        if (field === "category") {
          dispatch({ type: "SET_CATEGORY", category: value });
          // Apply category defaults — only fill unitLabel when URL didn't provide one
          const defaults = getCategoryDefaults(value);
          if (!explicitUnitLabel) {
            dispatch({ type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
          }
          dispatch({ type: "SET_FIELD", field: "systems", value: defaults.systems });
        } else {
          dispatch({ type: "SET_FIELD", field, value });
        }
        hasAny = true;
      }
    }

    // Auto-skip to basics when URL params are present
    if (hasAny) setCurrentStep("basics");
  }, [searchParams]);

  // Apply category defaults whenever category changes via BasicsStep
  const handleCategoryChange = useCallback(
    (category: string) => {
      dispatch({ type: "SET_CATEGORY", category });
      const defaults = getCategoryDefaults(category);
      dispatch({ type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
      dispatch({ type: "SET_FIELD", field: "systems", value: defaults.systems });
    },
    []
  );

  // Clone prefill: normalize spec relations → flat specValues, dispatch PREFILL
  const handleClone = useCallback((product: CloneResult) => {
    const normalized = normalizeCloneResult(product);
    dispatch({ type: "PREFILL_FROM_PRODUCT", data: normalized, source: "clone" });
    // Apply category defaults — only fill unitLabel when the clone didn't provide one
    if (product.category) {
      const defaults = getCategoryDefaults(product.category);
      if (!normalized.unitLabel) {
        dispatch({ type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
      }
      dispatch({ type: "SET_FIELD", field: "systems", value: defaults.systems });
    }
    setCurrentStep("basics");
  }, []);

  // Datasheet prefill: map extraction → PREFILL
  const handleDatasheetExtracted = useCallback(
    (extracted: ExtractedProduct) => {
      dispatch({
        type: "PREFILL_FROM_PRODUCT",
        data: extracted as Partial<CatalogFormState>,
        source: "datasheet",
      });
      // Apply category defaults — only fill unitLabel when extraction didn't provide one
      if (extracted.category) {
        const defaults = getCategoryDefaults(extracted.category);
        if (!extracted.unitLabel) {
          dispatch({ type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
        }
        dispatch({ type: "SET_FIELD", field: "systems", value: defaults.systems });
      }
      setCurrentStep("basics");
    },
    []
  );

  // Submit: same payload shape as original form
  async function handleSubmit() {
    setError(null);
    setSubmitting(true);

    try {
      const payload = {
        brand: state.brand,
        model: state.model,
        description: state.description,
        category: state.category,
        unitSpec: state.unitSpec || null,
        unitLabel: state.unitLabel || null,
        sku: state.sku || null,
        vendorName: state.vendorName || null,
        vendorPartNumber: state.vendorPartNumber || null,
        unitCost: state.unitCost ? parseFloat(state.unitCost) : null,
        sellPrice: state.sellPrice ? parseFloat(state.sellPrice) : null,
        hardToProcure: state.hardToProcure,
        length: state.length ? parseFloat(state.length) : null,
        width: state.width ? parseFloat(state.width) : null,
        weight: state.weight ? parseFloat(state.weight) : null,
        metadata:
          Object.keys(state.specValues).length > 0 || state.photoUrl
            ? { ...state.specValues, ...(state.photoUrl ? { _photoUrl: state.photoUrl } : {}) }
            : null,
        systems: Array.from(state.systems),
        dealId: searchParams.get("dealId") || null,
      };

      const res = await fetch("/api/catalog/push-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${res.status})`);
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Success screen
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="h-16 w-16 rounded-full bg-cyan-500/20 flex items-center justify-center">
          <svg
            className="h-8 w-8 text-cyan-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Product Submitted for Approval
        </h2>
        <p className="text-sm text-muted">
          Your product has been submitted and is awaiting review.
        </p>
        <button
          onClick={() => router.push("/dashboards/catalog")}
          className="mt-4 rounded-lg bg-cyan-600 px-6 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
        >
          Back to Catalog
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <WizardProgress currentStep={currentStep} />

      {currentStep === "start" && (
        <StartModeStep
          onStartScratch={() => setCurrentStep("basics")}
          onClone={handleClone}
          onDatasheetExtracted={handleDatasheetExtracted}
        />
      )}

      {currentStep === "basics" && (
        <BasicsStep
          state={state}
          dispatch={dispatch}
          onCategoryChange={handleCategoryChange}
          onNext={() => setCurrentStep("details")}
          onBack={() => {
            dispatch({ type: "RESET" });
            setCurrentStep("start");
          }}
        />
      )}

      {currentStep === "details" && (
        <DetailsStep
          state={state}
          dispatch={dispatch}
          onNext={() => setCurrentStep("review")}
          onBack={() => setCurrentStep("basics")}
        />
      )}

      {currentStep === "review" && (
        <ReviewStep
          state={state}
          dispatch={dispatch}
          onBack={() => setCurrentStep("details")}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
        />
      )}
    </div>
  );
}

export default function NewProductPage() {
  return (
    <DashboardShell title="Submit New Product" accentColor="cyan">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        }
      >
        <CatalogWizard />
      </Suspense>
    </DashboardShell>
  );
}
