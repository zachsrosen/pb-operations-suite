"use client";
import { useState, useRef } from "react";
import CategoryFields from "./CategoryFields";
import FieldTooltip from "./FieldTooltip";
import { getCategoryFields } from "@/lib/catalog-fields";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";
import type { ValidationError, ValidationWarning } from "@/lib/catalog-form-state";
import VendorPicker from "./VendorPicker";

interface DetailsStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  touchedFields?: Set<string>;
  onFieldBlur?: (field: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function OptionalBadge() {
  return <span className="text-[10px] text-muted ml-1">(optional)</span>;
}

export default function DetailsStep({ state, dispatch, errors, warnings, touchedFields, onFieldBlur, onNext, onBack }: DetailsStepProps) {
  const isPrefilled = (field: string) => state.prefillFields.has(field);
  const fieldClass = (field: string) =>
    `${isPrefilled(field) ? "border-l-2 border-l-blue-400 pl-3" : ""}`;

  const fieldError = (field: string): string | undefined => {
    if (!touchedFields?.has(field)) return undefined;
    return errors?.find((e) => e.field === field)?.message;
  };

  const fieldWarning = (field: string): string | undefined => {
    if (!touchedFields?.has(field)) return undefined;
    return warnings?.find((w) => w.field === field)?.message;
  };

  const inputErrorClass = (field: string): string =>
    fieldError(field) ? "ring-2 ring-red-500/50 border-red-500/50" : "";

  const inputWarningClass = (field: string): string =>
    !fieldError(field) && fieldWarning(field) ? "ring-2 ring-amber-500/50 border-amber-500/50" : "";

  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  const PHOTO_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  async function handlePhotoUpload(file: File) {
    setPhotoError(null);

    // Client-side validation — reject before uploading
    if (!PHOTO_ALLOWED_TYPES.has(file.type)) {
      setPhotoError("Unsupported file type. Use JPEG, PNG, WebP, or GIF.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setPhotoError(`File too large (${sizeMb} MB). Maximum is 5 MB.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/catalog/upload-photo", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      const { url, fileName } = await res.json();
      dispatch({ type: "SET_FIELD", field: "photoUrl", value: url });
      dispatch({ type: "SET_FIELD", field: "photoFileName", value: fileName });
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handlePhotoRemove() {
    if (state.photoUrl) {
      // Best-effort delete from blob storage
      fetch("/api/catalog/upload-photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: state.photoUrl }),
      }).catch(() => {});
    }
    dispatch({ type: "SET_FIELD", field: "photoUrl", value: "" });
    dispatch({ type: "SET_FIELD", field: "photoFileName", value: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {getCategoryFields(state.category).some((f) => f.required)
          ? "Fields marked with * are required. Fill in what you have for the rest."
          : "These fields are optional — fill what you have, skip the rest."}
      </p>

      {/* Category Specs */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Category Specifications
          {!getCategoryFields(state.category).some((f) => f.required) && <OptionalBadge />}
        </h3>
        <CategoryFields
          category={state.category}
          values={state.specValues}
          onChange={(key, value) => dispatch({ type: "SET_SPEC", key, value })}
          showTooltips={true}
          prefillFields={state.prefillFields}
          onClearPrefill={(key) => dispatch({ type: "CLEAR_PREFILL_FIELD", field: `spec.${key}` })}
          errors={errors}
          touchedFields={touchedFields}
          onFieldBlur={onFieldBlur}
        />
      </div>

      {/* Pricing */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Pricing & Unit <OptionalBadge />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={fieldClass("unitCost")} onBlur={() => onFieldBlur?.("unitCost")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Unit Cost ($)
              <FieldTooltip text="Your cost to purchase this item from the vendor" />
            </label>
            <input
              type="number"
              step="any"
              value={state.unitCost}
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "unitCost", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "unitCost" }); }}
              className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("unitCost")} ${inputWarningClass("unitCost")}`}
            />
            {fieldError("unitCost") && <p className="mt-1 text-xs text-red-400">{fieldError("unitCost")}</p>}
            {!fieldError("unitCost") && fieldWarning("unitCost") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("unitCost")}</p>}
          </div>
          <div className={fieldClass("sellPrice")} onBlur={() => onFieldBlur?.("sellPrice")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Sell Price ($)
              <FieldTooltip text="The price charged to the customer" />
            </label>
            <input
              type="number"
              step="any"
              value={state.sellPrice}
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "sellPrice", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "sellPrice" }); }}
              className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("sellPrice")} ${inputWarningClass("sellPrice")}`}
            />
            {fieldError("sellPrice") && <p className="mt-1 text-xs text-red-400">{fieldError("sellPrice")}</p>}
            {!fieldError("sellPrice") && fieldWarning("sellPrice") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("sellPrice")}</p>}
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
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "unitSpec", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "unitSpec" }); }}
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
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "unitLabel", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "unitLabel" }); }}
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
          <div className={fieldClass("length")} onBlur={() => onFieldBlur?.("length")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Length (in)
              <FieldTooltip text="Product length in inches" />
            </label>
            <input
              type="number"
              step="any"
              value={state.length}
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "length", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "length" }); }}
              className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("length")} ${inputWarningClass("length")}`}
            />
            {fieldError("length") && <p className="mt-1 text-xs text-red-400">{fieldError("length")}</p>}
            {!fieldError("length") && fieldWarning("length") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("length")}</p>}
          </div>
          <div className={fieldClass("width")} onBlur={() => onFieldBlur?.("width")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Width (in)
              <FieldTooltip text="Product width in inches" />
            </label>
            <input
              type="number"
              step="any"
              value={state.width}
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "width", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "width" }); }}
              className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("width")} ${inputWarningClass("width")}`}
            />
            {fieldError("width") && <p className="mt-1 text-xs text-red-400">{fieldError("width")}</p>}
            {!fieldError("width") && fieldWarning("width") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("width")}</p>}
          </div>
          <div className={fieldClass("weight")} onBlur={() => onFieldBlur?.("weight")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Weight (lbs)
              <FieldTooltip text="Product weight in pounds" />
            </label>
            <input
              type="number"
              step="any"
              value={state.weight}
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "weight", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "weight" }); }}
              className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${inputErrorClass("weight")} ${inputWarningClass("weight")}`}
            />
            {fieldError("weight") && <p className="mt-1 text-xs text-red-400">{fieldError("weight")}</p>}
            {!fieldError("weight") && fieldWarning("weight") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("weight")}</p>}
          </div>
          <div className={fieldClass("sku")}>
            <label className="block text-sm font-medium text-muted mb-1">
              SKU
              <FieldTooltip text="Internal product SKU for tracking" />
            </label>
            <input
              type="text"
              value={state.sku}
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "sku", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "sku" }); }}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("vendorName")} onBlur={() => onFieldBlur?.("vendorName")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Vendor Name
              <FieldTooltip text="Distributor or supplier name (e.g., CED, BayWa)" />
            </label>
            <VendorPicker
              vendorName={state.vendorName}
              zohoVendorId={state.zohoVendorId}
              onChange={(name, id) => {
                dispatch({ type: "SET_VENDOR", vendorName: name, zohoVendorId: id });
                dispatch({ type: "CLEAR_PREFILL_FIELD", field: "vendorName" });
              }}
              hint={state.vendorHint || undefined}
            />
            {fieldWarning("vendorName") && <p className="mt-1 text-xs text-amber-400">{fieldWarning("vendorName")}</p>}
          </div>
          <div className={fieldClass("vendorPartNumber")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Vendor Part #
              <FieldTooltip text="The part number used by the vendor/distributor" />
            </label>
            <input
              type="text"
              value={state.vendorPartNumber}
              onChange={(e) => { dispatch({ type: "SET_FIELD", field: "vendorPartNumber", value: e.target.value }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "vendorPartNumber" }); }}
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
            onClick={() => { dispatch({ type: "SET_FIELD", field: "hardToProcure", value: !state.hardToProcure }); dispatch({ type: "CLEAR_PREFILL_FIELD", field: "hardToProcure" }); }}
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

      {/* Product Photo */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Product Photo <OptionalBadge />
        </h3>
        <p className="text-xs text-muted mb-3">
          Upload a product image to sync to Zoho Inventory. JPEG, PNG, WebP, or GIF up to 5MB.
        </p>

        {photoError && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400 mb-3">
            {photoError}
          </div>
        )}

        {state.photoUrl ? (
          <div className="flex items-start gap-4">
            <div className="relative w-24 h-24 rounded-lg border border-t-border overflow-hidden bg-surface-2 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.photoUrl}
                alt="Product"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex flex-col gap-2 min-w-0">
              <span className="text-sm text-foreground truncate">{state.photoFileName}</span>
              <button
                type="button"
                onClick={handlePhotoRemove}
                className="text-xs text-red-400 hover:text-red-300 transition-colors self-start"
              >
                Remove photo
              </button>
            </div>
          </div>
        ) : (
          <label
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
              photoUploading
                ? "border-cyan-500/30 bg-cyan-500/5 cursor-wait"
                : "border-t-border hover:border-cyan-500/50 hover:bg-surface-2"
            }`}
          >
            {photoUploading ? (
              <>
                <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-2" />
                <span className="text-sm text-muted">Uploading...</span>
              </>
            ) : (
              <>
                <svg className="w-8 h-8 text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium text-foreground">Upload Product Photo</span>
                <span className="text-xs text-muted mt-1">Click or drag an image here</span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              disabled={photoUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
              }}
            />
          </label>
        )}
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
        <button
          type="button"
          onClick={onNext}
          className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition-colors"
        >
          Next: Review →
        </button>
      </div>
    </div>
  );
}
