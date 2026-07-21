import type { UserRole, ActivityType } from "@/lib/db";

// ─── PATH_TO_SUITE ──────────────────────────────────────────────────────────────
// Exhaustive map of every /dashboards/* href used in suite landing pages →
// human suite label. Run the harvest command in the plan to refresh if pages change.
// Duplicates: path appears in multiple suites — primary suite chosen, dup noted inline.
export const PATH_TO_SUITE: Record<string, string> = {
  // ── Accounting ──────────────────────────────────────────────────────────────
  "/dashboards/payment-action-queue": "Accounting",
  "/dashboards/payment-tracking": "Accounting",
  "/dashboards/ready-to-invoice": "Accounting",
  "/dashboards/accounts-receivable": "Accounting",
  "/dashboards/payment-timeline": "Accounting",
  "/dashboards/pe-docs": "Accounting",              // also pe-compliance
  "/dashboards/pe-report": "Accounting",            // also pe-compliance
  "/dashboards/pe-submission-gap": "Accounting",    // also pe-compliance
  "/dashboards/pe-deals": "Accounting",             // also pe-compliance
  "/dashboards/pe": "Accounting",                   // also pe-compliance

  // ── Accounting (PE Compliance rolls under Accounting) ────────────────────
  "/dashboards/pe-action-queue": "Accounting",
  "/dashboards/pe-prep": "Accounting",
  "/dashboards/pe-avl": "Accounting",
  "/dashboards/pe-pipeline": "Accounting",          // also operations, pe-compliance
  "/dashboards/pe-photo-builder": "Accounting",     // also operations
  "/dashboards/pe-analytics": "Accounting",

  // ── Design & Engineering ─────────────────────────────────────────────────
  "/dashboards/de-overview": "Design & Engineering",
  "/dashboards/plan-review": "Design & Engineering",
  "/dashboards/pending-approval": "Design & Engineering", // also project-management
  "/dashboards/design-revisions": "Design & Engineering", // also project-management
  "/dashboards/design-pipeline-funnel": "Design & Engineering", // also executive
  "/dashboards/design-engineering-funnel": "Design & Engineering", // also executive
  "/dashboards/de-metrics": "Design & Engineering",
  "/dashboards/clipping-analytics": "Design & Engineering",
  "/dashboards/production-issues": "Design & Engineering",
  "/dashboards/design-engineering": "Design & Engineering",
  "/dashboards/ahj-requirements": "Design & Engineering", // also pe-compliance
  "/dashboards/utility-design-requirements": "Design & Engineering",
  "/dashboards/tsrf-calculator": "Design & Engineering",  // also service
  "/dashboards/idr-meeting": "Design & Engineering",      // also operations, project-management
  "/dashboards/eagleview-orders": "Design & Engineering", // also operations, service
  "/dashboards/design": "Design & Engineering",
  "/dashboards/powerhub": "Design & Engineering",         // also service

  // ── D&R + Roofing ────────────────────────────────────────────────────────
  "/dashboards/dnr": "D&R + Roofing",
  "/dashboards/dnr-scheduler": "D&R + Roofing",
  "/dashboards/roofing": "D&R + Roofing",
  "/dashboards/roofing-scheduler": "D&R + Roofing",

  // ── Executive ────────────────────────────────────────────────────────────
  "/dashboards/revenue": "Executive",
  "/dashboards/executive": "Executive",
  "/dashboards/executive-calendar": "Executive",
  "/dashboards/preconstruction-metrics": "Executive",
  "/dashboards/executive-calls": "Executive",
  "/dashboards/territory-map": "Executive",
  "/dashboards/project-pipeline-funnel": "Executive",
  "/dashboards/forecast-accuracy": "Executive",
  "/dashboards/forecast-timeline": "Executive",
  "/dashboards/office-performance/all": "Executive",       // also operations
  "/dashboards/office-performance/westminster": "Executive",
  "/dashboards/office-performance/centennial": "Executive",
  "/dashboards/office-performance/pueblo": "Executive",
  "/dashboards/office-performance/colorado-springs": "Executive", // legacy slug, still served
  "/dashboards/office-performance/san-luis-obispo": "Executive",
  "/dashboards/office-performance/camarillo": "Executive",
  "/dashboards/shop-health": "Executive",
  "/dashboards/ops-scorecard": "Executive",         // also operations

  // ── Operations ───────────────────────────────────────────────────────────
  "/dashboards/scheduler": "Operations",            // also project-management
  "/dashboards/crew-schedule": "Operations",        // also dnr-roofing, service
  "/dashboards/map": "Operations",                  // also project-management
  "/dashboards/forecast-schedule": "Operations",    // also project-management
  "/dashboards/equipment-backlog": "Operations",
  "/dashboards/site-survey-scheduler": "Operations", // also project-management, sales-marketing
  "/dashboards/site-survey": "Operations",
  "/dashboards/survey-metrics": "Operations",       // also project-management
  "/dashboards/construction-scheduler": "Operations", // also project-management
  "/dashboards/construction": "Operations",
  "/dashboards/construction-metrics": "Operations", // also project-management
  "/dashboards/pipeline-tracker": "Operations",     // also accounting
  "/dashboards/inspection-scheduler": "Operations", // also project-management
  "/dashboards/inspections": "Operations",
  "/dashboards/inspection-metrics": "Operations",   // also project-management
  "/dashboards/product-catalog": "Operations",
  "/dashboards/bom": "Operations",
  "/dashboards/submit-product": "Operations",
  "/dashboards/catalog": "Operations",
  "/dashboards/product-requests-review": "Operations",
  "/dashboards/comms": "Operations",
  "/dashboards/my-tasks": "Operations",             // also project-management
  "/dashboards/on-call": "Operations",
  "/dashboards/atlas": "Operations",                // also project-management, service
  "/dashboards/bottlenecks": "Operations",
  "/dashboards/scheduler-v2": "Operations",
  "/dashboards/workflow-map": "Operations",         // also design-engineering, dnr-roofing, permitting-interconnection, service

  // ── Permitting & Interconnection ─────────────────────────────────────────
  "/dashboards/permit-hub": "Permitting & Interconnection",
  "/dashboards/ic-hub": "Permitting & Interconnection",
  "/dashboards/pi-overview": "Permitting & Interconnection",
  "/dashboards/pi-permit-action-queue": "Permitting & Interconnection",
  "/dashboards/pi-ic-action-queue": "Permitting & Interconnection",
  "/dashboards/pi-permit-revisions": "Permitting & Interconnection",
  "/dashboards/pi-ic-revisions": "Permitting & Interconnection",
  "/dashboards/pi-metrics": "Permitting & Interconnection",
  "/dashboards/pi-timeline": "Permitting & Interconnection",
  "/dashboards/permitting-interconnection": "Permitting & Interconnection",
  "/dashboards/ahj-tracker": "Permitting & Interconnection", // also pe-compliance
  "/dashboards/utility-tracker": "Permitting & Interconnection", // also pe-compliance
  "/dashboards/incentives": "Permitting & Interconnection",  // also pe-compliance
  "/dashboards/pi-action-queue": "Permitting & Interconnection",
  "/dashboards/pi-revisions": "Permitting & Interconnection",
  "/dashboards/permitting": "Permitting & Interconnection",
  "/dashboards/interconnection": "Permitting & Interconnection",

  // ── Project Management ───────────────────────────────────────────────────
  "/dashboards/pm-action-queue": "Project Management",
  "/dashboards/my-tickets": "Project Management",
  "/dashboards/da-drift": "Project Management",
  "/dashboards/zuper-drift": "Project Management",
  "/dashboards/shit-show-meeting": "Project Management",    // also executive
  "/dashboards/rtb-review": "Project Management",

  // ── Sales & Marketing ────────────────────────────────────────────────────
  "/dashboards/request-product": "Sales & Marketing",
  "/dashboards/sales": "Sales & Marketing",                 // also executive
  "/dashboards/pricing-calculator": "Sales & Marketing",
  "/dashboards/adders": "Sales & Marketing",

  // ── Service ──────────────────────────────────────────────────────────────
  "/dashboards/service-overview": "Service",
  "/dashboards/service-tickets": "Service",
  "/dashboards/service-scheduler": "Service",
  "/dashboards/service-unscheduled": "Service",
  "/dashboards/service-customers": "Service",
  "/dashboards/service": "Service",
  "/dashboards/service-backlog": "Service",
  "/dashboards/service-bom": "Service",
  "/dashboards/service-catalog": "Service",

  // ── Testing ──────────────────────────────────────────────────────────────
  "/dashboards/at-risk": "Testing",
  "/dashboards/qc": "Testing",
  "/dashboards/alerts": "Testing",
  "/dashboards/timeline": "Testing",
  "/dashboards/pipeline": "Testing",
  "/dashboards/optimizer": "Testing",
  "/dashboards/project-management": "Testing",
  "/dashboards/ai": "Testing",
  "/dashboards/product-comparison": "Testing",
  "/dashboards/inventory": "Testing",
  "/dashboards/inventory/cost-audit": "Testing",
  "/dashboards/inventory/sync-health": "Testing",
  "/dashboards/mobile": "Testing",
  "/dashboards/command-center": "Testing",
  "/dashboards/capacity": "Testing",
  "/dashboards/locations": "Testing",
  "/dashboards/zuper-status-comparison": "Testing",
  "/dashboards/zuper-compliance": "Testing",        // also pe-compliance
  "/dashboards/admin/calls": "Testing",
  "/dashboards/admin/team-activity": "Testing",
};

// Suite landing routes are also "known pages".
const SUITE_LANDING_ROUTES = [
  "/suites/operations", "/suites/service", "/suites/design-engineering",
  "/suites/permitting-interconnection", "/suites/dnr-roofing", "/suites/intelligence",
  "/suites/executive", "/suites/accounting", "/suites/sales-marketing",
  "/suites/project-management", "/suites/testing",
];
// Admin tooling pages worth tracking for dead-weight (extend as needed).
const ADMIN_PAGES = ["/admin/page-traffic", "/admin/activity", "/admin/audit", "/admin/security", "/admin/users", "/admin/roles"];

export function suiteForPath(path: string): string {
  const norm = normalizePath(path);
  if (norm in PATH_TO_SUITE) return PATH_TO_SUITE[norm];
  if (norm.startsWith("/suites/") || norm.startsWith("/admin")) return "Admin";
  return "Other";
}

export const KNOWN_PAGES: string[] = Array.from(
  new Set([...Object.keys(PATH_TO_SUITE), ...SUITE_LANDING_ROUTES, ...ADMIN_PAGES]),
);

// ─── DYNAMIC_ROUTES ─────────────────────────────────────────────────────────────
// Known dynamic-route patterns: prefix → param label. Order matters (longest prefix first).
const DYNAMIC_ROUTES: Array<{ prefix: string; param: string }> = [
  { prefix: "/dashboards/reviews", param: "[dealId]" },
  { prefix: "/dashboards/catalog/edit", param: "[id]" },
];

/** Strip query/hash, trailing slash, and collapse a trailing dynamic segment to its route pattern. */
export function normalizePath(raw: string): string {
  if (!raw) return raw;
  let path = raw.split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  for (const { prefix, param } of DYNAMIC_ROUTES) {
    if (path === prefix) return path;
    if (path.startsWith(`${prefix}/`)) {
      // collapse exactly one segment after the prefix
      const rest = path.slice(prefix.length + 1).split("/")[0];
      if (rest) return `${prefix}/${param}`;
    }
  }
  // Generic fallback: collapse a trailing all-numeric segment to [id]
  const segs = path.split("/");
  const last = segs[segs.length - 1];
  if (last && /^\d+$/.test(last) && segs.length > 2) {
    segs[segs.length - 1] = "[id]";
    return segs.join("/");
  }
  return path;
}

// ─── TYPES ───────────────────────────────────────────────────────────────────────

export type TrafficWindow = "7d" | "30d" | "90d" | "all";

/** Minimal shape of an ActivityLog row needed for aggregation. */
export interface TrafficRow {
  type: string;              // DASHBOARD_VIEWED | PAGE_DWELL | FEATURE_USED
  entityId: string | null;   // normalized or raw path (for FEATURE_USED: the feature name e.g. "click:button")
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  durationMs: number | null; // dwell ms for PAGE_DWELL
  metadata?: { page?: string } | null; // FEATURE_USED rows store page path here
}

export interface PageRow {
  path: string;
  suite: string;
  views: number;
  uniqueUsers: number;
  clicks: number;
  avgDwellMs: number | null;
}
export interface SuiteRow { suite: string; views: number; uniqueUsers: number; }
export interface UserRow { userId: string | null; userEmail: string | null; userName: string | null; views: number; avgDwellMs: number | null; }
export interface PageTrafficResult {
  totals: { views: number; uniqueUsers: number; activePages: number; avgDwellMs: number | null };
  pages: PageRow[];
  suites: SuiteRow[];
  deadPages: { path: string; suite: string; views: number }[];
  users: UserRow[];
}

// ─── AGGREGATION ─────────────────────────────────────────────────────────────────

// a page is "dead" if it received fewer than this many views in the window (currently: zero views)
const DEAD_VIEW_FLOOR = 1;

export function aggregatePageTraffic(rows: TrafficRow[]): PageTrafficResult {
  type Acc = { views: number; clicks: number; users: Set<string>; dwellSum: number; dwellN: number };
  const byPath = new Map<string, Acc>();
  const globalUsers = new Set<string>();
  type UAcc = { userEmail: string | null; userName: string | null; views: number; dwellSum: number; dwellN: number };
  const byUser = new Map<string, UAcc>();

  const acc = (m: Map<string, Acc>, k: string): Acc => {
    let a = m.get(k); if (!a) { a = { views: 0, clicks: 0, users: new Set(), dwellSum: 0, dwellN: 0 }; m.set(k, a); } return a;
  };

  for (const r of rows) {
    if (r.type === "FEATURE_USED") {
      // Only count ClickTracker clicks (entityId starts with "click:"); key by metadata.page.
      if (!r.entityId?.startsWith("click:")) continue;
      const meta = r.metadata as { page?: string } | null | undefined;
      const clickPath = normalizePath(meta?.page || "");
      if (!clickPath) continue;
      acc(byPath, clickPath).clicks++;
    } else if (r.type === "DASHBOARD_VIEWED") {
      const path = normalizePath(r.entityId || "");
      // Only PageViewTracker rows (entityId is a real path starting with "/").
      // Legacy trackDashboardView() calls also write DASHBOARD_VIEWED but with a
      // bare slug entityId (e.g. "master-scheduler") — skip those to avoid
      // double-counting every visit and polluting the "Other" suite bucket.
      if (!path.startsWith("/")) continue;
      const a = acc(byPath, path);
      const uid = r.userId || r.userEmail || "";
      a.views++; if (uid) { a.users.add(uid); globalUsers.add(uid); }
      const ukey = r.userId || r.userEmail || "unknown";
      let u = byUser.get(ukey); if (!u) { u = { userEmail: r.userEmail, userName: r.userName, views: 0, dwellSum: 0, dwellN: 0 }; byUser.set(ukey, u); }
      u.views++;
    } else if (r.type === "PAGE_DWELL" && typeof r.durationMs === "number") {
      const path = normalizePath(r.entityId || "");
      if (!path) continue;
      const a = acc(byPath, path);
      a.dwellSum += r.durationMs; a.dwellN++;
      const ukey = r.userId || r.userEmail || "unknown";
      let u = byUser.get(ukey);
      if (!u) { u = { userEmail: r.userEmail, userName: r.userName, views: 0, dwellSum: 0, dwellN: 0 }; byUser.set(ukey, u); }
      u.dwellSum += r.durationMs; u.dwellN++;
    }
  }

  const pages: PageRow[] = [...byPath.entries()]
    .filter(([, a]) => a.views > 0 || a.clicks > 0 || a.dwellN > 0)
    .map(([path, a]) => ({
      path, suite: suiteForPath(path), views: a.views, uniqueUsers: a.users.size,
      clicks: a.clicks, avgDwellMs: a.dwellN ? Math.round(a.dwellSum / a.dwellN) : null,
    }))
    .sort((x, y) => y.views - x.views);

  const suiteMap = new Map<string, { views: number; users: Set<string> }>();
  for (const [path, a] of byPath) {
    const s = suiteForPath(path);
    let sa = suiteMap.get(s); if (!sa) { sa = { views: 0, users: new Set() }; suiteMap.set(s, sa); }
    sa.views += a.views; a.users.forEach((u) => sa!.users.add(u));
  }
  const suites: SuiteRow[] = [...suiteMap.entries()]
    .map(([suite, v]) => ({ suite, views: v.views, uniqueUsers: v.users.size }))
    .sort((x, y) => y.views - x.views);

  const deadPages = KNOWN_PAGES
    .filter((p) => (byPath.get(p)?.views ?? 0) < DEAD_VIEW_FLOOR)
    .map((p) => ({ path: p, suite: suiteForPath(p), views: byPath.get(p)?.views ?? 0 }))
    .sort((x, y) => x.views - y.views);

  const users: UserRow[] = [...byUser.entries()]
    .map(([userId, u]) => ({ userId: userId === "unknown" ? null : userId, userEmail: u.userEmail, userName: u.userName, views: u.views, avgDwellMs: u.dwellN ? Math.round(u.dwellSum / u.dwellN) : null }))
    .sort((x, y) => y.views - x.views);

  // Derive global avg dwell from the same per-path accumulated data used for per-page averages.
  let totalDwellSum = 0; let totalDwellN = 0;
  for (const a of byPath.values()) { totalDwellSum += a.dwellSum; totalDwellN += a.dwellN; }
  const avgDwellMs = totalDwellN > 0 ? Math.round(totalDwellSum / totalDwellN) : null;

  return {
    totals: { views: pages.reduce((s, p) => s + p.views, 0), uniqueUsers: globalUsers.size, activePages: pages.filter((p) => p.views > 0).length, avgDwellMs },
    pages, suites, deadPages, users,
  };
}

// ─── DB WRAPPER ──────────────────────────────────────────────────────────────────

const WINDOW_DAYS: Record<Exclude<TrafficWindow, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

export interface GetPageTrafficOpts { window: TrafficWindow; roles?: string[]; locations?: string[]; }

export async function getPageTraffic(opts: GetPageTrafficOpts): Promise<PageTrafficResult> {
  // Lazy import so pure-function tests can import this module without a DB connection.
  const { prisma } = await import("@/lib/db");
  if (!prisma) return aggregatePageTraffic([]);
  const since = opts.window === "all" ? undefined : new Date(Date.now() - WINDOW_DAYS[opts.window] * 86_400_000);

  // Optional role filter → resolve to userIds.
  let userIdFilter: string[] | undefined;
  if (opts.roles?.length) {
    const users = await prisma.user.findMany({ where: { roles: { hasSome: opts.roles as UserRole[] } }, select: { id: true } });
    userIdFilter = users.map((u) => u.id);
    if (userIdFilter.length === 0) return aggregatePageTraffic([]); // no matching users → empty
  }

  const rows = await prisma.activityLog.findMany({
    where: {
      type: { in: ["DASHBOARD_VIEWED", "PAGE_DWELL", "FEATURE_USED"] as ActivityType[] },
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(opts.locations?.length ? { pbLocation: { in: opts.locations } } : {}),
      ...(userIdFilter ? { userId: { in: userIdFilter } } : {}),
    },
    select: { type: true, entityId: true, userId: true, userEmail: true, userName: true, durationMs: true, metadata: true },
    take: 200_000, // safety cap; admin-only, low cardinality windows
  });

  return aggregatePageTraffic(rows as unknown as TrafficRow[]);
}
