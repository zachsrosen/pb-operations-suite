"use client";

import type { EnrichedVisionResult } from "@/lib/pe-vision-classifier";

interface ChecklistCardItem {
  id: string;
  label: string;
  category: string;
  isPhoto: boolean;
  pePhotoNumber?: number;
}

interface ChecklistCardResult {
  item: ChecklistCardItem;
  status: "found" | "likely" | "missing" | "needs_review" | "not_applicable" | "error";
  statusNote?: string;
  foundFile?: {
    name: string;
    id: string;
    url: string;
    thumbnailUrl?: string;
    source?: "drive" | "zuper" | "pandadoc";
    modifiedTime: string;
    size: number;
  };
  combinedFile?: boolean;
  visionResult?: EnrichedVisionResult;
}

const STATUS_CONFIG = {
  found: { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", icon: "✓", color: "text-green-700 dark:text-green-400" },
  likely: { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-800", icon: "~", color: "text-green-700 dark:text-green-400" },
  missing: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", icon: "✗", color: "text-red-700 dark:text-red-400" },
  needs_review: { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", icon: "?", color: "text-yellow-700 dark:text-yellow-400" },
  not_applicable: { bg: "bg-surface", border: "border-t-border", icon: "—", color: "text-muted" },
  error: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800", icon: "!", color: "text-red-700 dark:text-red-400" },
} as const;

export function PeChecklistCard({ result }: { result: ChecklistCardResult }) {
  const config = STATUS_CONFIG[result.status];

  return (
    <div className={`rounded-lg border p-3 ${config.bg} ${config.border}`}>
      <div className="flex items-start gap-3">
        <span className={`text-lg font-bold ${config.color}`}>{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm">{result.item.label}</span>
            {result.visionResult?.confidence && (
              <span className="text-xs text-muted px-1.5 py-0.5 bg-surface-2 rounded">
                {result.visionResult.confidence}
              </span>
            )}
          </div>
          {result.foundFile && (
            <a
              href={result.foundFile.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block mt-0.5"
            >
              {result.foundFile.name}
              {result.combinedFile && " (combined)"}
            </a>
          )}
          {result.visionResult?.issues && result.visionResult.issues.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {result.visionResult.issues.map((issue, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">⚠ {issue}</p>
              ))}
            </div>
          )}
          {result.visionResult?.equipmentVisible && result.visionResult.equipmentVisible.length > 0 && (
            <div className="mt-1">
              <p className="text-xs text-muted">
                🔧 {result.visionResult.equipmentVisible.join(" · ")}
              </p>
            </div>
          )}
          {result.statusNote && !result.visionResult?.issues?.length && (
            <p className="text-xs text-muted mt-0.5">{result.statusNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}
