"use client";

import { useRef, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/idr-escalation-photos";

export interface PendingPhoto {
  key: string;
  file: File;
  caption: string;
}

interface Props {
  mode: "pending";
  onChange: (photos: PendingPhoto[]) => void;
}

/**
 * Add-time photo picker for the Add Escalation dialog. Holds chosen files
 * locally with optional captions and reports them to the parent, which uploads
 * them after the escalation is created. No upload happens here.
 */
export function EscalationPhotoUploader({ onChange }: Props) {
  const { addToast } = useToast();
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (next: PendingPhoto[]) => {
    setPhotos(next);
    onChange(next);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const accepted: PendingPhoto[] = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        addToast({ type: "error", title: `${file.name}: only JPEG, PNG, WebP, or GIF allowed` });
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        addToast({ type: "error", title: `${file.name}: must be under 5 MB` });
        continue;
      }
      accepted.push({
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        caption: "",
      });
    }
    if (accepted.length) update([...photos, ...accepted]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removePhoto = (key: string) => update(photos.filter((p) => p.key !== key));

  const setCaption = (key: string, caption: string) =>
    update(photos.map((p) => (p.key === key ? { ...p, caption } : p)));

  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
        Photos
      </label>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border file:border-t-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-surface"
      />
      <p className="text-[11px] text-muted mt-1">
        JPEG, PNG, WebP, or GIF up to 5 MB each. Optional.
      </p>

      {photos.length > 0 && (
        <div className="mt-3 space-y-2">
          {photos.map((photo) => (
            <div
              key={photo.key}
              className="flex items-center gap-2 rounded-lg border border-t-border bg-surface-2 px-3 py-2"
            >
              <span className="text-xs text-foreground truncate flex-1" title={photo.file.name}>
                {photo.file.name}
              </span>
              <input
                type="text"
                value={photo.caption}
                onChange={(e) => setCaption(photo.key, e.target.value)}
                placeholder="Caption (optional)"
                className="w-40 rounded border border-t-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => removePhoto(photo.key)}
                className="text-muted hover:text-red-500 transition-colors shrink-0"
                title="Remove"
              >
                &#10005;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
