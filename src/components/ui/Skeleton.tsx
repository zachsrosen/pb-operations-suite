"use client";

import { memo } from "react";

/** Skeleton for a section with bars (stage breakdown, etc.) */
export const SkeletonSection = memo(function SkeletonSection({
  rows = 5,
}: {
  rows?: number;
}) {
  return (
    <div className="bg-surface/50 border border-t-border rounded-xl p-6 shadow-card mb-8 animate-pulse">
      <div className="h-6 w-48 bg-surface-2 rounded mb-4" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="w-40 h-4 bg-surface-2 rounded" />
            <div className="flex-1 h-6 bg-surface-2 rounded-full" />
            <div className="w-12 h-4 bg-surface-2 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
});

/** Skeleton for a table */
export const SkeletonTable = memo(function SkeletonTable({
  rows = 5,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="bg-surface border border-t-border rounded-xl p-5 shadow-card animate-pulse">
      <div className="h-5 w-40 bg-surface-2 rounded mb-4" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4">
            {Array.from({ length: cols }).map((_, j) => (
              <div
                key={j}
                className="flex-1 h-4 bg-surface-2 rounded"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});
