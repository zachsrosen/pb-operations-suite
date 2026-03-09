"use client";

import { useState } from "react";

type ShadeSource = "google_solar" | "dxf_upload";

interface StepShadeSourceProps {
  initialSource: ShadeSource | null;
  onNext: (source: ShadeSource) => void;
  onBack: () => void;
  saving: boolean;
}

export default function StepShadeSource({
  initialSource,
  onNext,
  onBack,
  saving,
}: StepShadeSourceProps) {
  const [selected, setSelected] = useState<ShadeSource | null>(initialSource);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Shade Source</h2>
        <p className="text-sm text-muted mt-1">
          Choose how shade data will be sourced for this project.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={() => setSelected("google_solar")}
          className={`text-left p-4 rounded-lg border transition-colors ${
            selected === "google_solar"
              ? "border-orange-500/60 bg-orange-500/10"
              : "border-t-border bg-card hover:border-orange-500/30"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${
                selected === "google_solar"
                  ? "border-orange-500"
                  : "border-zinc-600"
              }`}
            >
              {selected === "google_solar" && (
                <div className="w-2 h-2 rounded-full bg-orange-500" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Google Solar API
              </p>
              <p className="text-xs text-muted mt-1">
                Automatic shade analysis from satellite imagery. Requires valid
                address with coordinates (configured in Classic).
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setSelected("dxf_upload")}
          className={`text-left p-4 rounded-lg border transition-colors ${
            selected === "dxf_upload"
              ? "border-orange-500/60 bg-orange-500/10"
              : "border-t-border bg-card hover:border-orange-500/30"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${
                selected === "dxf_upload"
                  ? "border-orange-500"
                  : "border-zinc-600"
              }`}
            >
              {selected === "dxf_upload" && (
                <div className="w-2 h-2 rounded-full bg-orange-500" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">DXF Upload</p>
              <p className="text-xs text-muted mt-1">
                Upload radiance DXF in Classic workspace. Use this when you have
                custom shade measurements.
              </p>
            </div>
          </div>
        </button>
      </div>

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
          onClick={() => selected && onNext(selected)}
          disabled={!selected || saving}
          className="px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {saving ? "Saving..." : "Next: Review"}
        </button>
      </div>
    </div>
  );
}
