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

export default function PushToSystemsModal({ item, onClose }: Props) {
  const { addToast } = useToast();
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
          brand: item!.brand,
          model: item!.model,
          description: item!.description,
          category: item!.category,
          unitSpec: item!.unitSpec != null ? String(item!.unitSpec) : undefined,
          unitLabel: item!.unitLabel ?? undefined,
          systems: Array.from(selected),
          dealId: item!.dealId,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      addToast({
        type: "success",
        title: "Submitted for approval",
        message: "An admin will review and push to selected systems.",
      });
      onClose();
    } catch (err: unknown) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to submit",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface rounded-xl shadow-card-lg border border-t-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-border">
          <h2 className="text-sm font-semibold text-foreground">Add to Systems</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg leading-none">✕</button>
        </div>

        {/* Item preview */}
        <div className="px-5 py-3 border-b border-t-border bg-surface-2">
          <div className="text-xs text-muted uppercase tracking-wide mb-1">{item.category}</div>
          <div className="font-medium text-sm text-foreground">{item.brand} — {item.model}</div>
          <div className="text-xs text-muted mt-0.5 truncate">{item.description}</div>
        </div>

        {/* System checkboxes */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-muted">Select systems to push this item to:</p>
          {SYSTEMS.map(({ key, label, description }) => (
            <label key={key} className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => toggle(key)}
                className="mt-0.5 accent-cyan-500"
              />
              <div>
                <div className="text-sm font-medium text-foreground group-hover:text-cyan-400 transition-colors">{label}</div>
                <div className="text-xs text-muted">{description}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-t-border flex items-center justify-end gap-3">
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
