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
    surveyMetrics: (days: number) => [...queryKeys.stats.root, "survey-metrics", days] as const,
    daMetrics: (days: number) => [...queryKeys.stats.root, "da-metrics", days] as const,
    inspectionMetrics: (days: number) => [...queryKeys.stats.root, "inspection-metrics", days] as const,
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
  forecasting: {
    root: ["forecasting"] as const,
    baselines: () => [...queryKeys.forecasting.root, "baselines"] as const,
  },
  servicePriority: {
    root: ["servicePriority"] as const,
    queue: (location?: string) =>
      [...queryKeys.servicePriority.root, "queue", location] as const,
  },
  serviceTickets: {
    root: ["serviceTickets"] as const,
    list: (params?: Record<string, unknown>) =>
      [...queryKeys.serviceTickets.root, "list", params] as const,
    detail: (ticketId: string) =>
      [...queryKeys.serviceTickets.root, "detail", ticketId] as const,
  },
  serviceCustomers: {
    root: ["serviceCustomers"] as const,
    search: (query: string) =>
      [...queryKeys.serviceCustomers.root, "search", query] as const,
    detail: (contactId: string) =>
      [...queryKeys.serviceCustomers.root, "detail", contactId] as const,
  },
  freshservice: {
    root: ["freshservice"] as const,
    tickets: () => [...queryKeys.freshservice.root, "tickets"] as const,
    ticket: (id: number) => [...queryKeys.freshservice.root, "ticket", id] as const,
    count: () => [...queryKeys.freshservice.root, "count"] as const,
  },
  revenueGoals: {
    root: ["revenue-goals"] as const,
    byYear: (year: number) => ["revenue-goals", year] as const,
  },
  onCall: {
    root: ["on-call"] as const,
    tonight: () => ["on-call", "tonight"] as const,
    assignments: (poolId: string | null, from: string, to: string) =>
      ["on-call", "assignments", poolId, from, to] as const,
    workload: (poolId: string, month: string) =>
      ["on-call", "workload", poolId, month] as const,
    pools: () => ["on-call", "pools"] as const,
    pool: (id: string) => ["on-call", "pool", id] as const,
    swaps: (status?: string) => ["on-call", "swaps", status] as const,
    pto: () => ["on-call", "pto"] as const,
    me: () => ["on-call", "me"] as const,
  },
  peDeals: {
    root: ["peDeals"] as const,
    list: () => [...queryKeys.peDeals.root, "list"] as const,
  },
  funnel: {
    root: ["funnel"] as const,
    designPipeline: (months?: number, locations?: string[]) =>
      [...queryKeys.funnel.root, "design-pipeline", months, locations] as const,
  },
  territoryMap: {
    root: ["territory-map"] as const,
    all: () => ["territory-map", "all"] as const,
  },
  officePerformance: {
    root: ["office-performance"] as const,
    location: (slug: string) =>
      [...queryKeys.officePerformance.root, slug] as const,
  },
  goalsPipeline: {
    root: ["goals-pipeline"] as const,
    location: (slug: string) =>
      [...queryKeys.goalsPipeline.root, slug] as const,
  },
  officeCalendar: {
    root: ["office-calendar"] as const,
    projects: (location: string, month: number, year: number) =>
      [...queryKeys.officeCalendar.root, "projects", location, year, month] as const,
    serviceJobs: (location: string, from: string, to: string) =>
      [...queryKeys.officeCalendar.root, "service-jobs", location, from, to] as const,
    dnrJobs: (location: string, from: string, to: string) =>
      [...queryKeys.officeCalendar.root, "dnr-jobs", location, from, to] as const,
    roofingJobs: (location: string, from: string, to: string) =>
      [...queryKeys.officeCalendar.root, "roofing-jobs", location, from, to] as const,
    otherJobs: (location: string, from: string, to: string) =>
      [...queryKeys.officeCalendar.root, "other-jobs", location, from, to] as const,
  },
  idrMeeting: {
    root: ["idr-meeting"] as const,
    sessions: () => [...queryKeys.idrMeeting.root, "sessions"] as const,
    session: (id: string) => [...queryKeys.idrMeeting.root, "session", id] as const,
    readiness: (itemId: string) => [...queryKeys.idrMeeting.root, "readiness", itemId] as const,
    dealHistory: (dealId: string) => [...queryKeys.idrMeeting.root, "deal-history", dealId] as const,
    dealSearch: (q: string) => [...queryKeys.idrMeeting.root, "deal-search", q] as const,
    escalationQueue: () => [...queryKeys.idrMeeting.root, "escalation-queue"] as const,
    meetingSearch: (q: string, from?: string, to?: string) =>
      [...queryKeys.idrMeeting.root, "meeting-search", q, from ?? "", to ?? ""] as const,
  },
  comms: {
    root: ["comms"] as const,
    messages: (filters?: Record<string, string>) =>
      [...queryKeys.comms.root, "messages", filters] as const,
    chat: (filters?: Record<string, string>) =>
      [...queryKeys.comms.root, "chat", filters] as const,
    status: () => [...queryKeys.comms.root, "status"] as const,
    drafts: () => [...queryKeys.comms.root, "drafts"] as const,
    preferences: (key?: string) =>
      [...queryKeys.comms.root, "preferences", key] as const,
  },
  dealTimeline: {
    root: ["dealTimeline"] as const,
    events: (dealId: string) =>
      ["dealTimeline", "events", dealId] as const,
  },
  dealCommunications: {
    root: ["dealCommunications"] as const,
    list: (dealId: string) =>
      ["dealCommunications", "list", dealId] as const,
  },
  paymentTracking: {
    root: ["paymentTracking"] as const,
    list: () => ["paymentTracking", "list"] as const,
  },
  map: {
    root: ["map"] as const,
    markers: (mode: string, types: string[]) =>
      [...queryKeys.map.root, "markers", mode, types.slice().sort().join(",")] as const,
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
  if (serverKey.startsWith("map:markers")) return [queryKeys.map.root];
  if (serverKey.startsWith("projects"))
    return [queryKeys.projects.root, queryKeys.map.root];
  if (serverKey.startsWith("deals"))
    return [
      queryKeys.deals.root,
      queryKeys.dealTimeline.root,
      queryKeys.dealCommunications.root,
      queryKeys.map.root,
    ];
  if (serverKey.startsWith("stats")) return [queryKeys.stats.root];
  if (serverKey.startsWith("zuper")) return [queryKeys.zuper.root, queryKeys.map.root];
  if (serverKey.startsWith("forecast")) return [queryKeys.forecasting.root];
  if (serverKey.startsWith("service-tickets"))
    return [queryKeys.serviceTickets.root, queryKeys.map.root];
  if (serverKey.startsWith("service:priority")) return [queryKeys.servicePriority.root];
  if (serverKey.startsWith("service:customers")) return [queryKeys.serviceCustomers.root];
  if (serverKey.startsWith("accounting:payment-tracking"))
    return [queryKeys.paymentTracking.root];
  if (serverKey.startsWith("locations")) return [queryKeys.stats.root];
  if (serverKey.startsWith("ahjs")) return [queryKeys.stats.root];
  // pipelines: no RQ consumer depends on it in this batch
  if (serverKey.startsWith("pipelines")) return [];
  if (serverKey.startsWith("revenue-goals")) return [queryKeys.revenueGoals.root];
  if (serverKey.startsWith("funnel")) return [queryKeys.funnel.root];
  if (serverKey.startsWith("territory-map")) return [queryKeys.territoryMap.root];
  if (serverKey.startsWith("office-performance")) return [queryKeys.officePerformance.root];
  if (serverKey.startsWith("idr-meeting")) return [queryKeys.idrMeeting.root];
  if (serverKey.startsWith("on-call")) return [queryKeys.onCall.root];
  return [];
}
