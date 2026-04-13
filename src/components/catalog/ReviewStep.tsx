"use client";
import { getCategoryLabel, getCategoryFields } from "@/lib/catalog-fields";
import { validateCatalogForm } from "@/lib/catalog-form-state";
import { getDownstreamReadiness } from "@/lib/catalog-readiness";
import { buildSystemPreview } from "@/lib/catalog-preview";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";

interface ReviewStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

function Row({
  label,
  value,
  required,
  missing,
}: {
  label: string;
  value: string | null | undefined;
  required?: boolean;
  missing?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-t-border/50 last:border-0">
      <span className={`text-sm ${missing ? "text-red-400 font-medium" : "text-muted"}`}>
        {label}
        {required && missing && <span className="ml-1 text-xs">(required)</span>}
      </span>
      <span
        className={`text-sm font-medium ${
          missing ? "text-red-400" : value ? "text-foreground" : "text-muted/50"
        }`}
      >
        {missing ? "Missing" : value || "—"}
      </span>
    </div>
  );
}

function formatPreviewValue(value: string | number | null | unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return String(value);
  const s = String(value);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

const SYSTEM_OPTIONS = ["HUBSPOT", "ZUPER", "ZOHO"] as const;

export default function ReviewStep({
  state,
  dispatch,
  onBack,
  onSubmit,
  submitting,
  error,
}: ReviewStepProps) {
  const { valid, errors, warnings } = validateCatalogForm(state);
  const specFields = getCategoryFields(state.category);
  const readiness = getDownstreamReadiness({
    category: state.category,
    systems: state.systems,
    specValues: state.specValues,
  });
  const systemPreviews = buildSystemPreview(
    {
      category: state.category,
      brand: state.brand,
      model: state.model,
      // CatalogFormState has no `name` field — preview falls back to brand+model,
      // which matches what the approval API actually sends downstream.
      description: state.description,
      sku: state.sku,
      vendorName: state.vendorName,
      vendorPartNumber: state.vendorPartNumber,
      zohoVendorId: state.zohoVendorId,
      unitLabel: state.unitLabel,
      sellPrice: state.sellPrice ? Number(state.sellPrice) : null,
      unitCost: state.unitCost ? Number(state.unitCost) : null,
      specValues: state.specValues,
    },
    [...state.systems] as ("ZOHO" | "HUBSPOT" | "ZUPER")[],
  );

  // Build a set of fields with errors for quick lookup
  const errorFields = new Set(errors.map((e) => e.field));

  // Non-inline errors for the error summary banner (basics errors show inline,
  // but also appear in the summary; spec errors show both inline and in summary)
  const summaryErrors = errors;

  return (
    <div className="space-y-6">
      {/* Product Summary */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Product Summary</h3>
        <Row label="Category" value={getCategoryLabel(state.category) || state.category} required missing={errorFields.has("category")} />
        <Row label="Brand" value={state.brand} required missing={errorFields.has("brand")} />
        <Row label="Model" value={state.model} required missing={errorFields.has("model")} />
        <Row label="Description" value={state.description} required missing={errorFields.has("description")} />
        <Row label="SKU" value={state.sku} />
        <Row label="Vendor" value={state.vendorName} />
        <Row label="Vendor Part #" value={state.vendorPartNumber} />
      </div>

      {/* Specs */}
      {specFields.length > 0 && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Specifications</h3>
          {specFields.map((f) => {
            const hasValue =
              state.specValues[f.key] !== undefined && state.specValues[f.key] !== "";
            const isMissing = errorFields.has(`spec.${f.key}`);
            return (
              <Row
                key={f.key}
                label={f.label}
                value={
                  hasValue
                    ? `${state.specValues[f.key]}${f.unit ? ` ${f.unit}` : ""}`
                    : undefined
                }
                required={f.required}
                missing={isMissing}
              />
            );
          })}
        </div>
      )}

      {/* Pricing & Physical */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Pricing & Physical</h3>
        <Row label="Unit Cost" value={state.unitCost ? `$${state.unitCost}` : undefined} />
        <Row label="Sell Price" value={state.sellPrice ? `$${state.sellPrice}` : undefined} />
        <Row
          label="Unit Spec"
          value={state.unitSpec ? `${state.unitSpec} ${state.unitLabel}` : undefined}
        />
        <Row
          label="Dimensions"
          value={
            state.length || state.width
              ? `${state.length || "—"} × ${state.width || "—"} in`
              : undefined
          }
        />
        <Row label="Weight" value={state.weight ? `${state.weight} lbs` : undefined} />
        <Row label="Hard to Procure" value={state.hardToProcure ? "Yes" : "No"} />
      </div>

      {/* Product Photo */}
      {state.photoUrl && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Product Photo</h3>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg border border-t-border overflow-hidden bg-surface-2 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.photoUrl}
                alt="Product"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="text-sm text-muted">{state.photoFileName || "Uploaded"}</span>
          </div>
        </div>
      )}

      {/* Warnings (non-blocking) */}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-400">
              ⚠ {w.message}
            </p>
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
            <label
              key={sys}
              className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
            >
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

      {/* Per-System Create Preview */}
      {systemPreviews.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">
            What each system will receive
          </h3>
          {systemPreviews.map((card) => (
            <div
              key={card.system}
              className="bg-surface rounded-xl border border-t-border p-5 shadow-card"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block h-2 w-2 rounded-full bg-cyan-500" />
                <h4 className="text-sm font-semibold text-foreground">
                  {card.system === "ZOHO"
                    ? "Zoho Inventory"
                    : card.system === "HUBSPOT"
                      ? "HubSpot"
                      : "Zuper"}
                </h4>
                <span className="text-xs text-muted">
                  — {card.fields.filter((f) => !f.missing).length} of{" "}
                  {card.fields.length} fields populated
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {card.fields.map((field) => (
                  <div
                    key={field.externalField}
                    className="flex items-baseline justify-between py-1 border-b border-t-border/30 last:border-0"
                  >
                    <span className={`text-xs ${field.missing ? "text-amber-400" : "text-muted"}`}>
                      {field.label}
                    </span>
                    <span
                      className={`text-xs font-mono ml-2 truncate max-w-[200px] ${
                        field.missing
                          ? "text-amber-400/60 italic"
                          : "text-foreground"
                      }`}
                      title={field.value != null ? String(field.value) : undefined}
                    >
                      {field.missing ? "not set" : formatPreviewValue(field.value)}
                      {field.transformed && (
                        <span className="ml-1 text-[10px] text-amber-400/70 font-sans" title="This value will be mapped to a system-specific ID before sync">
                          → mapped
                        </span>
                      )}
                      {field.pushOnly && (
                        <span className="ml-1 text-[10px] text-muted/50 font-sans" title="This field is push-only and cannot be pulled back">
                          (one-way)
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Validation Errors */}
      {summaryErrors.length > 0 && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
          <p className="text-sm font-medium text-red-400 mb-1">
            {summaryErrors.length} required field{summaryErrors.length > 1 ? "s" : ""} missing:
          </p>
          {summaryErrors.map((e, i) => (
            <p key={i} className="text-sm text-red-400">
              • {e.message}
            </p>
          ))}
        </div>
      )}

      {/* Server/submit error */}
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
          disabled={submitting || !valid}
          onClick={onSubmit}
          className="px-8 py-3 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Submitting..." : !valid ? "Fix required fields" : "Submit for Approval"}
        </button>
      </div>
    </div>
  );
}
