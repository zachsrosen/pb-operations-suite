"use client";

import type { EnrichedVisionResult } from "@/lib/pe-vision-classifier";

interface PhotoResult {
  item: { id: string; label: string; pePhotoNumber?: number };
  status: string;
  foundFile?: {
    name: string;
    id: string;
    url: string;
    thumbnailUrl?: string;
    source?: "drive" | "zuper" | "pandadoc";
  };
  visionResult?: EnrichedVisionResult;
}

interface Props {
  photo: PhotoResult | null;
  onClose: () => void;
  onOverride?: (itemId: string, override: boolean) => void;
}

export function PePhotoModal({ photo, onClose, onOverride }: Props) {
  if (!photo) return null;

  const vr = photo.visionResult;
  const isOverridden = !!vr?.pmOverride;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface rounded-xl shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {photo.foundFile ? (
          <img
            src={
              photo.foundFile.thumbnailUrl ??
              `https://drive.google.com/thumbnail?id=${photo.foundFile.id}&sz=w800`
            }
            alt={photo.item.label}
            className="w-full max-h-96 object-contain bg-black"
          />
        ) : (
          <div className="w-full h-48 bg-surface-2 flex items-center justify-center">
            <span className="text-muted">No photo available</span>
          </div>
        )}

        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Photo {photo.item.pePhotoNumber}: {photo.item.label}
              </h3>
              {photo.foundFile && (
                <a
                  href={photo.foundFile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {photo.foundFile.name}
                </a>
              )}
            </div>
            <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
          </div>

          {vr && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-sm font-medium ${
                  vr.status === "pass" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                  vr.status === "fail" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" :
                  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                }`}>
                  AI Verdict: {vr.status.toUpperCase()}
                </span>
                <span className="text-xs text-muted">Confidence: {vr.confidence}</span>
                {isOverridden && (
                  <span className="text-xs text-blue-600 dark:text-blue-400">PM Override Active</span>
                )}
              </div>

              {vr.issues.length > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-lg p-3">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-1">Issues</p>
                  <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                    {vr.issues.map((issue, i) => <li key={i}>• {issue}</li>)}
                  </ul>
                </div>
              )}

              {vr.equipmentVisible && vr.equipmentVisible.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-1">Equipment Detected</p>
                  <div className="flex flex-wrap gap-1.5">
                    {vr.equipmentVisible.map((eq, i) => (
                      <span key={i} className="text-xs px-2 py-1 bg-surface-2 rounded text-foreground">{eq}</span>
                    ))}
                  </div>
                </div>
              )}

              {onOverride && vr.status !== "pass" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOverridden}
                    onChange={(e) => onOverride(photo.item.id, e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-foreground">Override AI verdict (PM confirms this photo is acceptable)</span>
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
