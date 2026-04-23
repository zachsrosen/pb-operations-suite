// src/lib/map-aggregator.ts
import { prisma } from "@/lib/db";
import { geocodeAddress as liveGeocode } from "@/lib/travel-time";
import type { Project } from "@/lib/hubspot";
import type { JobMarker, JobMarkerAddress, UnplacedMarker } from "./map-types";

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
