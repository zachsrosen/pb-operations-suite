"use client";
import CategoryFields from "./CategoryFields";
import FieldTooltip from "./FieldTooltip";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";

interface DetailsStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onNext: () => void;
  onBack: () => void;
}

function OptionalBadge() {
  return <span className="text-[10px] text-muted ml-1">(optional)</span>;
}

export default function DetailsStep({ state, dispatch, onNext, onBack }: DetailsStepProps) {
  const isPrefilled = (field: string) => state.prefillFields.has(field);
  const fieldClass = (field: string) =>
    `${isPrefilled(field) ? "border-l-2 border-l-blue-400 pl-3" : ""}`;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        These fields are optional — fill what you have, skip the rest.
      </p>

      {/* Category Specs */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Category Specifications <OptionalBadge />
        </h3>
        <CategoryFields
          category={state.category}
          values={state.specValues}
          onChange={(key, value) => dispatch({ type: "SET_SPEC", key, value })}
          showTooltips={true}
          prefillFields={state.prefillFields}
        />
      </div>

      {/* Pricing */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Pricing & Unit <OptionalBadge />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={fieldClass("unitCost")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Unit Cost ($)
              <FieldTooltip text="Your cost to purchase this item from the vendor" />
            </label>
            <input
              type="number"
              step="any"
              value={state.unitCost}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "unitCost", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("sellPrice")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Sell Price ($)
              <FieldTooltip text="The price charged to the customer" />
            </label>
            <input
              type="number"
              step="any"
              value={state.sellPrice}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "sellPrice", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("unitSpec")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Unit Spec
              <FieldTooltip text="The primary numeric rating (e.g., 400 for a 400W module, 13.5 for a 13.5kWh battery)" />
            </label>
            <input
              type="number"
              step="any"
              value={state.unitSpec}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "unitSpec", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("unitLabel")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Unit Label
              <FieldTooltip text="Unit of measurement for the spec (e.g., W, kWh, kW, A)" />
            </label>
            <input
              type="text"
              value={state.unitLabel}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "unitLabel", value: e.target.value })}
              placeholder="W, kWh, kW, A..."
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Physical & Vendor */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Physical Details & Vendor <OptionalBadge />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className={fieldClass("length")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Length (in)
              <FieldTooltip text="Product length in inches" />
            </label>
            <input
              type="number"
              step="any"
              value={state.length}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "length", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("width")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Width (in)
              <FieldTooltip text="Product width in inches" />
            </label>
            <input
              type="number"
              step="any"
              value={state.width}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "width", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("weight")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Weight (lbs)
              <FieldTooltip text="Product weight in pounds" />
            </label>
            <input
              type="number"
              step="any"
              value={state.weight}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "weight", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("sku")}>
            <label className="block text-sm font-medium text-muted mb-1">
              SKU
              <FieldTooltip text="Internal product SKU for tracking" />
            </label>
            <input
              type="text"
              value={state.sku}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "sku", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("vendorName")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Vendor Name
              <FieldTooltip text="Distributor or supplier name (e.g., CED, BayWa)" />
            </label>
            <input
              type="text"
              value={state.vendorName}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "vendorName", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("vendorPartNumber")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Vendor Part #
              <FieldTooltip text="The part number used by the vendor/distributor" />
            </label>
            <input
              type="text"
              value={state.vendorPartNumber}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "vendorPartNumber", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
        </div>

        {/* Hard to Procure */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={state.hardToProcure}
            onClick={() => dispatch({ type: "SET_FIELD", field: "hardToProcure", value: !state.hardToProcure })}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              state.hardToProcure ? "bg-amber-500" : "bg-surface-2"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                state.hardToProcure ? "translate-x-5" : ""
              }`}
            />
          </button>
          <span className="text-sm text-muted">
            Hard to Procure
            <FieldTooltip text="Flag if lead times exceed 4+ weeks — affects project scheduling estimates" />
          </span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onNext}
            className="text-sm text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
          >
            Skip to Review
          </button>
          <button
            type="button"
            onClick={onNext}
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition-colors"
          >
            Next: Review →
          </button>
        </div>
      </div>
    </div>
  );
}
