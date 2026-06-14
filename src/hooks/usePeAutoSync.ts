import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * On mount, ask the server to run a throttled incremental PE sync. If it
 * actually synced (vs. being throttled), invalidate the given React Query keys
 * so the page re-fetches and shows the fresh data. Fire-and-forget — the page
 * renders immediately with current data and updates in place if a sync ran.
 */
export function usePeAutoSync(invalidateKeys: QueryKey[]): void {
  const qc = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounting/pe-sync-now", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.synced) return;
        for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
