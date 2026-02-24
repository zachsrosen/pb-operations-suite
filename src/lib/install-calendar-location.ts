import { COMPLIANCE_TEAM_OVERRIDES } from "@/lib/compliance-team-overrides";
import { normalizeLocationForInstallCalendars } from "@/lib/google-calendar";

type InstallBucket = "dtc" | "westy" | "cosp" | "california" | "camarillo";

const NAME_FALLBACKS: Array<{ matcher: RegExp; location: string }> = [
  { matcher: /\bdrew perry\b/i, location: "Centennial" },
  { matcher: /\bjoe lynch\b/i, location: "Westminster" },
  { matcher: /\brolando\b/i, location: "Colorado Springs" },
  // Legacy master-scheduler crew labels (stored in older schedule records)
  { matcher: /\bdtc\b.*\balpha\b|\balpha\b.*\bdtc\b/i, location: "Centennial" },
  { matcher: /\bwesty\b.*\balpha\b|\balpha\b.*\bwesty\b/i, location: "Westminster" },
  { matcher: /\bcosp\b.*\balpha\b|\balpha\b.*\bcosp\b/i, location: "Colorado Springs" },
];

function canonicalLocationFromBucket(bucket: InstallBucket): string {
  if (bucket === "dtc") return "Centennial";
  if (bucket === "westy") return "Westminster";
  if (bucket === "california") return "San Luis Obispo";
  if (bucket === "camarillo") return "Camarillo";
  return "Colorado Springs";
}

function firstUuid(value?: string | null): string | null {
  if (!value) return null;
  const match = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] || null;
}

function resolveByLocationString(location?: string | null): { location: string; bucket: InstallBucket } | null {
  const bucket = normalizeLocationForInstallCalendars(location);
  if (!bucket) return null;
  return {
    location: canonicalLocationFromBucket(bucket),
    bucket,
  };
}

function resolveByFallbackLabel(value?: string | null): { location: string; bucket: InstallBucket } | null {
  const label = (value || "").trim();
  if (!label) return null;
  const byLabel = NAME_FALLBACKS.find((entry) => entry.matcher.test(label));
  if (!byLabel) return null;
  return resolveByLocationString(byLabel.location);
}

export function resolveInstallCalendarLocation(params: {
  pbLocation?: string | null;
  assignedUserUid?: string | null;
  assignedUserName?: string | null;
}): {
  location: string | null;
  bucket: InstallBucket | null;
  source: "pb_location" | "assigned_user_uid" | "assigned_user_name" | "unknown";
} {
  const byPbLocation = resolveByLocationString(params.pbLocation);
  if (byPbLocation) {
    return { ...byPbLocation, source: "pb_location" };
  }

  const uid = firstUuid(params.assignedUserUid);
  if (uid) {
    const mappedLocation = COMPLIANCE_TEAM_OVERRIDES[uid];
    const byUid = resolveByLocationString(mappedLocation);
    if (byUid) {
      return { ...byUid, source: "assigned_user_uid" };
    }
  }
  const byUidLabel = resolveByFallbackLabel(params.assignedUserUid);
  if (byUidLabel) {
    return { ...byUidLabel, source: "assigned_user_uid" };
  }

  const byName = resolveByFallbackLabel(params.assignedUserName);
  if (byName) {
    return { ...byName, source: "assigned_user_name" };
  }

  return { location: null, bucket: null, source: "unknown" };
}

export function getInstallCalendarTimezone(bucket: InstallBucket | null): string | null {
  if (!bucket) return null;
  if (bucket === "california" || bucket === "camarillo") {
    return "America/Los_Angeles";
  }
  return "America/Denver";
}
