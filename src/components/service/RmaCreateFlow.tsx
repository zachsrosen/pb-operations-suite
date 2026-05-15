"use client";

import { useState } from "react";
import RmaProductPicker, { type RmaPickerItem } from "./RmaProductPicker";

interface Props {
  ticketId: string;
  ticketSubject: string;
  pbLocation: string | null;
  onCreated: () => void;
  onCancel: () => void;
}

type Step = "defective" | "replacement" | "review";

export default function RmaCreateFlow({
  ticketId,
  ticketSubject,
  pbLocation,
  onCreated,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>("defective");
  const [inboundItems, setInboundItems] = useState<RmaPickerItem[]>([]);
  const [outboundItems, setOutboundItems] = useState<RmaPickerItem[]>([]);
  const [location, setLocation] = useState(pbLocation ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDefectiveNext = () => {
    if (outboundItems.length === 0 && inboundItems.length > 0) {
      setOutboundItems(inboundItems.map((i) => ({ ...i })));
    }
    setStep("replacement");
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/service/rma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          ticketSubject,
          outboundItems,
          inboundItems: inboundItems.length > 0 ? inboundItems : undefined,
          pbLocation: location || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save RMA");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-t-border bg-surface-2 p-4 space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className={step === "defective" ? "text-cyan-400 font-medium" : ""}>
          1. Defective
        </span>
        <span>&rarr;</span>
        <span className={step === "replacement" ? "text-cyan-400 font-medium" : ""}>
          2. Replacement
        </span>
        <span>&rarr;</span>
        <span className={step === "review" ? "text-cyan-400 font-medium" : ""}>
          3. Review
        </span>
      </div>

      {step === "defective" && (
        <>
          <RmaProductPicker
            items={inboundItems}
            onItemsChange={setInboundItems}
            label="What's being replaced? (defective items)"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleDefectiveNext}
              disabled={inboundItems.length === 0}
              className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              Next
            </button>
            <button
              onClick={onCancel}
              className="text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {step === "replacement" && (
        <>
          <RmaProductPicker
            items={outboundItems}
            onItemsChange={setOutboundItems}
            label="What's being sent? (replacement items)"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep("review")}
              disabled={outboundItems.length === 0}
              className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              Next
            </button>
            <button
              onClick={() => setStep("defective")}
              className="text-sm text-muted hover:text-foreground"
            >
              Back
            </button>
          </div>
        </>
      )}

      {step === "review" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-medium text-muted mb-2">
                Defective (returning)
              </h4>
              <ul className="space-y-1">
                {inboundItems.map((i) => (
                  <li key={i.productId} className="text-sm text-foreground">
                    {i.brand} {i.model} &times;{i.quantity}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-medium text-muted mb-2">
                Replacement (sending)
              </h4>
              <ul className="space-y-1">
                {outboundItems.map((i) => (
                  <li key={i.productId} className="text-sm text-foreground">
                    {i.brand} {i.model} &times;{i.quantity}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted mb-1">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. DTC, Westminster"
                className="w-full bg-surface border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-surface border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none"
              />
            </div>
          </div>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save as Draft"}
            </button>
            <button
              onClick={() => setStep("replacement")}
              className="text-sm text-muted hover:text-foreground"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
