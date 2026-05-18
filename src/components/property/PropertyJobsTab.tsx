"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/Skeleton";
import type { JobsTabData } from "@/lib/property-hub";

interface Props {
  propertyId: string;
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "bg-green-500/10 text-green-400 border-green-500/20",
  STARTED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  SCHEDULED: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  UNSCHEDULED: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  CANCELLED: "bg-red-500/10 text-red-400 border-red-500/20",
};

const CATEGORY_COLORS: Record<string, string> = {
  "Site Survey": "bg-green-500/10 text-green-400 border-green-500/20",
  Construction: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Inspection: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "Service Visit": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  "Service Revisit": "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PropertyJobsTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<JobsTabData>({
    queryKey: queryKeys.propertyHub.tab(propertyId, "jobs"),
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/hub?tab=jobs`,
      );
      if (!res.ok) throw new Error("Failed to load jobs");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load jobs.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-surface border border-t-border p-4 space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  const jobs = data?.jobs ?? [];
  const uncachedDealIds = data?.uncachedDealIds ?? [];

  if (jobs.length === 0 && uncachedDealIds.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">No Zuper jobs linked to this property</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Uncached deal warning */}
      {uncachedDealIds.length > 0 && (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-xs text-yellow-400">
          {uncachedDealIds.length} deal{uncachedDealIds.length !== 1 ? "s" : ""}{" "}
          linked to this property {uncachedDealIds.length !== 1 ? "have" : "has"}{" "}
          no cached Zuper job data yet. Job data syncs automatically.
        </div>
      )}

      {/* Job cards */}
      <div className="space-y-3">
        {jobs.map((job) => (
          <div
            key={job.jobUid}
            className="rounded-xl bg-surface border border-t-border p-4 hover:border-blue-500/20 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium text-foreground truncate">
                  {job.title}
                </h3>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                      CATEGORY_COLORS[job.category] ??
                      "bg-surface-2 text-muted border-t-border"
                    }`}
                  >
                    {job.category}
                  </span>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                      STATUS_COLORS[job.status] ??
                      "bg-surface-2 text-muted border-t-border"
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <a
                  href={`https://web.zuperpro.com/jobs/${job.jobUid}/details`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 transition-colors text-xs whitespace-nowrap"
                >
                  Zuper ↗
                </a>
                {job.projectUid && (
                  <a
                    href={`https://web.zuperpro.com/projects/${job.projectUid}/details`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 transition-colors text-xs whitespace-nowrap"
                  >
                    Project ↗
                  </a>
                )}
              </div>
            </div>

            <div className="mt-3 space-y-1 text-xs text-muted">
              {job.scheduledStart && (
                <p>Scheduled: {formatDateTime(job.scheduledStart)}</p>
              )}
              {job.completedDate && (
                <p>Completed: {formatDateTime(job.completedDate)}</p>
              )}
              {job.crew.length > 0 && (
                <p>Crew: {job.crew.map((c) => c.name).join(", ")}</p>
              )}
              {job.dealName && (
                <p className="truncate">Deal: {job.dealName}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
