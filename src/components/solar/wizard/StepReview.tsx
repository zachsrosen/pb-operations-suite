"use client";

import { useState } from "react";

type Visibility = "TEAM" | "PRIVATE";

interface StepReviewProps {
  projectName: string;
  projectAddress: string;
  panelKey: string | null;
  inverterKey: string | null;
  essKey: string | null;
  optimizerKey: string | null;
  shadeSource: string | null;
  onFinish: (visibility: Visibility, setPreference: boolean) => void;
  onBack: () => void;
  onEditStep: (step: number) => void;
  saving: boolean;
}

export default function StepReview({
  projectName,
  projectAddress,
  panelKey,
  inverterKey,
  essKey,
  optimizerKey,
  shadeSource,
  onFinish,
  onBack,
  onEditStep,
  saving,
}: StepReviewProps) {
  const [visibility, setVisibility] = useState<Visibility>("TEAM");
  const [setPreference, setSetPreference] = useState(false);

  const formatKey = (key: string | null) =>
    key?.replace(/_/g, " ") ?? "None";

  const formatShade = (s: string | null) => {
    if (s === "google_solar") return "Google Solar API";
    if (s === "dxf_upload") return "DXF Upload";
    return "Not selected";
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Review &amp; Create
        </h2>
        <p className="text-sm text-muted mt-1">
          Review your selections before creating the project.
        </p>
      </div>

      {/* Summary sections */}
      <div className="space-y-3">
        <SummarySection
          title="Basics"
          step={0}
          onEdit={onEditStep}
          items={[
            { label: "Name", value: projectName },
            {
              label: "Address",
              value: projectAddress || "Not specified",
            },
          ]}
        />

        <SummarySection
          title="Equipment"
          step={1}
          onEdit={onEditStep}
          items={[
            { label: "Panel", value: formatKey(panelKey) },
            { label: "Inverter", value: formatKey(inverterKey) },
            { label: "ESS", value: formatKey(essKey) },
            { label: "Optimizer", value: formatKey(optimizerKey) },
          ]}
        />

        <SummarySection
          title="Shade Source"
          step={2}
          onEdit={onEditStep}
          items={[
            { label: "Method", value: formatShade(shadeSource) },
          ]}
        />
      </div>

      {/* Visibility selector */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">
          Project Visibility
        </h3>
        <div className="flex gap-3">
          <label
            className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors flex-1 ${
              visibility === "TEAM"
                ? "border-orange-500/60 bg-orange-500/10"
                : "border-t-border bg-card hover:border-orange-500/30"
            }`}
          >
            <input
              type="radio"
              name="visibility"
              value="TEAM"
              checked={visibility === "TEAM"}
              onChange={() => setVisibility("TEAM")}
              className="sr-only"
            />
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                visibility === "TEAM"
                  ? "border-orange-500"
                  : "border-zinc-600"
              }`}
            >
              {visibility === "TEAM" && (
                <div className="w-2 h-2 rounded-full bg-orange-500" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Team</p>
              <p className="text-[11px] text-muted">
                Visible to coworkers
              </p>
            </div>
          </label>

          <label
            className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors flex-1 ${
              visibility === "PRIVATE"
                ? "border-orange-500/60 bg-orange-500/10"
                : "border-t-border bg-card hover:border-orange-500/30"
            }`}
          >
            <input
              type="radio"
              name="visibility"
              value="PRIVATE"
              checked={visibility === "PRIVATE"}
              onChange={() => setVisibility("PRIVATE")}
              className="sr-only"
            />
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                visibility === "PRIVATE"
                  ? "border-orange-500"
                  : "border-zinc-600"
              }`}
            >
              {visibility === "PRIVATE" && (
                <div className="w-2 h-2 rounded-full bg-orange-500" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Private</p>
              <p className="text-[11px] text-muted">Only you</p>
            </div>
          </label>
        </div>
      </div>

      {/* Preference checkbox */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={setPreference}
          onChange={(e) => setSetPreference(e.target.checked)}
          className="mt-0.5 rounded border-zinc-600 bg-zinc-900 text-orange-500 focus:ring-orange-500/30"
        />
        <span className="text-xs text-muted">
          Always start with the setup wizard for new projects
        </span>
      </label>

      <div className="flex items-center justify-between pt-4 border-t border-t-border">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={() => onFinish(visibility, setPreference)}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {saving ? "Creating..." : "Create &amp; Open in Classic"}
        </button>
      </div>
    </div>
  );
}

function SummarySection({
  title,
  step,
  onEdit,
  items,
}: {
  title: string;
  step: number;
  onEdit: (step: number) => void;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-lg border border-t-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <button
          type="button"
          onClick={() => onEdit(step)}
          className="text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
        >
          Edit
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-muted">{item.label}</span>
            <span className="text-foreground truncate max-w-[60%] text-right">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
