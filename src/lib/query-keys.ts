/**
 * React Query key factory with explicit root keys per domain.
 * Root keys enable prefix-based invalidation via queryClient.invalidateQueries({ queryKey: root }).
 */
export const queryKeys = {
  projects: {
    root: ["projects"] as const,
    list: (params?: Record<string, unknown>) =>
      [...queryKeys.projects.root, "list", params] as const,
    executive: () => [...queryKeys.projects.root, "executive"] as const,
  },
  deals: {
    root: ["deals"] as const,
    list: (pipeline?: string) =>
      [...queryKeys.deals.root, "list", pipeline] as const,
    stream: (pipeline?: string) =>
      [...queryKeys.deals.root, "stream", pipeline] as const,
  },
  zuper: {
    root: ["zuper"] as const,
    compliance: () => [...queryKeys.zuper.root, "compliance"] as const,
    status: () => [...queryKeys.zuper.root, "status"] as const,
    jobs: (params?: Record<string, unknown>) =>
      [...queryKeys.zuper.root, "jobs", params] as const,
  },
  stats: {
    root: ["stats"] as const,
    overview: () => [...queryKeys.stats.root, "overview"] as const,
    qc: (days: number) => [...queryKeys.stats.root, "qc", days] as const,
  },
  auth: {
    root: ["auth"] as const,
    sync: () => [...queryKeys.auth.root, "sync"] as const,
  },
  inventory: {
    root: ["inventory"] as const,
    stock: () => [...queryKeys.inventory.root, "stock"] as const,
    skus: () => [...queryKeys.inventory.root, "skus"] as const,
    transactions: () => [...queryKeys.inventory.root, "transactions"] as const,
    needs: () => [...queryKeys.inventory.root, "needs"] as const,
  },
  optimizer: {
    root: ["optimizer"] as const,
    projects: () => [...queryKeys.optimizer.root, "projects"] as const,
  },
} as const;

/**
 * Map SSE server cache keys (from appCache / CACHE_KEYS) to React Query root keys
 * for prefix-based invalidation. Returns arrays of root keys to invalidate.
 *
 * Server keys: "projects:all", "projects:active", "deals:<pipeline>", "stats", "pipelines"
 * RQ root keys: ["projects"], ["deals"], ["stats"], etc.
 */
export function cacheKeyToQueryKeys(
  serverKey: string
): readonly (readonly unknown[])[] {
  if (serverKey.startsWith("projects")) return [queryKeys.projects.root];
  if (serverKey.startsWith("deals")) return [queryKeys.deals.root];
  if (serverKey.startsWith("stats")) return [queryKeys.stats.root];
  if (serverKey.startsWith("zuper")) return [queryKeys.zuper.root];
  // pipelines: no RQ consumer depends on it in this batch
  if (serverKey.startsWith("pipelines")) return [];
  return [];
}
