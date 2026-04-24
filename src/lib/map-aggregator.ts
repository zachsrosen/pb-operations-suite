// src/lib/map-aggregator.ts
import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { fetchTodaysServiceJobs } from "@/lib/zuper";
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

export interface BuildResult {
  markers: JobMarker[];
  unplaced: UnplacedMarker[];
}

function isInstallScheduled(project: Project): boolean {
  return !!project.constructionScheduleDate;
}

function projectAddress(p: Project) {
  return {
    street: p.address ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    zip: p.postalCode ?? "",
  };
}

export async function buildInstallMarkers(
  projects: Project[],
  _opts: { today: Date }
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];

  for (const p of projects) {
    const address = projectAddress(p);
    const id = `install:${p.id}`;
    const title = p.name || `Project ${p.id}`;

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({
        id, kind: "install", title, address, reason: "missing-address",
      });
      continue;
    }

    const coords = await resolveAddressCoords(address);
    if (!coords) {
      unplaced.push({
        id, kind: "install", title, address, reason: "geocode-failed",
      });
      continue;
    }

    const scheduled = isInstallScheduled(p);
    markers.push({
      id,
      kind: "install",
      scheduled,
      lat: coords.lat,
      lng: coords.lng,
      address,
      title,
      subtitle: scheduled ? formatInstallSubtitle(p) : "Ready to schedule",
      status: p.stage ?? undefined,
      scheduledAt: scheduled ? p.constructionScheduleDate ?? undefined : undefined,
      dealId: String(p.id),
      rawStage: p.stage ?? undefined,
    });
  }

  return { markers, unplaced };
}

function formatInstallSubtitle(p: Project): string {
  const when = p.constructionScheduleDate
    ? new Date(p.constructionScheduleDate).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return when;
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

export async function buildServiceMarkers(
  jobs: ZuperJobInput[],
  _opts: { today: Date }
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];

  // Zuper jobs = scheduled service markers
  for (const job of jobs) {
    if (!job.job_uid) continue; // defensive
    // Prefer top-level customer_address (real Zuper shape), fall back to nested (legacy/tests)
    const ca = job.customer_address ?? job.customer?.customer_address;
    const address = {
      street: ca?.street ?? "",
      city: ca?.city ?? "",
      state: ca?.state ?? "",
      zip: ca?.zip_code ?? "",
    };
    const id = `zuperjob:${job.job_uid}`;
    const title = job.job_title || `Service job ${job.job_uid}`;
    // Accept either scheduled_start_time (real GET response) or scheduled_start_date_time (legacy)
    const scheduledAt =
      job.scheduled_start_time_dt ||
      job.scheduled_start_time ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (job as any).scheduled_start_date_time ||
      undefined;

    // Extract a crewId from the assigned_to array — handles both POST and GET shapes.
    let crewId: string | undefined;
    if (job.assigned_to?.[0]) {
      const a = job.assigned_to[0];
      if ("user_uid" in a && a.user_uid) crewId = a.user_uid;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else if ("user" in a && (a as any).user?.user_uid) crewId = (a as any).user.user_uid;
    }

    if (!address.street || !address.city || !address.state || !address.zip) {
      unplaced.push({ id, kind: "service", title, address, reason: "missing-address" });
      continue;
    }
    const coords = await resolveAddressCoords(address);
    if (!coords) {
      unplaced.push({ id, kind: "service", title, address, reason: "geocode-failed" });
      continue;
    }
    markers.push({
      id,
      kind: "service",
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

export async function aggregateMapMarkers(
  opts: AggregateOptions
): Promise<MapMarkersResponse> {
  const today = opts.date ?? new Date();
  const partialFailures: string[] = [];
  const allMarkers: JobMarker[] = [];
  const allUnplaced: UnplacedMarker[] = [];

  const wantInstalls = opts.types.includes("install");
  const wantService = opts.types.includes("service");

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

  const [projectsResult, jobsResult] = await Promise.allSettled([
    wantInstalls ? fetchAllProjects({ activeOnly: true }) : Promise.resolve([]),
    wantService ? fetchTodaysServiceJobs(serviceRange) : Promise.resolve([]),
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

  if (wantInstalls) {
    const scopedProjects = filterProjectsByMode(projects, opts.mode, today);
    const { markers, unplaced } = await buildInstallMarkers(scopedProjects, { today });
    allMarkers.push(...markers);
    allUnplaced.push(...unplaced);
  }

  if (wantService) {
    const { markers, unplaced } = await buildServiceMarkers(jobs, { today });
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
  today: Date
): Project[] {
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const weekEnd = new Date(dayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  if (mode === "today") {
    // Scheduled today OR ready-to-schedule
    return projects.filter((p) => {
      if (p.constructionScheduleDate) {
        const d = new Date(p.constructionScheduleDate);
        if (d >= dayStart && d < dayEnd) return true;
      }
      const stage = p.stage ?? "";
      return stage.toLowerCase().includes("ready to build") || stage.toLowerCase() === "rtb";
    });
  }

  if (mode === "week") {
    // Scheduled anywhere in the next 7 days OR ready-to-schedule
    return projects.filter((p) => {
      if (p.constructionScheduleDate) {
        const d = new Date(p.constructionScheduleDate);
        if (d >= dayStart && d < weekEnd) return true;
      }
      const stage = p.stage ?? "";
      return stage.toLowerCase().includes("ready to build") || stage.toLowerCase() === "rtb";
    });
  }

  // Backlog: every pre-construction project that's a candidate to schedule.
  // Scheduled projects (with construction_schedule_date) are also included so
  // dispatchers see the full geography.
  return projects.filter((p) => {
    if (p.constructionScheduleDate) return true;
    return stageMatchesBacklog(p.stage ?? "");
  });
}
