"use client";
import { useEffect, useMemo, useState } from "react";
import BrandDropdown from "./BrandDropdown";
import { FORM_CATEGORIES, getCategoryLabel } from "@/lib/catalog-fields";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";
import type { ValidationError, ValidationWarning } from "@/lib/catalog-form-state";

interface BasicsStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onCategoryChange?: (category: string) => void;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
  touchedFields?: Set<string>;
  onFieldBlur?: (field: string) => void;
  onNext: () => void;
  onBack?: () => void;
}

interface ExistingSkuMatch {
  id: string;
  category: string;
  brand: string;
  model: string;
  sku?: string;
  vendorPartNumber?: string;
  hubspotProductId?: string;
  zuperItemId?: string;
  zohoItemId?: string;
}

export default function BasicsStep({ state, dispatch, onCategoryChange, errors, warnings, touchedFields, onFieldBlur, onNext, onBack }: BasicsStepProps) {
  const [existingMatches, setExistingMatches] = useState<ExistingSkuMatch[]>([]);
  const [existingMatchesLoading, setExistingMatchesLoading] = useState(false);
  const [mergeSourceSkuId, setMergeSourceSkuId] = useState("");
  const [mergeTargetSkuId, setMergeTargetSkuId] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Multi-field duplicate lookup (same logic as current form: SKU, vendor part, brand+model, model)
  const existingLookupQuery = useMemo(() => {
    return [state.sku, state.vendorPartNumber, `${state.brand} ${state.model}`, state.model]
      .map((value) => String(value || "").trim())
      .find((value) => value.length >= 2) || "";
  }, [state.brand, state.model, state.sku, state.vendorPartNumber]);

  useEffect(() => {
    const query = existingLookupQuery.trim();
    if (!query) { setExistingMatches([]); setLookupError(null); return; }
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setExistingMatchesLoading(true);
      setLookupError(null);
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}`);
        if (cancelled) return;
        if (res.ok) {
          setExistingMatches(await res.json());
        } else {
          setExistingMatches([]);
          setLookupError("Duplicate check failed — please verify manually before submitting.");
        }
      } catch {
        if (!cancelled) {
          setExistingMatches([]);
          setLookupError("Could not check for duplicates — network error.");
        }
      } finally { if (!cancelled) setExistingMatchesLoading(false); }
    }, 500);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [existingLookupQuery]);

  // Merge handler (preserve existing merge workflow)
  async function handleMerge() {
    if (!mergeSourceSkuId || !mergeTargetSkuId || mergeSourceSkuId === mergeTargetSkuId) return;
    setMergeBusy(true);
    try {
      const res = await fetch("/api/inventory/products/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSkuId: mergeSourceSkuId, targetSkuId: mergeTargetSkuId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMergeMessage("Merge complete.");
      setExistingMatches((prev) => prev.filter((m) => m.id !== mergeSourceSkuId));
    } catch (e) {
      setMergeMessage(e instanceof Error ? e.message : "Merge failed");
    } finally { setMergeBusy(false); }
  }

  const canProceed = state.category && state.brand && state.model && state.description;

  const isPrefilled = (field: string) => state.prefillFields.has(field);

  return (
    <div className="space-y-6">
      {/* Category Selection */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Category <span className="text-red-400">*</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {FORM_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => onCategoryChange ? onCategoryChange(cat) : dispatch({ type: "SET_CATEGORY", category: cat })}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                state.category === cat
                  ? "bg-cyan-500/20 text-cyan-400 ring-2 ring-cyan-500"
                  : "bg-surface-2 text-muted hover:text-foreground hover:bg-surface-2/80"
              } ${isPrefilled("category") ? "border-l-2 border-l-green-400" : ""}`}
            >
              {getCategoryLabel(cat) || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Identity */}
      {state.category && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Product Identity</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={isPrefilled("brand") ? "border-l-2 border-l-green-400 pl-3" : ""}>
              <label className="block text-sm font-medium text-muted mb-1">
                Brand <span className="text-red-400">*</span>
              </label>
              <BrandDropdown
                value={state.brand}
                onChange={(v) => {
                  dispatch({ type: "SET_FIELD", field: "brand", value: v });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "brand" });
                }}
              />
            </div>
            <div className={isPrefilled("model") ? "border-l-2 border-l-green-400 pl-3" : ""}>
              <label className="block text-sm font-medium text-muted mb-1">
                Model / Part # <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={state.model}
                onChange={(e) => {
                  dispatch({ type: "SET_FIELD", field: "model", value: e.target.value });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "model" });
                }}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div className={`sm:col-span-2 ${isPrefilled("description") ? "border-l-2 border-l-green-400 pl-3" : ""}`}>
              <label className="block text-sm font-medium text-muted mb-1">
                Description <span className="text-red-400">*</span>
              </label>
              <textarea
                value={state.description}
                onChange={(e) => {
                  dispatch({ type: "SET_FIELD", field: "description", value: e.target.value });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "description" });
                }}
                rows={3}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            {/* SKU + Vendor Part # — in Basics so duplicate lookup can use them */}
            <div className={isPrefilled("sku") ? "border-l-2 border-l-green-400 pl-3" : ""}>
              <label className="block text-sm font-medium text-muted mb-1">
                SKU <span className="text-muted text-xs">(optional)</span>
              </label>
              <input
                type="text"
                value={state.sku}
                onChange={(e) => {
                  dispatch({ type: "SET_FIELD", field: "sku", value: e.target.value });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "sku" });
                }}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="e.g., QCE-400-B"
              />
            </div>
            <div className={isPrefilled("vendorPartNumber") ? "border-l-2 border-l-green-400 pl-3" : ""}>
              <label className="block text-sm font-medium text-muted mb-1">
                Vendor Part # <span className="text-muted text-xs">(optional)</span>
              </label>
              <input
                type="text"
                value={state.vendorPartNumber}
                onChange={(e) => {
                  dispatch({ type: "SET_FIELD", field: "vendorPartNumber", value: e.target.value });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "vendorPartNumber" });
                }}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="Manufacturer part number"
              />
            </div>
          </div>
        </div>
      )}

      {/* Existing Product Matches — full duplicate resolution workflow */}
      {existingMatches.length > 0 && (
        <div className="bg-amber-500/5 rounded-xl border border-amber-500/30 p-6">
          <h3 className="text-lg font-semibold text-amber-400 mb-3">
            ⚠ Existing Products Found ({existingMatches.length})
          </h3>
          <p className="text-sm text-muted mb-4">
            These products already exist with similar details. Open one to edit it, or merge duplicates below.
          </p>
          <div className="space-y-2 mb-4">
            {existingMatches.map((match) => (
              <div key={match.id} className="flex items-center justify-between bg-surface-2 rounded-lg p-3 text-sm">
                <div>
                  <span className="font-medium text-foreground">{match.brand} {match.model}</span>
                  <span className="text-muted ml-2">({match.category})</span>
                  {match.sku && <span className="text-muted ml-2">SKU: {match.sku}</span>}
                  {match.vendorPartNumber && <span className="text-muted ml-2">VP#: {match.vendorPartNumber}</span>}
                  <span className="ml-2 text-xs">
                    {match.hubspotProductId ? "✓HS" : "—"} {match.zuperItemId ? "✓ZP" : "—"} {match.zohoItemId ? "✓ZO" : "—"}
                  </span>
                </div>
                <a href={`/dashboards/catalog/edit/${encodeURIComponent(match.id)}`} target="_blank" className="text-cyan-400 hover:underline text-xs">
                  Open Existing →
                </a>
              </div>
            ))}
          </div>

          {/* Merge tool (same as current form) */}
          {existingMatches.length >= 2 && (
            <div className="border-t border-amber-500/20 pt-4 space-y-2">
              <p className="text-xs font-medium text-muted">Merge Duplicates</p>
              <div className="flex gap-2 items-end flex-wrap">
                <select value={mergeSourceSkuId} onChange={(e) => setMergeSourceSkuId(e.target.value)} className="rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-xs">
                  <option value="">Source (will be removed)</option>
                  {existingMatches.map((m) => <option key={m.id} value={m.id}>{m.brand} {m.model}</option>)}
                </select>
                <span className="text-xs text-muted">→</span>
                <select value={mergeTargetSkuId} onChange={(e) => setMergeTargetSkuId(e.target.value)} className="rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-xs">
                  <option value="">Target (keep)</option>
                  {existingMatches.map((m) => <option key={m.id} value={m.id}>{m.brand} {m.model}</option>)}
                </select>
                <button onClick={handleMerge} disabled={mergeBusy || !mergeSourceSkuId || !mergeTargetSkuId || mergeSourceSkuId === mergeTargetSkuId} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50">
                  {mergeBusy ? "Merging..." : "Merge"}
                </button>
              </div>
              {mergeMessage && <p className="text-xs text-muted">{mergeMessage}</p>}
            </div>
          )}
        </div>
      )}
      {existingMatchesLoading && <p className="text-xs text-muted animate-pulse">Checking for existing products...</p>}
      {lookupError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {lookupError}
        </div>
      )}

      {/* Confidence banner for prefilled */}
      {state.prefillSource && state.prefillFields.size > 0 && (
        <div className={`rounded-lg p-3 text-sm ${
          state.prefillSource === "clone"
            ? "bg-green-500/10 border border-green-500/30 text-green-400"
            : "bg-blue-500/10 border border-blue-500/30 text-blue-400"
        }`}>
          {state.prefillSource === "clone"
            ? `Cloned from existing product. ${state.prefillFields.size} fields pre-filled.`
            : `Extracted from datasheet. ${state.prefillFields.size} fields pre-filled. Please review highlighted values.`
          }
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            ← Back
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          disabled={!canProceed}
          onClick={onNext}
          className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next: Details →
        </button>
      </div>
    </div>
  );
}
