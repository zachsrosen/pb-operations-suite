// src/lib/map-aggregator.ts
import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { fetchTodaysServiceJobs, fetchTodaysDnrJobs, fetchTodaysRoofingJobs } from "@/lib/zuper";
import { fetchServiceTickets, resolveTicketAddresses } from "@/lib/hubspot-tickets";
import type {
  CrewPin,
  CrewShopId,
  JobMarker,
  JobMarkerAddress,
  JobMarkerKind,
  MapMarkersResponse,
  MapMode,
  UnplacedMarker,
} from "./map-types";

export interface ResolvedCoords {
  lat: number;
  lng: number;
  source: "cache" | "live";
}

/**
 * Resolve an address to lat/lng via cascade:
 *   1. HubSpotPropertyCache exact-address match (streetAddress + city + state + zip)
 *   2. Live Google geocode (cached in travel-time.ts for 24h)
 *
 * Returns null when the address is incomplete or geocoding fails.
 *
 * For bulk resolution, prefer `resolveAddressesBatch` — it batches the cache
 * lookup into a single Prisma query and parallelizes live calls.
 */
export async function resolveAddressCoords(
  addr: JobMarkerAddress
): Promise<ResolvedCoords | null> {
  if (!addr.street || !addr.city || !addr.state || !addr.zip) {
    return null;
  }

  // 1. Property cache (use streetAddress — Prisma field name)
  try {
    const cached = await prisma.hubSpotPropertyCache.findFirst({
      where: {
        streetAddress: addr.street,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
      },
      select: { latitude: true, longitude: true },
    });
    if (cached?.latitude != null && cached?.longitude != null) {
      return { lat: cached.latitude, lng: cached.longitude, source: "cache" };
    }
  } catch {
    // Fall through to live
  }

  // 2. Live geocode
  const full = `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
  const point = await liveGeocode(full);
  if (point) return { lat: point.lat, lng: point.lng, source: "live" };

  return null;
}

/**
 * Normalize address → stable lowercased dedup key.
 */
function addressDedupKey(a: JobMarkerAddress): string {
  return `${a.street.trim().toLowerCase()}|${a.city.trim().toLowerCase()}|${a.state.trim().toLowerCase()}|${a.zip.trim()}`;
}

/**
 * Batch-resolve N addresses into lat/lng.
 *
 * Strategy:
 *   1. Dedupe by address key (same address on multiple markers → one lookup).
 *   2. ONE Prisma query with `OR` clause matches all complete addresses against the cache.
 *   3. Addresses not in the cache are geocoded live in parallel with bounded concurrency.
 *
 * Returns a Map keyed by `addressDedupKey(addr)` → `ResolvedCoords | null`.
 * Incomplete addresses are absent from the map.
 */
const BATCH_LIVE_CONCURRENCY = 5;

export async function resolveAddressesBatch(
  addresses: JobMarkerAddress[]
): Promise<Map<string, ResolvedCoords | null>> {
  const result = new Map<string, ResolvedCoords | null>();
  // Dedupe + drop incompletes
  const uniqueAddrs = new Map<string, JobMarkerAddress>();
  for (const a of addresses) {
    if (!a.street || !a.city || !a.state || !a.zip) continue;
    const key = addressDedupKey(a);
    if (!uniqueAddrs.has(key)) uniqueAddrs.set(key, a);
  }
  if (uniqueAddrs.size === 0) return result;

  // One Prisma query for all cache hits
  try {
    const ors = Array.from(uniqueAddrs.values()).map((a) => ({
      streetAddress: a.street,
      city: a.city,
      state: a.state,
      zip: a.zip,
    }));
    const cached = await prisma.hubSpotPropertyCache.findMany({
      where: { OR: ors },
      select: { streetAddress: true, city: true, state: true, zip: true, latitude: true, longitude: true },
    });
    for (const row of cached) {
      if (row.latitude == null || row.longitude == null) continue;
      const key = addressDedupKey({
        street: row.streetAddress,
        city: row.city,
        state: row.state,
        zip: row.zip,
      });
      result.set(key, { lat: row.latitude, lng: row.longitude, source: "cache" });
    }
  } catch (e) {
    console.warn("[map] batch cache lookup failed, falling back per-address:", (e as Error).message);
  }

  // Live-geocode anything missing, bounded concurrency
  const missing: Array<[string, JobMarkerAddress]> = [];
  for (const [key, addr] of uniqueAddrs) {
    if (!result.has(key)) missing.push([key, addr]);
  }

  const queue = missing.slice();
  await Promise.all(
    Array.from({ length: Math.min(BATCH_LIVE_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        const [key, addr] = next;
        const full = `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
        try {
          const point = await liveGeocode(full);
          result.set(key, point ? { lat: point.lat, lng: point.lng, source: "live" } : null);
        } catch {
          result.set(key, null);
        }
      }
    })
  );

  return result;
}

export interface BuildResult {
  markers: JobMarker[];
  unplaced: UnplacedMarker[];
}

function projectAddress(p: Project) {
  return {
    street: p.address ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    zip: p.postalCode ?? "",
  };
}

/**
 * Common builder for Project-pipeline marker types (install, inspection, survey).
 * Each type has its own "scheduled date" field on the Project and its own
 * ready-to-schedule signal.
 */
export interface ProjectMarkerSpec {
  kind: "install" | "inspection" | "survey";
  getScheduledAt: (p: Project) => string | null | undefined;
  isReadyToSchedule: (p: Project) => boolean;
  subtitleWhenReady: string;
}

export const PROJECT_MARKER_SPECS: Record<ProjectMarkerSpec["kind"], ProjectMarkerSpec> = {
  install: {
    kind: "install",
    getScheduledAt: (p) => p.constructionScheduleDate,
    isReadyToSchedule: (p) => {
      const s = (p.stage ?? "").toLowerCase();
      return s.includes("ready to build") || s === "rtb";
    },
    subtitleWhenReady: "Ready to build",
  },
  inspection: {
    kind: "inspection",
    getScheduledAt: (p) => p.inspectionScheduleDate,
    isReadyToSchedule: (p) => !!p.readyForInspection && !p.inspectionScheduleDate,
    subtitleWhenReady: "Ready for inspection",
  },
  survey: {
    kind: "survey",
    getScheduledAt: (p) => p.siteSurveyScheduleDate,
    isReadyToSchedule: (p) => {
      // Close-won in sales pipeline + no survey yet = ready-to-schedule survey
      return !p.siteSurveyScheduleDate && !p.isSiteSurveyCompleted && !!p.closeDate;
    },
    subtitleWhenReady: "Ready to schedule",
  },
};

export async function buildProjectMarkers(
  projects: Project[],
  spec: ProjectMarkerSpec,
  _opts: { today: Date }
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];

  // Collect addresses, batch-resolve them once.
  const addresses = projects.map(projectAddress);
  const coordsMap = await resolveAddressesBatch(addresses);

  for (const p of projects) {
    const address = projectAddress(p);
    const id = `${spec.kind}:${p.id}`;
    const title = p.name || `Project ${p.id}`;
    const scheduledAt = spec.getScheduledAt(p);
    const scheduled = !!scheduledAt;

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({ id, kind: spec.kind, title, address, reason: "missing-address" });
      continue;
    }

    const coords = coordsMap.get(addressDedupKey(address));
    if (!coords) {
      unplaced.push({ id, kind: spec.kind, title, address, reason: "geocode-failed" });
      continue;
    }

    markers.push({
      id,
      kind: spec.kind,
      scheduled,
      lat: coords.lat,
      lng: coords.lng,
      address,
      title,
      subtitle: scheduled && scheduledAt
        ? new Date(scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : spec.subtitleWhenReady,
      status: p.stage ?? undefined,
      scheduledAt: scheduled ? scheduledAt ?? undefined : undefined,
      dealId: String(p.id),
      rawStage: p.stage ?? undefined,
      // Job-specific enrichment
      projectNumber: p.projectNumber || undefined,
      pbLocation: p.pbLocation || undefined,
      systemSizeKwDc: p.equipment?.systemSizeKwdc || undefined,
      batteryCount: p.equipment?.battery?.count || undefined,
      batterySizeKwh: p.equipment?.battery?.sizeKwh || undefined,
      evCount: p.equipment?.evCount || undefined,
      ahj: p.ahj || undefined,
      utility: p.utility || undefined,
      installCrew: p.installCrew || undefined,
      projectManager: p.projectManager || undefined,
      dealOwner: p.dealOwner || undefined,
      amount: p.amount || undefined,
      hubspotUrl: p.url || undefined,
      expectedDaysForInstall: p.expectedDaysForInstall || undefined,
      daysForElectricians: p.daysForElectricians || undefined,
      projectType: p.projectType || undefined,
    });
  }

  return { markers, unplaced };
}

/**
 * Back-compat wrapper — delegates to the generic buildProjectMarkers for the
 * install spec. Tests still call this name; new code uses buildProjectMarkers.
 */
export async function buildInstallMarkers(
  projects: Project[],
  opts: { today: Date }
): Promise<BuildResult> {
  return buildProjectMarkers(projects, PROJECT_MARKER_SPECS.install, opts);
}

export interface ZuperJobInput {
  job_uid?: string;
  job_title?: string;
  // Real Zuper job fields — `customer_address` is at the top level of ZuperJob,
  // `scheduled_start_time` is the GET response field (not `scheduled_start_date_time`).
  scheduled_start_time?: string;
  scheduled_start_time_dt?: string | null;
  customer_address?: {
    street?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  };
  // Test fixtures may use a legacy nested shape — keep it accepted for back-compat.
  customer?: {
    customer_address?: {
      street?: string;
      city?: string;
      state?: string;
      zip_code?: string;
    };
  };
  current_job_status?: { status_name?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assigned_to?: Array<{ user_uid?: string } | { user?: any; team?: any }>;
}

/**
 * Build markers from Zuper jobs. Works for any Zuper-sourced kind
 * (service, dnr, roofing) — the kind is attached uniformly.
 */
export async function buildZuperJobMarkers(
  jobs: ZuperJobInput[],
  kind: "service" | "dnr" | "roofing",
  _opts: { today: Date }
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];

  // Pre-compute normalized addresses for each job, then batch-resolve
  const prepared = jobs
    .filter((job) => !!job.job_uid)
    .map((job) => {
      const ca = job.customer_address ?? job.customer?.customer_address;
      return {
        job,
        address: {
          street: ca?.street ?? "",
          city: ca?.city ?? "",
          state: ca?.state ?? "",
          zip: ca?.zip_code ?? "",
        },
      };
    });
  const coordsMap = await resolveAddressesBatch(prepared.map((p) => p.address));

  for (const { job, address } of prepared) {
    const id = `zuperjob:${job.job_uid}`;
    const title = job.job_title || `Service job ${job.job_uid}`;
    const scheduledAt =
      job.scheduled_start_time_dt ||
      job.scheduled_start_time ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (job as any).scheduled_start_date_time ||
      undefined;

    let crewId: string | undefined;
    if (job.assigned_to?.[0]) {
      const a = job.assigned_to[0];
      if ("user_uid" in a && a.user_uid) crewId = a.user_uid;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else if ("user" in a && (a as any).user?.user_uid) crewId = (a as any).user.user_uid;
    }

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({ id, kind, title, address, reason: "missing-address" });
      continue;
    }
    const coords = coordsMap.get(addressDedupKey(address));
    if (!coords) {
      unplaced.push({ id, kind, title, address, reason: "geocode-failed" });
      continue;
    }
    markers.push({
      id,
      kind,
      scheduled: true,
      lat: coords.lat,
      lng: coords.lng,
      address,
      title,
      subtitle: scheduledAt
        ? new Date(scheduledAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : undefined,
      status: job.current_job_status?.status_name,
      scheduledAt: scheduledAt ?? undefined,
      crewId,
      zuperJobUid: job.job_uid,
    });
  }

  return { markers, unplaced };
}

/**
 * Back-compat wrapper — existing tests still call this with `service` implicitly.
 */
export function buildServiceMarkers(
  jobs: ZuperJobInput[],
  opts: { today: Date }
): Promise<BuildResult> {
  return buildZuperJobMarkers(jobs, "service", opts);
}

/**
 * Build unscheduled service ticket markers. Tickets whose address was resolved
 * (via their associated deal) become "ready to schedule" service pins.
 */
export interface ServiceTicketInput {
  id: string;
  title?: string;
  priorityScore?: number;
  stage?: string;
  resolvedAddress?: { street: string; city: string; state: string; zip: string };
}

export async function buildTicketMarkers(
  tickets: ServiceTicketInput[]
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];

  const addresses = tickets
    .map((t) => t.resolvedAddress)
    .filter((a): a is { street: string; city: string; state: string; zip: string } => !!a);
  const coordsMap = await resolveAddressesBatch(addresses);

  for (const t of tickets) {
    const id = `ticket:${t.id}`;
    const title = t.title || `Ticket ${t.id}`;
    const address = t.resolvedAddress ?? { street: "", city: "", state: "", zip: "" };

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({ id, kind: "service", title, address, reason: "missing-address" });
      continue;
    }
    const coords = coordsMap.get(addressDedupKey(address));
    if (!coords) {
      unplaced.push({ id, kind: "service", title, address, reason: "geocode-failed" });
      continue;
    }
    markers.push({
      id,
      kind: "service",
      scheduled: false,
      lat: coords.lat,
      lng: coords.lng,
      address,
      title,
      subtitle: t.stage,
      status: t.stage,
      priorityScore: t.priorityScore,
      ticketId: t.id,
    });
  }

  return { markers, unplaced };
}

export interface CrewMemberInput {
  id: string;
  name: string;
  locations: string[];
  isActive: boolean;
}

const SHOP_MAP: Record<string, CrewShopId> = {
  dtc: "dtc",
  westy: "westy",
  cosp: "cosp",
  ca: "ca",
  camarillo: "camarillo",
  slo: "ca", // SLO shares California bucket
};

function pickShopId(locations: string[]): CrewShopId {
  for (const loc of locations) {
    const mapped = SHOP_MAP[loc.toLowerCase()];
    if (mapped) return mapped;
  }
  return "dtc";
}

export function buildCrewPins(
  crews: CrewMemberInput[],
  markers: JobMarker[]
): CrewPin[] {
  return crews
    .filter((c) => c.isActive)
    .map((c) => {
      const stops = markers
        .filter((m) => m.crewId === c.id && m.scheduled && m.scheduledAt)
        .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));
      const first = stops[0];
      return {
        id: c.id,
        name: c.name,
        shopId: pickShopId(c.locations ?? []),
        currentLat: first?.lat,
        currentLng: first?.lng,
        routeStops: stops.map((s) => ({
          lat: s.lat,
          lng: s.lng,
          time: s.scheduledAt!,
          title: s.title,
          kind: s.kind,
        })),
        working: stops.length > 0,
      };
    });
}

export interface AggregateOptions {
  mode: MapMode;
  types: JobMarkerKind[];
  date?: Date;
  includeUnplaced?: boolean;
}

/**
 * Normalize a JobMarkerAddress to a dedup key (lowercase, trimmed, no punctuation).
 */
function addressKey(addr: { street: string; city: string; state: string; zip: string }): string {
  return [addr.street, addr.city, addr.state, addr.zip]
    .map((s) => s.trim().toLowerCase())
    .join("|");
}

/**
 * Fetch open service tickets + enrich each with an address resolved via the
 * associated deal. Tickets without a resolvable address are returned with
 * `resolvedAddress: undefined` and will be dropped by the aggregator.
 */
async function fetchServiceTicketsWithAddress(): Promise<ServiceTicketInput[]> {
  const ticketItems = await fetchServiceTickets();
  if (ticketItems.length === 0) return [];

  const ids = ticketItems.map((t) => t.id);
  const addressMap = await resolveTicketAddresses(ids);

  return ticketItems.map((t) => ({
    id: t.id,
    title: t.title,
    stage: t.stage,
    resolvedAddress: addressMap.get(t.id),
  }));
}

export async function aggregateMapMarkers(
  opts: AggregateOptions
): Promise<MapMarkersResponse> {
  const today = opts.date ?? new Date();
  const partialFailures: string[] = [];
  const allMarkers: JobMarker[] = [];
  const allUnplaced: UnplacedMarker[] = [];

  const wantInstalls = opts.types.includes("install");
  const wantService = opts.types.includes("service");
  const wantInspection = opts.types.includes("inspection");
  const wantSurvey = opts.types.includes("survey");
  const wantDnr = opts.types.includes("dnr");
  const wantRoofing = opts.types.includes("roofing");
  const wantAnyProjectKind = wantInstalls || wantInspection || wantSurvey;

  // Mode-appropriate date range for service job fetch
  // Today: today only; Week: next 7 days; Backlog: current day (scheduled-only
  // signal for the map, unscheduled service tickets are Phase 3 work).
  const serviceRange = (() => {
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (opts.mode === "week") {
      end.setDate(end.getDate() + 7);
    } else {
      end.setDate(end.getDate() + 1);
    }
    return { from: start, to: end };
  })();

  const [projectsResult, jobsResult, ticketsResult, dnrResult, roofingResult] = await Promise.allSettled([
    wantAnyProjectKind ? fetchAllProjects({ activeOnly: true }) : Promise.resolve([]),
    wantService ? fetchTodaysServiceJobs(serviceRange) : Promise.resolve([]),
    wantService ? fetchServiceTicketsWithAddress() : Promise.resolve([]),
    wantDnr ? fetchTodaysDnrJobs(serviceRange) : Promise.resolve([]),
    wantRoofing ? fetchTodaysRoofingJobs(serviceRange) : Promise.resolve([]),
  ]);

  let projects: Project[] = [];
  if (projectsResult.status === "fulfilled") {
    projects = projectsResult.value as Project[];
  } else {
    partialFailures.push(`hubspot-projects: ${projectsResult.reason?.message ?? "unknown"}`);
  }

  let jobs: ZuperJobInput[] = [];
  if (jobsResult.status === "fulfilled") {
    jobs = jobsResult.value as ZuperJobInput[];
  } else {
    partialFailures.push(`zuper: ${jobsResult.reason?.message ?? "unknown"}`);
  }

  let tickets: ServiceTicketInput[] = [];
  if (ticketsResult.status === "fulfilled") {
    tickets = ticketsResult.value as ServiceTicketInput[];
  } else {
    partialFailures.push(`tickets: ${ticketsResult.reason?.message ?? "unknown"}`);
  }

  let dnrJobs: ZuperJobInput[] = [];
  if (dnrResult.status === "fulfilled") {
    dnrJobs = dnrResult.value as ZuperJobInput[];
  } else {
    partialFailures.push(`zuper-dnr: ${dnrResult.reason?.message ?? "unknown"}`);
  }

  let roofingJobs: ZuperJobInput[] = [];
  if (roofingResult.status === "fulfilled") {
    roofingJobs = roofingResult.value as ZuperJobInput[];
  } else {
    partialFailures.push(`zuper-roofing: ${roofingResult.reason?.message ?? "unknown"}`);
  }

  // Project-pipeline marker kinds (install, inspection, survey)
  const projectKinds: ProjectMarkerSpec["kind"][] = [];
  if (wantInstalls) projectKinds.push("install");
  if (wantInspection) projectKinds.push("inspection");
  if (wantSurvey) projectKinds.push("survey");

  for (const kind of projectKinds) {
    const spec = PROJECT_MARKER_SPECS[kind];
    const scopedProjects = filterProjectsByMode(projects, opts.mode, today, spec);
    const { markers, unplaced } = await buildProjectMarkers(scopedProjects, spec, { today });
    allMarkers.push(...markers);
    allUnplaced.push(...unplaced);
  }

  if (wantService) {
    const { markers: jobMarkers, unplaced: jobUnplaced } = await buildServiceMarkers(jobs, { today });
    allMarkers.push(...jobMarkers);
    allUnplaced.push(...jobUnplaced);

    // Suppress ticket markers whose address already shows as a Zuper job (dedupe by address hash).
    const addressKeys = new Set(jobMarkers.map((m) => addressKey(m.address)));
    const filteredTickets = tickets.filter((t) =>
      !t.resolvedAddress || !addressKeys.has(addressKey(t.resolvedAddress))
    );
    const { markers: ticketMarkers, unplaced: ticketUnplaced } = await buildTicketMarkers(filteredTickets);
    allMarkers.push(...ticketMarkers);
    allUnplaced.push(...ticketUnplaced);
  }

  if (wantDnr) {
    const { markers, unplaced } = await buildZuperJobMarkers(dnrJobs, "dnr", { today });
    allMarkers.push(...markers);
    allUnplaced.push(...unplaced);
  }

  if (wantRoofing) {
    const { markers, unplaced } = await buildZuperJobMarkers(roofingJobs, "roofing", { today });
    allMarkers.push(...markers);
    allUnplaced.push(...unplaced);
  }

  // Crews — select Prisma-correct fields: isActive, locations
  let crews: CrewPin[] = [];
  try {
    const crewMembers = await prisma.crewMember.findMany({
      where: { isActive: true },
      select: { id: true, name: true, locations: true, isActive: true },
    });
    crews = buildCrewPins(crewMembers, allMarkers);
  } catch (e) {
    partialFailures.push(`crews: ${(e as Error).message}`);
  }

  const response: MapMarkersResponse = {
    markers: allMarkers,
    crews,
    lastUpdated: new Date().toISOString(),
    droppedCount: allUnplaced.length,
  };
  if (partialFailures.length > 0) response.partialFailures = partialFailures;
  if (opts.includeUnplaced) response.unplaced = allUnplaced;
  return response;
}

/**
 * Pre-construction stages considered "ready to schedule" in Backlog mode.
 * Matches fuzzily (case-insensitive substring) so minor stage-name drift in
 * HubSpot doesn't break the filter.
 */
const BACKLOG_STAGE_PATTERNS = [
  "ready to build",
  "rtb",
  "permit approved",
  "design complete",
  "blocked",
  "survey complete",
  "design review",
  "permitting",
  "interconnection",
];

function stageMatchesBacklog(stage: string): boolean {
  const lower = stage.toLowerCase();
  return BACKLOG_STAGE_PATTERNS.some((p) => lower.includes(p));
}

function filterProjectsByMode(
  projects: Project[],
  mode: MapMode,
  today: Date,
  spec: ProjectMarkerSpec
): Project[] {
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const weekEnd = new Date(dayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  if (mode === "today") {
    return projects.filter((p) => {
      const at = spec.getScheduledAt(p);
      if (at) {
        const d = new Date(at);
        if (d >= dayStart && d < dayEnd) return true;
      }
      return spec.isReadyToSchedule(p);
    });
  }

  if (mode === "week") {
    return projects.filter((p) => {
      const at = spec.getScheduledAt(p);
      if (at) {
        const d = new Date(at);
        if (d >= dayStart && d < weekEnd) return true;
      }
      return spec.isReadyToSchedule(p);
    });
  }

  // Backlog: full geography — scheduled (any date) + ready-to-schedule +
  // any pre-construction stage candidate. Install uses the broad stage
  // allowlist; inspection/survey just use the kind's own readiness signal
  // since those have a narrower set of "ready" states.
  return projects.filter((p) => {
    if (spec.getScheduledAt(p)) return true;
    if (spec.isReadyToSchedule(p)) return true;
    if (spec.kind === "install") return stageMatchesBacklog(p.stage ?? "");
    return false;
  });
}
