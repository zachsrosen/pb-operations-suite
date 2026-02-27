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
import { useState, useEffect, Suspense } from "react";

const inputClasses =
  "w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50";
const labelClasses = "block text-sm font-medium text-muted mb-1";
const cardClasses =
  "bg-surface rounded-xl border border-t-border p-6 shadow-card";
const sectionTitleClasses = "text-lg font-semibold text-foreground mb-4";

const SYSTEM_OPTIONS = ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"] as const;

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
      } else {
        next.add(sys);
      }
      return next;
    });
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
              <label className={labelClasses}>Brand</label>
              <BrandDropdown value={brand} onChange={setBrand} />
            </div>
            <div>
              <label className={labelClasses}>Model / Part #</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. REC-400AA"
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
            <label className={labelClasses}>Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Product description..."
              className={inputClasses}
            />
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
                          : "Zoho"}
                  </span>
                </label>
              );
            })}
          </div>
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
            disabled={submitting || !brand || !category}
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
