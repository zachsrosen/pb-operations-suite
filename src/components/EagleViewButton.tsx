"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface EagleViewImageryData {
  exists: boolean;
  cached?: boolean;
  imageUrn?: string;
  captureDate?: string;
  gsd?: number;
  thumbnailUrl?: string;
  driveFileId?: string;
  fetchedAt?: string;
}

interface EagleViewButtonProps {
  dealId: string;
}

export default function EagleViewButton({ dealId }: EagleViewButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  // Check if imagery already exists
  const { data, isLoading: isChecking } = useQuery({
    queryKey: queryKeys.eagleview.imagery(dealId),
    queryFn: async (): Promise<EagleViewImageryData> => {
      const res = await fetch(`/api/eagleview/imagery?dealId=${dealId}`);
      if (!res.ok) throw new Error("Failed to check imagery");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch new imagery
  const fetchMutation = useMutation({
    mutationFn: async (force = false): Promise<EagleViewImageryData> => {
      const res = await fetch("/api/eagleview/imagery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, force }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error || body.message || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.eagleview.imagery(dealId) });
    },
  });

  const hasImagery = data?.exists === true;
  const isLoading = isChecking || fetchMutation.isPending;

  // ── No imagery state ──
  if (!hasImagery && !isLoading && !fetchMutation.isError) {
    return (
      <button
        onClick={() => fetchMutation.mutate(false)}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm
                   text-foreground hover:bg-surface-2 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Pull Aerial
      </button>
    );
  }

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Fetching aerial imagery...
      </div>
    );
  }

  // ── Error state ──
  if (fetchMutation.isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm">
        <span className="text-red-500">
          {fetchMutation.error instanceof Error ? fetchMutation.error.message : "Failed to fetch imagery"}
        </span>
        <button
          onClick={() => fetchMutation.mutate(false)}
          className="ml-2 text-xs text-muted hover:text-foreground underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Has imagery state ──
  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowModal(true)}
          className="group relative overflow-hidden rounded-lg border border-border hover:border-cyan-500/50 transition-colors"
        >
          {data?.thumbnailUrl ? (
            <img
              src={data.thumbnailUrl}
              alt="Aerial imagery"
              className="h-16 w-24 object-cover"
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center bg-surface-2 text-xs text-muted">
              No preview
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
            <span className="text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
        </button>
        <div className="flex flex-col gap-0.5 text-xs text-muted">
          {data?.captureDate && (
            <span>Captured {new Date(data.captureDate).toLocaleDateString()}</span>
          )}
          {data?.gsd && <span>{data.gsd.toFixed(1)} cm/px</span>}
          <button
            onClick={() => fetchMutation.mutate(true)}
            className="text-left text-cyan-500 hover:text-cyan-400 underline"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Full-res modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-auto rounded-xl bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-muted">
                {data?.captureDate && (
                  <span>Captured: {new Date(data.captureDate).toLocaleDateString()}</span>
                )}
                {data?.gsd && <span>Resolution: {data.gsd.toFixed(1)} cm/px</span>}
              </div>
              <div className="flex items-center gap-2">
                {data?.driveFileId && (
                  <a
                    href={`https://drive.google.com/file/d/${data.driveFileId}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                  >
                    Open in Drive
                  </a>
                )}
                <a
                  href={`/api/eagleview/imagery/${dealId}/image`}
                  download={`EagleView_Aerial_${dealId}.png`}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  Download
                </a>
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/eagleview/imagery/${dealId}/image`}
              alt="EagleView aerial imagery"
              className="max-h-[80vh] rounded-lg"
            />
          </div>
        </div>
      )}
    </>
  );
}
