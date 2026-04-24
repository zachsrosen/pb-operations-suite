"use client";

import { useState } from "react";
import { AdderCategory, AdderUnit } from "@/generated/prisma/enums";

const CATEGORY_LABELS: Record<string, string> = {
  ELECTRICAL: "Electrical",
  ROOFING: "Roofing",
  STRUCTURAL: "Structural",
  SITEWORK: "Sitework",
  LOGISTICS: "Logistics",
  DESIGN: "Design",
  PERMITTING: "Permitting",
  REMOVAL: "Removal / D&R",
  ORG: "Organizational",
  MISC: "Other",
};

const UNIT_LABELS: Record<string, string> = {
  FLAT: "Flat fee",
  PER_MODULE: "Per module",
  PER_KW: "Per kW",
  PER_LINEAR_FT: "Per linear foot",
  PER_HOUR: "Per hour",
  TIERED: "Tiered",
};

export default function AdderRequestForm({
  dealIdInitial,
  onSubmitted,
  onBack,
}: {
  dealIdInitial: string | null;
  onSubmitted: (title: string) => void;
  onBack: () => void;
}) {
  const [category, setCategory] = useState<string>(AdderCategory.ELECTRICAL);
  const [unit, setUnit] = useState<string>(AdderUnit.FLAT);
  const [name, setName] = useState("");
  const [estimatedPrice, setEstimatedPrice] = useState("");
  const [description, setDescription] = useState("");
  const [salesRequestNote, setSalesRequestNote] = useState("");
  const [dealId, setDealId] = useState<string>(dealIdInitial || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !salesRequestNote.trim()) {
      setError("Name and note are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/product-requests/adder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          unit,
          name: name.trim(),
          estimatedPrice: estimatedPrice.trim() ? Number(estimatedPrice.trim()) : null,
          description: description.trim() || null,
          salesRequestNote: salesRequestNote.trim(),
          dealId: dealId.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 409 && body?.duplicate) {
          setError(body.error || "This adder already exists.");
        } else {
          setError(body?.error || `Submission failed (${res.status})`);
        }
        setSubmitting(false);
        return;
      }
      onSubmitted(name.trim());
    } catch {
      setError("Network error — try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-t-border bg-surface p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Adder details</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted hover:text-foreground"
        >
          ← Change type
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1.5">Category *</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          >
            {Object.values(AdderCategory).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] || c}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1.5">Unit *</span>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          >
            {Object.values(AdderUnit).map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u] || u}
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="block text-xs font-medium text-muted mb-1.5">Name *</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main panel upgrade to 200A"
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1.5">
            Estimated price (optional)
          </span>
          <input
            type="number"
            step="0.01"
            value={estimatedPrice}
            onChange={(e) => setEstimatedPrice(e.target.value)}
            placeholder="1500"
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1.5">Deal ID (optional)</span>
          <input
            type="text"
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            placeholder="HubSpot deal ID"
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="block text-xs font-medium text-muted mb-1.5">
            Description (optional)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What it covers, when to use it."
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="block text-xs font-medium text-muted mb-1.5">
            Why do you need this? *
          </span>
          <textarea
            value={salesRequestNote}
            onChange={(e) => setSalesRequestNote(e.target.value)}
            rows={3}
            placeholder="Site condition at 123 Main St requires it; customer already signed off."
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-t-border bg-surface-2 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-elevated transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
