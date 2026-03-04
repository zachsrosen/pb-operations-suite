"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import CategoryFields from "@/components/catalog/CategoryFields";
import BrandDropdown from "@/components/catalog/BrandDropdown";
import { useToast } from "@/contexts/ToastContext";
import {
  FORM_CATEGORIES,
  getCategoryFields,
  getCategoryLabel,
} from "@/lib/catalog-fields";
import { getZohoItemUrl, getHubSpotProductUrl, getZuperProductUrl } from "@/lib/external-links";

const inputClasses =
  "w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50";
const labelClasses = "block text-sm font-medium text-muted mb-1";
const cardClasses = "bg-surface rounded-xl border border-t-border p-6 shadow-card";
const sectionTitleClasses = "text-lg font-semibold text-foreground mb-4";

interface EditableSku {
  id: string;
  name: string | null;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  vendorName: string | null;
  vendorPartNumber: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  sku: string | null;
  hardToProcure: boolean;
  length: number | null;
  width: number | null;
  weight: number | null;
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

function toInputNumber(value: number | null): string {
  return value == null ? "" : String(value);
}

export default function CatalogSkuEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { addToast } = useToast();

  const skuId = useMemo(() => {
    const value = params?.id;
    return typeof value === "string" ? value : "";
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [name, setName] = useState("");
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
  const [zohoItemId, setZohoItemId] = useState("");
  const [hubspotProductId, setHubspotProductId] = useState("");
  const [zuperItemId, setZuperItemId] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!skuId) {
      setLoadError("Missing SKU id");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadSku() {
      setLoading(true);
      setLoadError(null);

      try {
        const res = await fetch("/api/inventory/skus?active=false", { cache: "no-store" });
        const body = await res.json().catch(() => null) as { error?: string; skus?: EditableSku[] } | null;
        if (!res.ok) throw new Error(body?.error || `Failed to load SKUs (${res.status})`);

        const found = (body?.skus || []).find((item) => item.id === skuId);
        if (!found) throw new Error("SKU not found");
        if (cancelled) return;

        setCategory(found.category);
        setBrand(found.brand);
        setModel(found.model);
        setName(found.name ?? "");
        setSku(found.sku ?? "");
        setDescription(found.description ?? "");
        setVendorName(found.vendorName ?? "");
        setVendorPartNumber(found.vendorPartNumber ?? "");
        setUnitSpec(toInputNumber(found.unitSpec));
        setUnitLabel(found.unitLabel ?? "");
        setUnitCost(toInputNumber(found.unitCost));
        setSellPrice(toInputNumber(found.sellPrice));
        setHardToProcure(Boolean(found.hardToProcure));
        setLength(toInputNumber(found.length));
        setWidth(toInputNumber(found.width));
        setWeight(toInputNumber(found.weight));
        setSpecValues(found.metadata ?? {});
        setZohoItemId(found.zohoItemId ?? "");
        setHubspotProductId(found.hubspotProductId ?? "");
        setZuperItemId(found.zuperItemId ?? "");
        setIsActive(found.isActive);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load SKU");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSku();
    return () => {
      cancelled = true;
    };
  }, [skuId]);

  function handleCategoryChange(nextCategory: string) {
    setCategory(nextCategory);
    setSpecValues({});
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!skuId) return;

    setSaving(true);
    setLoadError(null);

    try {
      const payload = {
        id: skuId,
        category,
        brand,
        model,
        name: name || null,
        description: description || null,
        sku: sku || null,
        vendorName: vendorName || null,
        vendorPartNumber: vendorPartNumber || null,
        unitSpec: unitSpec || null,
        unitLabel: unitLabel || null,
        unitCost: unitCost || null,
        sellPrice: sellPrice || null,
        hardToProcure,
        length: length || null,
        width: width || null,
        weight: weight || null,
        metadata: Object.keys(specValues).length > 0 ? specValues : null,
        zohoItemId: zohoItemId || null,
        hubspotProductId: hubspotProductId || null,
        zuperItemId: zuperItemId || null,
        isActive,
      };

      const res = await fetch("/api/inventory/skus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `Failed to update SKU (${res.status})`);

      addToast({ type: "success", title: "SKU updated" });
      router.push("/dashboards/catalog");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to update SKU");
      addToast({ type: "error", title: error instanceof Error ? error.message : "Failed to update SKU" });
    } finally {
      setSaving(false);
    }
  }

  const categoryHasFields = category && getCategoryFields(category).length > 0;

  return (
    <DashboardShell title="Edit Product" accentColor="cyan">
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {loadError}
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
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
                    required
                    className={inputClasses}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClasses}>
                    Product Name
                    {!name && <span className="text-muted font-normal ml-1">(auto from Brand + Model)</span>}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={name || `${brand} ${model}`.trim()}
                      onChange={(e) => setName(e.target.value)}
                      className={`${inputClasses} flex-1`}
                    />
                    {name && (
                      <button
                        type="button"
                        onClick={() => setName("")}
                        className="text-xs text-muted hover:text-foreground shrink-0"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className={labelClasses}>SKU</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Vendor Name</label>
                  <input
                    type="text"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    className={inputClasses}
                  />
                </div>
                <div>
                  <label className={labelClasses}>Vendor Part #</label>
                  <input
                    type="text"
                    value={vendorPartNumber}
                    onChange={(e) => setVendorPartNumber(e.target.value)}
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
                  className={inputClasses}
                />
              </div>
            </div>
          )}

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

          {category && (
            <div className={cardClasses}>
              <h2 className={sectionTitleClasses}>Pricing &amp; Physical Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className={labelClasses}>Unit Cost ($)</label>
                  <input type="number" step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className={inputClasses} />
                </div>
                <div>
                  <label className={labelClasses}>Sell Price ($)</label>
                  <input type="number" step="any" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} className={inputClasses} />
                </div>
                <div>
                  <label className={labelClasses}>Unit Spec</label>
                  <input type="number" step="any" value={unitSpec} onChange={(e) => setUnitSpec(e.target.value)} className={inputClasses} />
                </div>
                <div>
                  <label className={labelClasses}>Unit Label</label>
                  <input type="text" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className={inputClasses} />
                </div>
                <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
                  <label className="text-sm font-medium text-muted">Hard to Procure</label>
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
                  <input type="number" step="any" value={length} onChange={(e) => setLength(e.target.value)} className={inputClasses} />
                </div>
                <div>
                  <label className={labelClasses}>Width</label>
                  <input type="number" step="any" value={width} onChange={(e) => setWidth(e.target.value)} className={inputClasses} />
                </div>
                <div>
                  <label className={labelClasses}>Weight (lbs)</label>
                  <input type="number" step="any" value={weight} onChange={(e) => setWeight(e.target.value)} className={inputClasses} />
                </div>
              </div>
            </div>
          )}

          {category && (
            <div className={cardClasses}>
              <h2 className={sectionTitleClasses}>System IDs &amp; Status</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelClasses}>Zoho Item ID</label>
                  <div className="flex items-center gap-1">
                    <input type="text" value={zohoItemId} onChange={(e) => setZohoItemId(e.target.value)} className={`${inputClasses} flex-1 min-w-0`} />
                    {zohoItemId && (
                      <a href={getZohoItemUrl(zohoItemId)} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 shrink-0" title="Open in Zoho">&#8599;</a>
                    )}
                  </div>
                </div>
                <div>
                  <label className={labelClasses}>HubSpot Product ID</label>
                  <div className="flex items-center gap-1">
                    <input type="text" value={hubspotProductId} onChange={(e) => setHubspotProductId(e.target.value)} className={`${inputClasses} flex-1 min-w-0`} />
                    {hubspotProductId && (
                      <a href={getHubSpotProductUrl(hubspotProductId)} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 shrink-0" title="Open in HubSpot">&#8599;</a>
                    )}
                  </div>
                </div>
                <div>
                  <label className={labelClasses}>Zuper Item ID</label>
                  <div className="flex items-center gap-1">
                    <input type="text" value={zuperItemId} onChange={(e) => setZuperItemId(e.target.value)} className={`${inputClasses} flex-1 min-w-0`} />
                    {zuperItemId && (
                      <a href={getZuperProductUrl(zuperItemId)} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 shrink-0" title="Open in Zuper">&#8599;</a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-muted">Active</label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    onClick={() => setIsActive(!isActive)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                      isActive ? "bg-cyan-500" : "bg-zinc-600"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                        isActive ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push("/dashboards/catalog")}
              className="rounded-lg border border-t-border bg-surface px-6 py-2.5 text-sm font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !brand || !model || !category}
              className="rounded-lg bg-cyan-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full sm:w-auto"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      )}
    </DashboardShell>
  );
}
