"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/idr-escalation-photos";

interface EscalationPhoto {
  id: string;
  dealId: string;
  blobPath: string;
  fileName: string;
  caption: string | null;
  sortOrder: number;
  uploadedBy: string;
  createdAt: string;
  viewerUrl: string;
}

interface Props {
  dealId: string;
  readOnly: boolean;
}

export function EscalationPhotoGallery({ dealId, readOnly }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<EscalationPhoto | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});

  const photosQuery = useQuery({
    queryKey: queryKeys.idrMeeting.escalationPhotos(dealId),
    queryFn: async () => {
      const res = await fetch(
        `/api/idr-meeting/escalation-photos?dealId=${encodeURIComponent(dealId)}`,
      );
      if (!res.ok) throw new Error("Failed to load photos");
      return res.json() as Promise<{ photos: EscalationPhoto[] }>;
    },
  });

  const photos = photosQuery.data?.photos ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.escalationPhotos(dealId) });
    queryClient.invalidateQueries({ queryKey: [...queryKeys.idrMeeting.root, "preview"] });
    queryClient.invalidateQueries({ queryKey: [...queryKeys.idrMeeting.root, "session"] });
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
          addToast({ type: "error", title: `${file.name}: only JPEG, PNG, WebP, or GIF allowed` });
          continue;
        }
        if (file.size > MAX_PHOTO_BYTES) {
          addToast({ type: "error", title: `${file.name}: must be under 5 MB` });
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("dealId", dealId);
        const res = await fetch("/api/idr-meeting/escalation-photos", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Upload failed");
        }
      }
    },
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err: Error) => {
      addToast({ type: "error", title: err.message });
      invalidateAll();
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, caption }: { id: string; caption: string }) => {
      const res = await fetch(`/api/idr-meeting/escalation-photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption }),
      });
      if (!res.ok) throw new Error("Failed to save caption");
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err: Error) => addToast({ type: "error", title: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/idr-meeting/escalation-photos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete photo");
      return res.json();
    },
    onSuccess: () => {
      setSelected(null);
      invalidateAll();
    },
    onError: (err: Error) => addToast({ type: "error", title: err.message }),
  });

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    uploadMutation.mutate(Array.from(list));
    if (inputRef.current) inputRef.current.value = "";
  };

  const saveCaption = (photo: EscalationPhoto) => {
    const draft = captionDrafts[photo.id];
    if (draft === undefined) return;
    if (draft.trim() === (photo.caption ?? "").trim()) return;
    patchMutation.mutate({ id: photo.id, caption: draft });
  };

  return (
    <>
      <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Escalation Photos ({photos.length})
          </h3>
          {!readOnly && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="text-[11px] font-medium text-orange-500 hover:text-orange-600 transition-colors disabled:opacity-50"
              >
                {uploadMutation.isPending ? "Uploading…" : "+ Add photos"}
              </button>
            </>
          )}
        </div>

        {photosQuery.isLoading ? (
          <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="aspect-square rounded bg-surface-2 animate-pulse" />
            ))}
          </div>
        ) : photos.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No escalation photos.</p>
        ) : (
          <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setSelected(photo)}
                  className="group relative aspect-square overflow-hidden rounded bg-surface-2"
                >
                  <img
                    src={photo.viewerUrl}
                    alt={photo.fileName}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
                </button>
                {readOnly ? (
                  photo.caption && (
                    <p className="text-[10px] text-muted truncate" title={photo.caption}>
                      {photo.caption}
                    </p>
                  )
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={captionDrafts[photo.id] ?? photo.caption ?? ""}
                      onChange={(e) =>
                        setCaptionDrafts((prev) => ({ ...prev, [photo.id]: e.target.value }))
                      }
                      onBlur={() => saveCaption(photo)}
                      placeholder="Caption"
                      className="min-w-0 flex-1 rounded border border-t-border bg-surface px-1.5 py-0.5 text-[10px] text-foreground placeholder:text-muted"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("Delete this photo?")) deleteMutation.mutate(photo.id);
                      }}
                      className="text-muted hover:text-red-500 transition-colors shrink-0"
                      title="Delete"
                    >
                      &#10005;
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox overlay */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            {photos.length > 1 && (
              <>
                <button
                  className="absolute left-0 top-1/2 -translate-x-12 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                  onClick={() => {
                    const idx = photos.findIndex((p) => p.id === selected.id);
                    setSelected(photos[(idx - 1 + photos.length) % photos.length]);
                  }}
                >
                  &#8592;
                </button>
                <button
                  className="absolute right-0 top-1/2 translate-x-12 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                  onClick={() => {
                    const idx = photos.findIndex((p) => p.id === selected.id);
                    setSelected(photos[(idx + 1) % photos.length]);
                  }}
                >
                  &#8594;
                </button>
              </>
            )}
            <img
              src={selected.viewerUrl}
              alt={selected.fileName}
              className="max-h-[90vh] max-w-[90vw] rounded object-contain"
            />
            {selected.caption && (
              <p className="mt-2 text-center text-sm text-white/90">{selected.caption}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
