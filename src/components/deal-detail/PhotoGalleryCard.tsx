"use client";

import { useState, useEffect } from "react";

interface Photo {
  id: string;
  fileName: string;
  url: string;
  jobCategory: string;
  createdAt: string | null;
}

interface PhotoGalleryCardProps {
  hubspotDealId: string;
  zuperUid?: string | null;
}

export default function PhotoGalleryCard({ hubspotDealId, zuperUid }: PhotoGalleryCardProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPhotos() {
      try {
        const query = zuperUid ? `?zuperUid=${encodeURIComponent(zuperUid)}` : "";
        const res = await fetch(`/api/deals/${hubspotDealId}/photos${query}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setPhotos(data.photos ?? []);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchPhotos();
    return () => { cancelled = true; };
  }, [hubspotDealId, zuperUid]);

  if (loading) {
    return (
      <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Site Photos
        </h3>
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <span className="animate-spin">⟳</span> Loading...
        </div>
      </div>
    );
  }

  if (photos.length === 0) return null;

  return (
    <>
      <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Site Photos ({photos.length})
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
          {photos.map((photo) => (
            <button
              key={photo.id}
              onClick={() => setSelectedPhoto(photo)}
              className="group relative aspect-square overflow-hidden rounded bg-surface-2"
            >
              <img
                src={photo.url}
                alt={photo.fileName}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox overlay */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Prev / Next arrows */}
            {photos.length > 1 && (
              <>
                <button
                  className="absolute left-0 top-1/2 -translate-x-12 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                  onClick={() => {
                    const idx = photos.findIndex((p) => p.id === selectedPhoto.id);
                    setSelectedPhoto(photos[(idx - 1 + photos.length) % photos.length]);
                  }}
                >
                  &#8592;
                </button>
                <button
                  className="absolute right-0 top-1/2 translate-x-12 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
                  onClick={() => {
                    const idx = photos.findIndex((p) => p.id === selectedPhoto.id);
                    setSelectedPhoto(photos[(idx + 1) % photos.length]);
                  }}
                >
                  &#8594;
                </button>
              </>
            )}
            <img
              src={selectedPhoto.url}
              alt={selectedPhoto.fileName}
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
            <div className="mt-2 flex items-center justify-between">
              <div>
                <p className="text-sm text-white">{selectedPhoto.fileName}</p>
                <p className="text-xs text-zinc-400">
                  {selectedPhoto.jobCategory}
                  {photos.length > 1 && (
                    <span className="ml-2">
                      {photos.findIndex((p) => p.id === selectedPhoto.id) + 1} / {photos.length}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setSelectedPhoto(null)}
                className="rounded-lg bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
