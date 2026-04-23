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
  job_uid: string;
  job_title?: string;
  scheduled_start_date_time?: string;
  customer?: {
    customer_address?: {
      street?: string;
      city?: string;
      state?: string;
      zip_code?: string;
    };
  };
  current_job_status?: { status_name?: string };
  assigned_to?: Array<{ user_uid?: string }>;
}

export async function buildServiceMarkers(
  jobs: ZuperJobInput[],
  _opts: { today: Date }
): Promise<BuildResult> {
  const markers: JobMarker[] = [];
  const unplaced: UnplacedMarker[] = [];

  // Zuper jobs = scheduled service markers (Phase 1 scope)
  for (const job of jobs) {
    const ca = job.customer?.customer_address;
    const address = {
      street: ca?.street ?? "",
      city: ca?.city ?? "",
      state: ca?.state ?? "",
      zip: ca?.zip_code ?? "",
    };
    const id = `zuperjob:${job.job_uid}`;
    const title = job.job_title || `Service job ${job.job_uid}`;

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
      subtitle: job.scheduled_start_date_time
        ? new Date(job.scheduled_start_date_time).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : undefined,
      status: job.current_job_status?.status_name,
      scheduledAt: job.scheduled_start_date_time,
      crewId: job.assigned_to?.[0]?.user_uid,
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

  const [projectsResult, jobsResult] = await Promise.allSettled([
    wantInstalls ? fetchAllProjects({ activeOnly: true }) : Promise.resolve([]),
    wantService ? fetchTodaysServiceJobs() : Promise.resolve([]),
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

function filterProjectsByMode(
  projects: Project[],
  mode: MapMode,
  today: Date
): Project[] {
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  if (mode === "today") {
    // Scheduled today OR RTB (ready-to-schedule)
    return projects.filter((p) => {
      if (p.constructionScheduleDate) {
        const d = new Date(p.constructionScheduleDate);
        if (d >= dayStart && d < dayEnd) return true;
      }
      const stage = (p.stage ?? "").toLowerCase();
      return stage.includes("ready to build") || stage === "rtb";
    });
  }
  // Phase 1 only implements today mode; week/backlog fall through.
  return projects.filter((p) => !!p.constructionScheduleDate);
}
