"use client";
import { getCategoryLabel, getCategoryFields } from "@/lib/catalog-fields";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";

interface ReviewStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-t-border/50 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-medium ${value ? "text-foreground" : "text-muted/50"}`}>
        {value || "—"}
      </span>
    </div>
  );
}

const SYSTEM_OPTIONS = ["HUBSPOT", "ZUPER", "ZOHO"] as const;

export default function ReviewStep({ state, dispatch, onBack, onSubmit, submitting, error }: ReviewStepProps) {
  const warnings: string[] = [];
  if (state.unitCost && state.sellPrice) {
    const cost = parseFloat(state.unitCost);
    const sell = parseFloat(state.sellPrice);
    if (sell < cost) warnings.push("Sell price is lower than unit cost.");
  }

  const specFields = getCategoryFields(state.category);

  return (
    <div className="space-y-6">
      {/* Product Summary */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Product Summary</h3>
        <Row label="Category" value={getCategoryLabel(state.category) || state.category} />
        <Row label="Brand" value={state.brand} />
        <Row label="Model" value={state.model} />
        <Row label="Description" value={state.description} />
        <Row label="SKU" value={state.sku} />
        <Row label="Vendor" value={state.vendorName} />
        <Row label="Vendor Part #" value={state.vendorPartNumber} />
      </div>

      {/* Specs */}
      {specFields.length > 0 && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Specifications</h3>
          {specFields.map((f) => (
            <Row
              key={f.key}
              label={f.label}
              value={
                state.specValues[f.key] !== undefined && state.specValues[f.key] !== ""
                  ? `${state.specValues[f.key]}${f.unit ? ` ${f.unit}` : ""}`
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Pricing & Physical */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Pricing & Physical</h3>
        <Row label="Unit Cost" value={state.unitCost ? `$${state.unitCost}` : undefined} />
        <Row label="Sell Price" value={state.sellPrice ? `$${state.sellPrice}` : undefined} />
        <Row label="Unit Spec" value={state.unitSpec ? `${state.unitSpec} ${state.unitLabel}` : undefined} />
        <Row label="Dimensions" value={state.length || state.width ? `${state.length || "—"} × ${state.width || "—"} in` : undefined} />
        <Row label="Weight" value={state.weight ? `${state.weight} lbs` : undefined} />
        <Row label="Hard to Procure" value={state.hardToProcure ? "Yes" : "No"} />
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-400">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Systems */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Push to Systems</h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked disabled className="rounded" />
            Internal (always)
          </label>
          {SYSTEM_OPTIONS.map((sys) => (
            <label key={sys} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={state.systems.has(sys)}
                onChange={() => dispatch({ type: "TOGGLE_SYSTEM", system: sys })}
                className="rounded"
              />
              {sys.charAt(0) + sys.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back to Details
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onSubmit}
          className="px-8 py-3 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Submitting..." : "Submit for Approval"}
        </button>
      </div>
    </div>
  );
}
