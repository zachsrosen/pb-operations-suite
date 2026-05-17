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
  photos: PhotoResult[];
  onPhotoClick: (photo: PhotoResult) => void;
}

const VERDICT_BADGE = {
  pass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  fail: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  needs_review: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
} as const;

export function PePhotoGrid({ photos, onPhotoClick }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {photos.map((photo) => (
        <button
          key={photo.item.id}
          onClick={() => onPhotoClick(photo)}
          className="relative rounded-lg border border-t-border bg-surface overflow-hidden text-left hover:ring-2 hover:ring-orange-400 transition-all"
        >
          {photo.foundFile ? (
            <img
              src={
                photo.foundFile.thumbnailUrl ??
                `https://drive.google.com/thumbnail?id=${photo.foundFile.id}&sz=w300`
              }
              alt={photo.item.label}
              className="w-full h-32 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-32 bg-surface-2 flex items-center justify-center">
              <span className="text-muted text-sm">No photo</span>
            </div>
          )}
          <div className="p-2">
            <p className="text-xs font-medium text-foreground truncate">
              {photo.item.pePhotoNumber}. {photo.item.label}
            </p>
            {photo.visionResult && (
              <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded ${VERDICT_BADGE[photo.visionResult.status] ?? ""}`}>
                {photo.visionResult.status}
              </span>
            )}
            {photo.status === "missing" && (
              <span className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                missing
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
