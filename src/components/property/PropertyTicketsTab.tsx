"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/Skeleton";
import type { TicketsTabData } from "@/lib/property-hub";

interface Props {
  propertyId: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "bg-red-500/10 text-red-400 border-red-500/20",
  MEDIUM: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  LOW: "bg-green-500/10 text-green-400 border-green-500/20",
};

export default function PropertyTicketsTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<TicketsTabData>({
    queryKey: queryKeys.propertyHub.tab(propertyId, "tickets"),
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/hub?tab=tickets`,
      );
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load tickets.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-surface border border-t-border p-4 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  const tickets = data?.tickets ?? [];

  if (tickets.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
        </svg>
        <p className="text-sm">No tickets linked to this property</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tickets.map((ticket) => (
        <div
          key={ticket.id}
          className="rounded-xl bg-surface border border-t-border p-4 hover:border-blue-500/20 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-foreground truncate">
                {ticket.subject}
              </h3>
              <p className="text-xs text-muted mt-1">
                Status: {ticket.statusName}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {ticket.priority && (
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                    PRIORITY_COLORS[ticket.priority] ??
                    "bg-surface-2 text-muted border-t-border"
                  }`}
                >
                  {ticket.priority}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-muted">
            {ticket.createDate && (
              <span>
                Created:{" "}
                {new Date(ticket.createDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            )}
            {ticket.lastModified && (
              <span>
                Updated:{" "}
                {new Date(ticket.lastModified).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
