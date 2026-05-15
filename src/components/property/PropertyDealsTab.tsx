"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/Skeleton";
import Link from "next/link";
import type { DealsTabData } from "@/lib/property-hub";

interface Props {
  propertyId: string;
}

function formatCurrency(val: number | null): string {
  if (val === null || val === undefined) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const PIPELINE_COLORS: Record<string, string> = {
  Sales: "bg-green-500/10 text-green-400 border-green-500/20",
  Project: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "D&R": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Service: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Roofing: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

export default function PropertyDealsTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<DealsTabData>({
    queryKey: queryKeys.propertyHub.tab(propertyId, "deals"),
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/hub?tab=deals`,
      );
      if (!res.ok) throw new Error("Failed to load deals");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load deals.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-surface border border-t-border p-4 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  const deals = data?.deals ?? [];

  if (deals.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm">No deals linked to this property</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {deals.map((deal) => (
        <Link
          key={deal.id}
          href={`/dashboards/deals?dealId=${deal.id}`}
          className="block rounded-xl bg-surface border border-t-border p-4 hover:border-blue-500/20 transition-colors group"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium text-foreground group-hover:text-blue-400 transition-colors truncate">
              {deal.name}
            </h3>
            {deal.pipelineName && (
              <span
                className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                  PIPELINE_COLORS[deal.pipelineName] ??
                  "bg-surface-2 text-muted border-t-border"
                }`}
              >
                {deal.pipelineName}
              </span>
            )}
          </div>

          <p className="text-xs text-muted mt-1 truncate">
            Stage: {deal.stageName}
          </p>

          <div className="flex items-center justify-between mt-3">
            {deal.amount !== null && (
              <span className="text-sm font-semibold text-foreground">
                {formatCurrency(deal.amount)}
              </span>
            )}
            {deal.closeDate && (
              <span className="text-xs text-muted">
                Close: {formatDate(deal.closeDate)}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
