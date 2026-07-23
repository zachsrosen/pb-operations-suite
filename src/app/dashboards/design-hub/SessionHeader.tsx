"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/**
 * Queue freshness. The house StalenessIndicator lives in DashboardShell, but
 * this hub's shell is rendered by the server page while `lastUpdated` is
 * client-side query state, so the indicator is rendered here instead — beside
 * the data it describes. Re-ticks each minute so the label doesn't go stale.
 */
function Freshness({ lastUpdated }: { lastUpdated: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const ts = new Date(lastUpdated).getTime();
  if (!Number.isFinite(ts)) return null;
  const minutesAgo = Math.max(0, Math.floor((now - ts) / 60_000));
  const label =
    minutesAgo < 1
      ? "just now"
      : minutesAgo < 60
        ? `${minutesAgo}m ago`
        : `${Math.floor(minutesAgo / 60)}h ago`;
  const dot =
    minutesAgo < 20
      ? "bg-green-400"
      : minutesAgo < 45
        ? "bg-yellow-400"
        : "bg-red-400";

  return (
    <span className="text-muted flex items-center gap-1.5 text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span>Updated {label}</span>
    </span>
  );
}

export function SessionHeader({
  userEmail,
  lastUpdated,
}: {
  userEmail: string;
  lastUpdated?: string | null;
}) {
  const mineQuery = useQuery<{ assignments: unknown[] }>({
    queryKey: queryKeys.designHub.assignments(),
    queryFn: async () => {
      const r = await fetch("/api/design-hub/assignments");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 30_000,
  });

  const count = mineQuery.data?.assignments?.length ?? 0;

  return (
    <div className="flex items-center justify-between rounded-xl border border-t-border bg-surface px-4 py-3">
      <div className="text-muted flex items-center gap-3 text-sm">
        <span className="text-foreground font-medium">{userEmail}</span>
        {lastUpdated && <Freshness lastUpdated={lastUpdated} />}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Assigned to me:</span>
        <span
          key={count}
          className="animate-value-flash inline-flex items-center justify-center rounded-full bg-purple-500/10 px-2.5 py-0.5 font-semibold text-purple-600 dark:text-purple-400"
        >
          {count}
        </span>
      </div>
    </div>
  );
}
