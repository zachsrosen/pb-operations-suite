"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export function SessionHeader({ userEmail }: { userEmail: string }) {
  const todayQuery = useQuery<{ count: number }>({
    queryKey: queryKeys.icHub.todayCount(),
    queryFn: async () => {
      const r = await fetch("/api/ic-hub/today-count");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 30_000,
  });

  const count = todayQuery.data?.count ?? 0;

  return (
    <div className="flex items-center justify-between rounded-xl border border-t-border bg-surface px-4 py-3">
      <div className="text-muted flex items-center gap-2 text-sm">
        <span className="text-foreground font-medium">{userEmail}</span>
        <span>·</span>
        <span>Solo mode</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Touched today:</span>
        <span
          key={count}
          className="animate-value-flash inline-flex items-center justify-center rounded-full bg-green-500/10 px-2.5 py-0.5 font-semibold text-green-600 dark:text-green-400"
        >
          {count}
        </span>
      </div>
    </div>
  );
}
