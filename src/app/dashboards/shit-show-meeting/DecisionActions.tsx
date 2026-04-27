"use client";

import { useState } from "react";
import type { ShitShowItem, ShitShowDecision } from "./types";

const RATIONALE_REQUIRED: Record<ShitShowDecision, boolean> = {
  PENDING: false,
  RESOLVED: false,
  STILL_PROBLEM: true,
  ESCALATED: true,
  DEFERRED: true,
};

const BUTTONS: Array<{
  decision: ShitShowDecision;
  label: string;
  className: string;
  placeholder: string;
}> = [
  {
    decision: "RESOLVED",
    label: "Mark Resolved",
    className: "bg-emerald-700 hover:bg-emerald-600",
    placeholder: "What was resolved? (optional)",
  },
  {
    decision: "STILL_PROBLEM",
    label: "Mark Still a Problem",
    className: "bg-amber-700 hover:bg-amber-600",
    placeholder: "What's blocking progress?",
  },
  {
    decision: "ESCALATED",
    label: "Escalate",
    className: "bg-red-700 hover:bg-red-600",
    placeholder: "Why does this need escalation?",
  },
  {
    decision: "DEFERRED",
    label: "Defer",
    className: "bg-zinc-600 hover:bg-zinc-500",
    placeholder: "Why defer? When to revisit?",
  },
];

export function DecisionActions({
  item,
  onChanged,
}: {
  item: ShitShowItem;
  onChanged: () => Promise<void>;
}) {
  const [activeDecision, setActiveDecision] = useState<ShitShowDecision | null>(null);
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!activeDecision) return;
    if (RATIONALE_REQUIRED[activeDecision] && !rationale.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/shit-show-meeting/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: activeDecision,
          decisionRationale: rationale || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        alert(`Decision failed: ${j.error ?? res.status}`);
        return;
      }
      setActiveDecision(null);
      setRationale("");
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-muted mb-2">Decision</div>
      <div className="grid grid-cols-2 gap-2">
        {BUTTONS.map((b) => (
          <button
            key={b.decision}
            onClick={() => {
              setActiveDecision(b.decision);
              setRationale(item.decisionRationale ?? "");
            }}
            className={`text-white text-sm px-3 py-2 rounded transition ${b.className} ${
              item.decision === b.decision ? "ring-2 ring-white/40" : ""
            }`}
          >
            {b.label}
            {item.decision === b.decision && " ✓"}
          </button>
        ))}
      </div>

      {activeDecision && (
        <div className="mt-3 space-y-2">
          <textarea
            autoFocus
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            placeholder={
              BUTTONS.find((b) => b.decision === activeDecision)?.placeholder
            }
            className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setActiveDecision(null);
                setRationale("");
              }}
              className="text-sm text-muted hover:text-foreground px-3 py-1"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={
                submitting ||
                (RATIONALE_REQUIRED[activeDecision] && !rationale.trim())
              }
              className="bg-red-600 hover:bg-red-500 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
            >
              Submit decision
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
