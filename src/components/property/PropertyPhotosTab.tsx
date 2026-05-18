"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PhotosTabData } from "@/lib/property-hub";

interface Props {
  propertyId: string;
}

const ZUPER_BASE =
  process.env.NEXT_PUBLIC_ZUPER_WEB_URL?.replace(/\/+$/, "") ||
  "https://web.zuperpro.com";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PropertyPhotosTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<PhotosTabData>({
    queryKey: queryKeys.propertyHub.tab(propertyId, "photos"),
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/hub?tab=photos`,
      );
      if (!res.ok) throw new Error("Failed to load photos");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load photos.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-1/3" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="aspect-square rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const groups = data?.groups ?? [];

  if (groups.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <svg
          className="w-12 h-12 mx-auto mb-3 opacity-30"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
          />
        </svg>
        <p className="text-sm">No photos available for this property.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Total count */}
      <p className="text-xs text-muted">
        {data?.totalPhotos ?? 0} photo{(data?.totalPhotos ?? 0) !== 1 ? "s" : ""}{" "}
        across {groups.length} job{groups.length !== 1 ? "s" : ""}
      </p>

      {groups.map((group) => (
        <div key={group.jobUid} className="space-y-3">
          {/* Group header */}
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground truncate">
              {group.jobTitle}
            </h3>
            {group.category && (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium border bg-surface-2 text-muted border-t-border">
                {group.category}
              </span>
            )}
            <a
              href={`${ZUPER_BASE}/jobs/${encodeURIComponent(group.jobUid)}/details`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-blue-400 hover:text-blue-300 shrink-0"
            >
              View in Zuper
            </a>
          </div>

          {/* Photo grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {group.photos.map((photo, idx) => (
              <a
                key={photo.url}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-lg overflow-hidden bg-surface border border-t-border hover:border-blue-500/30 transition-colors"
              >
                <div className="aspect-square relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={photo.fileName || `Photo ${idx + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    loading="lazy"
                  />
                </div>
                <div className="p-2 space-y-0.5">
                  <p className="text-xs text-foreground truncate">
                    {photo.fileName}
                  </p>
                  {photo.createdAt && (
                    <p className="text-xs text-muted">
                      {formatDate(photo.createdAt)}
                    </p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
