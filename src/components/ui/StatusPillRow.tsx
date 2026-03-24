"use client";

import { memo } from "react";

interface StatusPillRowProps {
  stats: Record<string, number>;
  selected: string[];
  onToggle: (status: string) => void;
  getStatusColor: (status: string) => string;
  accentColor: string;
  getDisplayName?: (status: string) => string;
  maxVisible?: number;
}

const RING_CLASSES: Record<string, string> = {
  orange: "ring-orange-500",
  teal: "ring-teal-500",
  green: "ring-green-500",
  blue: "ring-blue-500",
  emerald: "ring-emerald-500",
  cyan: "ring-cyan-500",
};

export const StatusPillRow = memo(function StatusPillRow({
  stats,
  selected,
  onToggle,
  getStatusColor,
  accentColor,
  getDisplayName,
  maxVisible = 8,
}: StatusPillRowProps) {
  const sorted = Object.entries(stats)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const visible = sorted.slice(0, maxVisible);
  const hiddenCount = sorted.length - visible.length;
  const ringClass = RING_CLASSES[accentColor] || RING_CLASSES.orange;

  return (
    <div className="bg-surface border border-t-border rounded-lg p-3 mb-6">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-muted text-xs mr-1">Status:</span>
        {visible.map(([status, count]) => {
          const isActive = selected.includes(status);
          const colorClass = getStatusColor(status);
          const label = getDisplayName ? getDisplayName(status) : status;
          return (
            <button
              key={status}
              onClick={() => onToggle(status)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${colorClass} ${
                isActive ? `ring-1 ${ringClass}` : ""
              }`}
            >
              {label} <span className="font-bold">{count}</span>
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs text-muted bg-surface-2">
            +{hiddenCount} more
          </span>
        )}
      </div>
    </div>
  );
});
