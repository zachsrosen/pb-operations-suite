"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface Permit {
  id: string;
  shovelsId: string;
  permitNumber: string | null;
  description: string | null;
  type: string | null;
  subtype: string | null;
  status: string | null;
  tags: string[];
  jobValueCents: number | null;
  fileDate: string | null;
  finalDate: string | null;
  contractorName: string | null;
  contractorClassification: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  final: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  active: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  in_review: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  inactive: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCents(cents: number | null): string {
  if (cents == null || cents === 0) return "";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function PropertyPermitHistory({ propertyId }: { propertyId: string }) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.propertyPermits.list(propertyId),
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/permits`);
      if (!res.ok) throw new Error("Failed to load permits");
      return res.json() as Promise<{ permits: Permit[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const permits = data?.permits ?? [];
  if (isLoading) {
    return (
      <section>
        <h4 className="text-sm font-medium text-muted mb-2">Permit History</h4>
        <div className="animate-pulse h-8 bg-surface-2 rounded" />
      </section>
    );
  }

  if (permits.length === 0) return null;

  const isSolar = (tags: string[]) => tags.some((t) => t === "solar" || t === "solar_battery_storage");

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors w-full text-left"
      >
        <span className="text-xs">{expanded ? "▼" : "▶"}</span>
        <span>Permit History</span>
        <span className="text-xs font-normal text-muted bg-surface-2 px-1.5 py-0.5 rounded">{permits.length}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {permits.map((p) => (
            <div
              key={p.id}
              className={`p-2.5 rounded-lg border ${
                isSolar(p.tags) ? "border-amber-300/40 bg-amber-50/30 dark:border-amber-700/30 dark:bg-amber-900/10" : "border-t-border bg-surface"
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                {isSolar(p.tags) && <span title="Solar permit">{"☀️"}</span>}
                <span className="text-xs font-mono text-muted">{p.permitNumber ?? p.shovelsId.slice(0, 8)}</span>
                {p.status && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status] ?? STATUS_COLORS.inactive}`}>
                    {p.status}
                  </span>
                )}
                {p.type && <span className="text-xs text-muted">{p.type}</span>}
                <span className="text-xs text-muted ml-auto">{formatDate(p.fileDate)}</span>
              </div>

              {p.description && (
                <p className="text-xs text-muted mt-1 line-clamp-2">{p.description}</p>
              )}

              <div className="flex items-center gap-3 mt-1 text-[11px] text-muted flex-wrap">
                {p.tags.filter((t) => t !== "solar" && t !== "solar_battery_storage").map((t) => (
                  <span key={t} className="bg-surface-2 px-1.5 py-0.5 rounded">{t}</span>
                ))}
                {formatCents(p.jobValueCents) && <span>{formatCents(p.jobValueCents)}</span>}
                {p.contractorName && <span>{"🔧"} {p.contractorName}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
