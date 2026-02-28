"use client";

import DashboardShell from "@/components/DashboardShell";
import {
  FORM_CATEGORIES,
  getCategoryLabel,
  getCategoryFields,
} from "@/lib/catalog-fields";
import CategoryFields from "@/components/catalog/CategoryFields";
import BrandDropdown from "@/components/catalog/BrandDropdown";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, Suspense, useMemo } from "react";

const inputClasses =
  "w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50";
const labelClasses = "block text-sm font-medium text-muted mb-1";
const cardClasses =
  "bg-surface rounded-xl border border-t-border p-6 shadow-card";
const sectionTitleClasses = "text-lg font-semibold text-foreground mb-4";

const SYSTEM_OPTIONS = ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO", "QUICKBOOKS"] as const;

interface CachedQuickBooksProduct {
  externalId: string;
  name: string | null;
  sku: string | null;
  description: string | null;
  price: number | null;
}

interface ExistingSkuMatch {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  sku: string | null;
  vendorPartNumber: string | null;
  isActive: boolean;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  zohoItemId: string | null;
  quickbooksItemId: string | null;
}

function NewProductForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [category, setCategory] = useState<string>("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorPartNumber, setVendorPartNumber] = useState("");
  const [unitSpec, setUnitSpec] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [hardToProcure, setHardToProcure] = useState(false);
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [weight, setWeight] = useState("");
  const [specValues, setSpecValues] = useState<Record<string, unknown>>({});
  const [systems, setSystems] = useState<Set<string>>(new Set(["INTERNAL"]));
  const [quickbooksSearch, setQuickbooksSearch] = useState("");
  const [quickbooksLoading, setQuickbooksLoading] = useState(false);
  const [quickbooksError, setQuickbooksError] = useState<string | null>(null);
  const [quickbooksResults, setQuickbooksResults] = useState<CachedQuickBooksProduct[]>([]);
  const [selectedQuickbooksItemId, setSelectedQuickbooksItemId] = useState<string | null>(null);
  const [existingMatchesLoading, setExistingMatchesLoading] = useState(false);
  const [existingMatchesError, setExistingMatchesError] = useState<string | null>(null);
  const [existingMatches, setExistingMatches] = useState<ExistingSkuMatch[]>([]);
  const [mergeSourceSkuId, setMergeSourceSkuId] = useState("");
  const [mergeTargetSkuId, setMergeTargetSkuId] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Prefill from URL params
  useEffect(() => {
    const cat = searchParams.get("category");
    const b = searchParams.get("brand");
    const m = searchParams.get("model");
    const desc = searchParams.get("description");
    const us = searchParams.get("unitSpec");
    const ul = searchParams.get("unitLabel");

    if (cat) setCategory(cat);
    if (b) setBrand(b);
    if (m) setModel(m);
    if (desc) setDescription(desc);
    if (us) setUnitSpec(us);
    if (ul) setUnitLabel(ul);
  }, [searchParams]);

  function handleCategoryChange(cat: string) {
    setCategory(cat);
    setSpecValues({});
  }

  function toggleSystem(sys: string) {
    if (sys === "INTERNAL") return; // can't uncheck INTERNAL
    setSystems((prev) => {
      const next = new Set(prev);
      if (next.has(sys)) {
        next.delete(sys);
        if (sys === "QUICKBOOKS") {
          setQuickbooksSearch("");
          setQuickbooksResults([]);
          setQuickbooksError(null);
          setSelectedQuickbooksItemId(null);
        }
      } else {
        next.add(sys);
        if (sys === "QUICKBOOKS" && !quickbooksSearch.trim()) {
          const seed = [sku, vendorPartNumber, `${brand} ${model}`, model]
            .map((v) => String(v || "").trim())
            .find(Boolean);
          if (seed) setQuickbooksSearch(seed);
        }
      }
      return next;
    });
  }

  useEffect(() => {
    if (!systems.has("QUICKBOOKS")) return;
    const seeded = [sku, vendorPartNumber, `${brand} ${model}`, model]
      .map((v) => String(v || "").trim())
      .find(Boolean);
    if (seeded && !quickbooksSearch.trim()) {
      setQuickbooksSearch(seeded);
    }
  }, [systems, sku, vendorPartNumber, brand, model, quickbooksSearch]);

  useEffect(() => {
    if (!systems.has("QUICKBOOKS")) return;
    const search = quickbooksSearch.trim();
    if (!search) {
      setQuickbooksResults([]);
      setQuickbooksError(null);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setQuickbooksLoading(true);
      setQuickbooksError(null);
      try {
        const res = await fetch(
          `/api/products/cache?source=quickbooks&search=${encodeURIComponent(search)}&limit=12`,
          { cache: "no-store" }
        );
        const payload = (await res.json().catch(() => null)) as
          | { error?: string; products?: CachedQuickBooksProduct[] }
          | null;
        if (!res.ok) {
          throw new Error(payload?.error || `QuickBooks search failed (${res.status})`);
        }
        if (cancelled) return;
        setQuickbooksResults(Array.isArray(payload?.products) ? payload.products : []);
      } catch (err) {
        if (cancelled) return;
        setQuickbooksResults([]);
        setQuickbooksError(err instanceof Error ? err.message : "QuickBooks search failed");
      } finally {
        if (!cancelled) setQuickbooksLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [systems, quickbooksSearch]);

  const existingLookupQuery = useMemo(() => {
    return [sku, vendorPartNumber, `${brand} ${model}`, model]
      .map((value) => String(value || "").trim())
      .find((value) => value.length >= 2) || "";
  }, [brand, model, sku, vendorPartNumber]);

  useEffect(() => {
    const query = existingLookupQuery.trim();
    if (!query) {
      setExistingMatches([]);
      setExistingMatchesError(null);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setExistingMatchesLoading(true);
      setExistingMatchesError(null);
      try {
        const res = await fetch(
          `/api/inventory/skus?search=${encodeURIComponent(query)}&limit=20`,
          { cache: "no-store" }
        );
        const payload = (await res.json().catch(() => null)) as
          | { error?: string; skus?: ExistingSkuMatch[] }
          | null;
        if (!res.ok) {
          throw new Error(payload?.error || `Lookup failed (${res.status})`);
        }
        if (cancelled) return;
        const matches = Array.isArray(payload?.skus) ? payload.skus : [];
        setExistingMatches(matches);
      } catch (lookupError) {
        if (cancelled) return;
        setExistingMatches([]);
        setExistingMatchesError(lookupError instanceof Error ? lookupError.message : "Lookup failed");
      } finally {
        if (!cancelled) setExistingMatchesLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [existingLookupQuery]);

  useEffect(() => {
    if (existingMatches.length < 2) {
      setMergeSourceSkuId("");
      setMergeTargetSkuId("");
      return;
    }
    const ids = new Set(existingMatches.map((match) => match.id));
    if (mergeSourceSkuId && !ids.has(mergeSourceSkuId)) setMergeSourceSkuId("");
    if (mergeTargetSkuId && !ids.has(mergeTargetSkuId)) setMergeTargetSkuId("");
  }, [existingMatches, mergeSourceSkuId, mergeTargetSkuId]);

  async function handleMergeMatches() {
    setError(null);
    setMergeMessage(null);
    if (!mergeSourceSkuId || !mergeTargetSkuId) {
      setMergeMessage("Select both source and target SKUs to merge.");
      return;
    }
    if (mergeSourceSkuId === mergeTargetSkuId) {
      setMergeMessage("Source and target must be different SKUs.");
      return;
    }

    setMergeBusy(true);
    try {
      const res = await fetch("/api/inventory/skus/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceSkuId: mergeSourceSkuId,
          targetSkuId: mergeTargetSkuId,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { error?: string; conflicts?: string[] }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error || `Merge failed (${res.status})`);
      }

      const conflicts = Array.isArray(payload?.conflicts) ? payload.conflicts : [];
      const conflictNote = conflicts.length > 0 ? ` Conflicts kept on target: ${conflicts.join("; ")}` : "";
      setMergeMessage(`Merge complete.${conflictNote}`);
      setExistingMatches((prev) => prev.filter((match) => match.id !== mergeSourceSkuId));
      setMergeSourceSkuId("");
    } catch (mergeError) {
      setMergeMessage(mergeError instanceof Error ? mergeError.message : "Merge failed");
    } finally {
      setMergeBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload = {
        brand,
        model,
        description,
        category,
        unitSpec: unitSpec || null,
        unitLabel: unitLabel || null,
        sku: sku || null,
        vendorName: vendorName || null,
        vendorPartNumber: vendorPartNumber || null,
        unitCost: unitCost ? parseFloat(unitCost) : null,
        sellPrice: sellPrice ? parseFloat(sellPrice) : null,
        hardToProcure,
        length: length ? parseFloat(length) : null,
        width: width ? parseFloat(width) : null,
        weight: weight ? parseFloat(weight) : null,
        metadata: Object.keys(specValues).length > 0 ? specValues : null,
        systems: Array.from(systems),
        quickbooksItemId:
          systems.has("QUICKBOOKS") && selectedQuickbooksItemId
            ? selectedQuickbooksItemId
            : null,
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

  const categoryHasFields = category && getCategoryFields(category).length > 0;

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
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section 1: Category Selector */}
      <div>
        <h2 className={sectionTitleClasses}>Category</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {FORM_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => handleCategoryChange(cat)}
              className={`px-4 py-3 rounded-lg border text-sm font-medium cursor-pointer transition-all ${
                category === cat
                  ? "border-cyan-500 bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/50"
                  : "border-t-border bg-surface-2 text-muted hover:bg-surface hover:text-foreground"
              }`}
            >
              {getCategoryLabel(cat)}
            </button>
          ))}
        </div>
      </div>

      {/* Section 2: Product Identity */}
      {category && (
        <div className={cardClasses}>
          <h2 className={sectionTitleClasses}>Product Identity</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClasses}>Brand <span className="text-red-400">*</span></label>
              <BrandDropdown value={brand} onChange={setBrand} />
            </div>
            <div>
              <label className={labelClasses}>Model / Part # <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. REC-400AA"
                required
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>SKU</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Internal SKU"
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Vendor Name</label>
              <input
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="e.g. BayWa r.e."
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Vendor Part #</label>
              <input
                type="text"
                value={vendorPartNumber}
                onChange={(e) => setVendorPartNumber(e.target.value)}
                placeholder="Vendor part number"
                className={inputClasses}
              />
            </div>
          </div>
          <div className="mt-4">
            <label className={labelClasses}>Description <span className="text-red-400">*</span></label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Product description..."
              required
              className={inputClasses}
            />
          </div>

          <div className="mt-4 rounded-lg border border-t-border bg-surface-2 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">Existing Internal SKU Lookup</div>
              {existingLookupQuery.trim() && (
                <div className="text-xs text-muted">Query: {existingLookupQuery.trim()}</div>
              )}
            </div>

            {existingMatchesLoading && (
              <div className="text-xs text-muted">Searching existing internal SKUs...</div>
            )}
            {existingMatchesError && (
              <div className="text-xs text-red-400">{existingMatchesError}</div>
            )}
            {!existingMatchesLoading && !existingMatchesError && existingLookupQuery.trim() && existingMatches.length === 0 && (
              <div className="text-xs text-muted">No existing internal SKU matches found.</div>
            )}

            {existingMatches.length > 0 && (
              <div className="space-y-2">
                <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                  {existingMatches.length} existing SKU match{existingMatches.length === 1 ? "" : "es"} found. Review before submitting a new item.
                </div>
                <div className="max-h-56 overflow-y-auto rounded border border-t-border">
                  {existingMatches.map((match) => (
                    <div key={match.id} className="flex items-start justify-between gap-3 border-b border-t-border px-3 py-2 last:border-b-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {match.brand} {match.model}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {getCategoryLabel(match.category)} · SKU: {match.sku || "—"} · Vendor Part: {match.vendorPartNumber || "—"}
                        </div>
                        <div className="truncate text-[11px] text-muted">
                          HS: {match.hubspotProductId || "—"} · Zu: {match.zuperItemId || "—"} · Zoho: {match.zohoItemId || "—"} · QB: {match.quickbooksItemId || "—"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => router.push(`/dashboards/catalog/edit/${encodeURIComponent(match.id)}`)}
                        className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/20"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {existingMatches.length >= 2 && (
              <div className="rounded border border-t-border bg-surface p-2.5 space-y-2">
                <div className="text-xs font-medium text-foreground">Merge Existing Duplicates</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="text-[11px] text-muted">
                    Source SKU (will be merged into target and removed)
                    <select
                      value={mergeSourceSkuId}
                      onChange={(e) => setMergeSourceSkuId(e.target.value)}
                      className="mt-1 w-full rounded border border-t-border bg-surface-2 px-2 py-1.5 text-xs text-foreground"
                    >
                      <option value="">Select source SKU</option>
                      {existingMatches.map((match) => (
                        <option key={match.id} value={match.id}>
                          {match.brand} {match.model} ({match.id.slice(-6)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-muted">
                    Target SKU (kept)
                    <select
                      value={mergeTargetSkuId}
                      onChange={(e) => setMergeTargetSkuId(e.target.value)}
                      className="mt-1 w-full rounded border border-t-border bg-surface-2 px-2 py-1.5 text-xs text-foreground"
                    >
                      <option value="">Select target SKU</option>
                      {existingMatches.map((match) => (
                        <option key={match.id} value={match.id}>
                          {match.brand} {match.model} ({match.id.slice(-6)})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleMergeMatches}
                    disabled={mergeBusy || !mergeSourceSkuId || !mergeTargetSkuId || mergeSourceSkuId === mergeTargetSkuId}
                    className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mergeBusy ? "Merging..." : "Merge Source Into Target"}
                  </button>
                  {mergeMessage && (
                    <div className="text-xs text-muted">{mergeMessage}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 3: Category Specifications */}
      {categoryHasFields && (
        <div className={cardClasses}>
          <CategoryFields
            category={category}
            values={specValues}
            onChange={(key, value) =>
              setSpecValues((prev) => ({ ...prev, [key]: value }))
            }
          />
        </div>
      )}

      {/* Section 4: Pricing & Physical Details */}
      {category && (
        <div className={cardClasses}>
          <h2 className={sectionTitleClasses}>Pricing &amp; Physical Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelClasses}>Unit Cost ($)</label>
              <input
                type="number"
                step="any"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="0.00"
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Sell Price ($)</label>
              <input
                type="number"
                step="any"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="0.00"
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Unit Spec</label>
              <input
                type="number"
                step="any"
                value={unitSpec}
                onChange={(e) => setUnitSpec(e.target.value)}
                placeholder="e.g. 410"
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Unit Label</label>
              <input
                type="text"
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                placeholder="e.g. W, kWh, A"
                className={inputClasses}
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
              <label className="text-sm font-medium text-muted">
                Hard to Procure
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={hardToProcure}
                onClick={() => setHardToProcure(!hardToProcure)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                  hardToProcure ? "bg-cyan-500" : "bg-zinc-600"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                    hardToProcure ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <div>
              <label className={labelClasses}>Length</label>
              <input
                type="number"
                step="any"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="inches"
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Width</label>
              <input
                type="number"
                step="any"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="inches"
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>Weight (lbs)</label>
              <input
                type="number"
                step="any"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="lbs"
                className={inputClasses}
              />
            </div>
          </div>
        </div>
      )}

      {/* Section 5: Push to Systems */}
      {category && (
        <div className={cardClasses}>
          <h2 className={sectionTitleClasses}>Push to Systems</h2>
          <div className="flex flex-wrap gap-4">
            {SYSTEM_OPTIONS.map((sys) => {
              const checked = systems.has(sys);
              const disabled = sys === "INTERNAL";
              return (
                <label
                  key={sys}
                  className={`flex items-center gap-2 text-sm ${
                    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleSystem(sys)}
                    className="h-4 w-4 rounded border-t-border bg-surface-2 text-cyan-500 focus:ring-cyan-500/50 accent-cyan-500"
                  />
                  <span className="text-foreground font-medium">
                    {sys === "INTERNAL"
                      ? "Internal"
                      : sys === "HUBSPOT"
                        ? "HubSpot"
                        : sys === "ZUPER"
                          ? "Zuper"
                          : sys === "ZOHO"
                            ? "Zoho"
                            : "QuickBooks"}
                  </span>
                </label>
              );
            })}
          </div>

          {systems.has("QUICKBOOKS") && (
            <div className="mt-4 space-y-2 rounded-lg border border-t-border bg-surface-2 p-3">
              <div>
                <label className={labelClasses}>QuickBooks Match (Optional, Recommended)</label>
                <input
                  type="text"
                  value={quickbooksSearch}
                  onChange={(e) => setQuickbooksSearch(e.target.value)}
                  placeholder="Search QuickBooks by SKU, name, or item ID"
                  className={inputClasses}
                />
              </div>
              <div className="text-xs text-muted">
                Select the exact QuickBooks item to avoid ambiguous auto-matching during approval.
              </div>

              {quickbooksLoading && (
                <div className="text-xs text-muted">Searching QuickBooks cache...</div>
              )}
              {quickbooksError && (
                <div className="text-xs text-red-400">{quickbooksError}</div>
              )}

              {!quickbooksLoading && !quickbooksError && quickbooksSearch.trim() && quickbooksResults.length === 0 && (
                <div className="text-xs text-muted">No QuickBooks products found for this search.</div>
              )}

              {quickbooksResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded border border-t-border">
                  {quickbooksResults.map((product) => {
                    const isSelected = selectedQuickbooksItemId === product.externalId;
                    return (
                      <button
                        key={product.externalId}
                        type="button"
                        onClick={() => setSelectedQuickbooksItemId(product.externalId)}
                        className={`flex w-full items-start justify-between gap-3 border-b border-t-border px-3 py-2 text-left last:border-b-0 ${
                          isSelected ? "bg-cyan-500/10" : "hover:bg-surface"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {product.name || "Unnamed QuickBooks Product"}
                          </div>
                          <div className="truncate text-xs text-muted">
                            SKU: {product.sku || "—"} · ID: {product.externalId}
                          </div>
                        </div>
                        {isSelected && (
                          <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[11px] text-cyan-300">
                            Selected
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">
                  Selected QuickBooks ID: {selectedQuickbooksItemId || "Auto-match at approval"}
                </span>
                {selectedQuickbooksItemId && (
                  <button
                    type="button"
                    onClick={() => setSelectedQuickbooksItemId(null)}
                    className="rounded border border-t-border bg-surface px-2 py-1 text-muted hover:text-foreground"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Section 6: Footer */}
      {category && (
        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-t-border bg-surface px-6 py-2.5 text-sm font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !brand || !model || !description || !category}
            className="rounded-lg bg-cyan-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto"
          >
            {submitting ? "Submitting..." : "Submit for Approval"}
          </button>
        </div>
      )}
    </form>
  );
}

export default function NewProductPage() {
  return (
    <DashboardShell title="Add New Product" accentColor="cyan">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        }
      >
        <NewProductForm />
      </Suspense>
    </DashboardShell>
  );
}
