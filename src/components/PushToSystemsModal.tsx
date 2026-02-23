// src/components/PushToSystemsModal.tsx
"use client";

import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";

export interface PushItem {
  brand: string;
  model: string;
  description: string;
  category: string;
  unitSpec?: string | number | null;
  unitLabel?: string | null;
  dealId?: string;
}

interface Props {
  item: PushItem | null;
  onClose: () => void;
}

const SYSTEMS = [
  { key: "INTERNAL", label: "Internal Catalog", description: "Postgres EquipmentSku" },
  { key: "ZOHO",     label: "Zoho Inventory",   description: "Product in Zoho" },
  { key: "HUBSPOT",  label: "HubSpot Products",  description: "Product in HubSpot" },
  { key: "ZUPER",    label: "Zuper Parts",        description: "Part in Zuper" },
] as const;

const CATEGORIES = ["MODULE", "INVERTER", "BATTERY", "EV_CHARGER"] as const;

export default function PushToSystemsModal({ item, onClose }: Props) {
  const { addToast } = useToast();

  // Editable form state — pre-filled from the BOM row
  const [brand, setBrand] = useState(item?.brand ?? "");
  const [model, setModel] = useState(item?.model ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [unitSpec, setUnitSpec] = useState(item?.unitSpec != null ? String(item.unitSpec) : "");
  const [unitLabel, setUnitLabel] = useState(item?.unitLabel ?? "");

  const [selected, setSelected] = useState<Set<string>>(
    new Set(["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"])
  );
  const [submitting, setSubmitting] = useState(false);

  if (!item) return null;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSubmit() {
    if (!brand.trim() || !model.trim() || !description.trim() || !category.trim()) {
      addToast({ type: "error", title: "Brand, model, description, and category are required" });
      return;
    }
    if (selected.size === 0) {
      addToast({ type: "error", title: "Select at least one system" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/catalog/push-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: brand.trim(),
          model: model.trim(),
          description: description.trim(),
          category: category.trim(),
          unitSpec: unitSpec.trim() || undefined,
          unitLabel: unitLabel.trim() || undefined,
          systems: Array.from(selected),
          dealId: item.dealId,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      addToast({ type: "success", title: "Submitted for approval", message: "An admin will review and push to selected systems." });
      onClose();
    } catch (err: unknown) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Failed to submit" });
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50";
  const labelClass = "block text-xs font-medium text-muted mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-surface rounded-xl shadow-card-lg border border-t-border my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
          <h2 className="text-sm font-semibold text-foreground">Add to Systems</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg leading-none">✕</button>
        </div>

        {/* Editable item fields */}
        <div className="px-5 py-4 space-y-3 border-b border-t-border">
          <p className="text-xs text-muted">Review and edit item details before submitting:</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Brand</label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className={inputClass}
                placeholder="e.g. Tesla"
              />
            </div>
            <div>
              <label className={labelClass}>Model / Part Number</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={inputClass}
                placeholder="e.g. 1707000-XX-Y"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              placeholder="e.g. TESLA POWERWALL 3, 13.5kWh"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              >
                <option value="">Select category…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                {/* Allow non-enum categories from BOM */}
                {category && !(CATEGORIES as readonly string[]).includes(category) && (
                  <option value={category}>{category} (BOM only)</option>
                )}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Unit Spec</label>
                <input
                  type="text"
                  value={unitSpec}
                  onChange={(e) => setUnitSpec(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. 13.5"
                />
              </div>
              <div>
                <label className={labelClass}>Unit Label</label>
                <input
                  type="text"
                  value={unitLabel}
                  onChange={(e) => setUnitLabel(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. kWh"
                />
              </div>
            </div>
          </div>
        </div>

        {/* System checkboxes */}
        <div className="px-5 py-4 space-y-3 border-b border-t-border">
          <p className="text-xs text-muted">Select systems to push this item to:</p>
          {SYSTEMS.map(({ key, label, description: sysDesc }) => (
            <label key={key} className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => toggle(key)}
                className="mt-0.5 accent-cyan-500"
              />
              <div>
                <div className="text-sm font-medium text-foreground group-hover:text-cyan-400 transition-colors">{label}</div>
                <div className="text-xs text-muted">{sysDesc}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground border border-t-border hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || selected.size === 0}
            className="px-4 py-2 rounded-lg text-sm bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Submitting…" : "Submit for Approval"}
          </button>
        </div>
      </div>
    </div>
  );
}
