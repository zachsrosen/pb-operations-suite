"use client";

import { useState } from "react";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";

const CATEGORY_LABELS: Record<string, string> = {
  MODULE: "Solar Module",
  BATTERY: "Battery",
  BATTERY_EXPANSION: "Battery Expansion",
  INVERTER: "Inverter",
  EV_CHARGER: "EV Charger",
  RAPID_SHUTDOWN: "Rapid Shutdown",
  RACKING: "Racking",
  ELECTRICAL_BOS: "Electrical BOS",
  MONITORING: "Monitoring",
  OPTIMIZER: "Optimizer",
  GATEWAY: "Gateway",
  D_AND_R: "D&R",
  SERVICE: "Service",
  ADDER_SERVICES: "Adder Services",
  TESLA_SYSTEM_COMPONENTS: "Tesla System Component",
};

export default function EquipmentRequestForm({
  dealIdInitial,
  onSubmitted,
  onBack,
}: {
  dealIdInitial: string | null;
  onSubmitted: (title: string) => void;
  onBack: () => void;
}) {
  const [category, setCategory] = useState<string>("MODULE");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [datasheetUrl, setDatasheetUrl] = useState("");
  const [salesRequestNote, setSalesRequestNote] = useState("");
  const [dealId, setDealId] = useState<string>(dealIdInitial || "");
  const [datasheetFile, setDatasheetFile] = useState<File | null>(null);
  const [extractedMetadata, setExtractedMetadata] = useState<Record<string, unknown> | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractWarning, setExtractWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    setDatasheetFile(file);
    setExtractedMetadata(null);
    setExtractWarning(null);
    if (!file) return;

    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      const res = await fetch("/api/catalog/extract-from-datasheet", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        setExtractWarning(
          "Couldn't auto-extract specs from this datasheet — we'll still save your request.",
        );
      } else {
        const body = await res.json();
        const extracted = (body?.extracted || body?.specs || null) as Record<
          string,
          unknown
        > | null;
        setExtractedMetadata(extracted);
      }
    } catch {
      setExtractWarning("Datasheet extraction failed — request will still be saved without it.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!brand.trim() || !model.trim() || !salesRequestNote.trim()) {
      setError("Brand, model, and note are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/product-requests/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          brand: brand.trim(),
          model: model.trim(),
          datasheetUrl: datasheetUrl.trim() || null,
          salesRequestNote: salesRequestNote.trim(),
          dealId: dealId.trim() || null,
          extractedMetadata,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 409 && body?.duplicate) {
          setError(body.error || "This product already exists.");
        } else {
          setError(body?.error || `Submission failed (${res.status})`);
        }
        setSubmitting(false);
        return;
      }
      onSubmitted(`${brand.trim()} ${model.trim()}`);
    } catch {
      setError("Network error — try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-t-border bg-surface p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Equipment details</h2>
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
            {FORM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] || c}
              </option>
            ))}
          </select>
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

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1.5">Brand *</span>
          <input
            type="text"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="e.g. REC"
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-muted mb-1.5">Model *</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Alpha Pure-R 410W"
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="block text-xs font-medium text-muted mb-1.5">Datasheet URL (optional)</span>
          <input
            type="url"
            value={datasheetUrl}
            onChange={(e) => setDatasheetUrl(e.target.value)}
            placeholder="https://manufacturer.com/datasheet.pdf"
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="block text-xs font-medium text-muted mb-1.5">
            Datasheet PDF (optional — we&apos;ll auto-extract specs)
          </span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-cyan-600 file:text-white file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
          {datasheetFile && extracting && (
            <div className="mt-2 text-xs text-muted">Extracting specs from datasheet…</div>
          )}
          {datasheetFile && !extracting && extractedMetadata && (
            <div className="mt-2 text-xs text-cyan-400">
              ✓ Specs extracted — Tech Ops will see them pre-filled.
            </div>
          )}
          {extractWarning && (
            <div className="mt-2 text-xs text-amber-400">{extractWarning}</div>
          )}
        </label>

        <label className="block md:col-span-2">
          <span className="block text-xs font-medium text-muted mb-1.5">
            Why do you need this? *
          </span>
          <textarea
            value={salesRequestNote}
            onChange={(e) => setSalesRequestNote(e.target.value)}
            rows={3}
            placeholder="Customer asked for this specifically — they saw it on another proposal."
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
          disabled={submitting || extracting}
          className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
