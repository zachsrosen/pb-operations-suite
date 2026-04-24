"use client";

import { useState } from "react";
import { OFFICES, type OfficeLocation } from "@/lib/map-offices";

interface OfficePickerProps {
  office: OfficeLocation | null;
  radiusMiles: number;
  onOfficeChange: (id: string | null) => void;
  onRadiusChange: (miles: number) => void;
}

const RADIUS_PRESETS = [5, 10, 15, 25, 50];

export function OfficePicker({
  office,
  radiusMiles,
  onOfficeChange,
  onRadiusChange,
}: OfficePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1 text-xs rounded border border-t-border bg-surface-2 text-foreground hover:bg-surface-elevated flex items-center gap-1"
        aria-haspopup="true"
        aria-expanded={open}
        title="Your office + nearby radius"
      >
        <span>🏢 {office ? office.label : "Set office"}</span>
        <span className="text-muted">· {radiusMiles} mi ▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute top-full mt-1 right-0 z-20 bg-surface border border-t-border rounded-lg shadow-xl p-3 min-w-[240px]">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">
              Your office
            </div>
            <div className="space-y-0.5 mb-3">
              {OFFICES.map((o) => {
                const selected = office?.id === o.id;
                return (
                  <label
                    key={o.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-2 cursor-pointer text-xs"
                  >
                    <input
                      type="radio"
                      name="office"
                      checked={selected}
                      onChange={() => {
                        onOfficeChange(o.id);
                        setOpen(false);
                      }}
                      className="accent-cyan-500"
                    />
                    <span className="text-foreground flex-1">{o.label}</span>
                  </label>
                );
              })}
              <button
                onClick={() => {
                  onOfficeChange(null);
                  setOpen(false);
                }}
                className="text-[10px] text-muted hover:text-foreground underline decoration-dotted mt-1 px-2"
              >
                Clear
              </button>
            </div>

            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">
              Nearby radius
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              {RADIUS_PRESETS.map((mi) => (
                <button
                  key={mi}
                  onClick={() => onRadiusChange(mi)}
                  className={`px-2 py-1 rounded text-[11px] border ${
                    radiusMiles === mi
                      ? "bg-cyan-500 border-cyan-500 text-white"
                      : "bg-surface-2 border-t-border text-foreground hover:bg-surface-elevated"
                  }`}
                >
                  {mi} mi
                </button>
              ))}
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={radiusMiles}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>
        </>
      )}
    </div>
  );
}
