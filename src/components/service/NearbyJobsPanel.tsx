"use client";

/**
 * NearbyJobsPanel
 *
 * Surfaces unscheduled work that is geographically close to today's scheduled
 * jobs. Field crews and dispatchers use this to add an inspection or service
 * visit to a route they're already running.
 *
 * Sources data from /api/map/markers, splits markers into scheduled vs
 * unscheduled, then for each scheduled "anchor" finds unscheduled "candidates"
 * within `radiusMiles` using the haversine helper.
 *
 * Filters:
 *   - anchorKinds:    which scheduled jobs anchor the search (default: install)
 *   - candidateKinds: which unscheduled jobs are surfaced (default: inspection, service)
 *   - radiusMiles:    proximity threshold (default: 15)
 *
 * Resolves Freshservice INC-466 (Nearby Jobs) and INC-467 (Nearby
 * inspections/service visits — electricians).
 */

import { useEffect, useMemo, useState } from "react";
import { LOB_COLORS, type LobKey } from "@/lib/lob-colors";
import { nearbyMarkers, type MarkerWithDistance } from "@/lib/map-proximity";
import type { JobMarker, JobMarkerKind } from "@/lib/map-types";

interface MarkersApiResponse {
  markers: JobMarker[];
}

const DEFAULT_RADIUS_MILES = 15;
const RADIUS_OPTIONS = [10, 15, 25, 50] as const;

const KIND_LABELS: Record<JobMarkerKind, string> = {
  install: "Construction",
  service: "Service",
  inspection: "Inspection",
  survey: "Survey",
  dnr: "D&R",
  roofing: "Roofing",
};

/** Map JobMarkerKind → LobKey for color tokens. "install" maps to "construction". */
const KIND_TO_LOB: Record<JobMarkerKind, LobKey> = {
  install: "construction",
  service: "service",
  inspection: "inspection",
  survey: "survey",
  dnr: "dnr",
  roofing: "roofing",
};

const ALL_KINDS: JobMarkerKind[] = ["install", "service", "inspection", "survey", "dnr", "roofing"];

interface NearbyGroup {
  anchor: JobMarker;
  candidates: MarkerWithDistance[];
}

export interface NearbyJobsPanelProps {
  /** Initial anchor kinds. Defaults to ["install"] (#467 electricians use case). */
  initialAnchorKinds?: JobMarkerKind[];
  /** Initial candidate kinds. Defaults to ["inspection", "service"]. */
  initialCandidateKinds?: JobMarkerKind[];
  /** Initial radius in miles. Defaults to 15. */
  initialRadiusMiles?: number;
}

export default function NearbyJobsPanel({
  initialAnchorKinds = ["install"],
  initialCandidateKinds = ["inspection", "service"],
  initialRadiusMiles = DEFAULT_RADIUS_MILES,
}: NearbyJobsPanelProps) {
  const [anchorKinds, setAnchorKinds] = useState<Set<JobMarkerKind>>(
    () => new Set(initialAnchorKinds),
  );
  const [candidateKinds, setCandidateKinds] = useState<Set<JobMarkerKind>>(
    () => new Set(initialCandidateKinds),
  );
  const [radiusMiles, setRadiusMiles] = useState<number>(initialRadiusMiles);
  const [markers, setMarkers] = useState<JobMarker[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all today's markers across every kind so toggles are instant
  // (no refetch when the user changes filters).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          mode: "today",
          types: ALL_KINDS.join(","),
        });
        const res = await fetch(`/api/map/markers?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`markers ${res.status}`);
        const data = (await res.json()) as MarkersApiResponse;
        if (!cancelled) setMarkers(data.markers ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load markers");
          setMarkers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build groups: each scheduled anchor → its unscheduled neighbors within radius.
  const groups = useMemo<NearbyGroup[]>(() => {
    if (markers.length === 0) return [];
    const anchors = markers.filter(
      (m) => m.scheduled && anchorKinds.has(m.kind),
    );
    const candidates = markers.filter(
      (m) => !m.scheduled && candidateKinds.has(m.kind),
    );
    if (anchors.length === 0 || candidates.length === 0) return [];

    return anchors
      .map((anchor) => ({
        anchor,
        candidates: nearbyMarkers(
          { lat: anchor.lat, lng: anchor.lng },
          candidates,
          { maxMiles: radiusMiles, limit: 10 },
        ),
      }))
      .filter((g) => g.candidates.length > 0)
      .sort((a, b) => b.candidates.length - a.candidates.length);
  }, [markers, anchorKinds, candidateKinds, radiusMiles]);

  const totalCandidates = groups.reduce((s, g) => s + g.candidates.length, 0);
  // Same candidate may appear under multiple anchors; surface unique count too.
  const uniqueCandidateIds = new Set<string>();
  for (const g of groups) for (const c of g.candidates) uniqueCandidateIds.add(c.id);

  function toggleSet<T>(s: Set<T>, value: T): Set<T> {
    const next = new Set(s);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  return (
    <div className="bg-surface rounded-xl border border-t-border p-4 mb-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold mr-auto">
          Nearby Unscheduled Work
          {!loading && (
            <span className="ml-2 text-sm font-normal text-muted">
              ({uniqueCandidateIds.size} unique within {radiusMiles}mi)
            </span>
          )}
        </h2>

        <label className="text-xs text-muted flex items-center gap-2">
          Radius
          <select
            value={radiusMiles}
            onChange={(e) => setRadiusMiles(Number(e.target.value))}
            className="bg-surface-2 border border-t-border rounded px-2 py-1 text-foreground text-xs"
          >
            {RADIUS_OPTIONS.map((mi) => (
              <option key={mi} value={mi}>
                {mi} mi
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-4 mb-4">
        <FilterPills
          label="Anchor (scheduled)"
          selected={anchorKinds}
          onToggle={(k) => setAnchorKinds((s) => toggleSet(s, k))}
        />
        <FilterPills
          label="Candidates (unscheduled)"
          selected={candidateKinds}
          onToggle={(k) => setCandidateKinds((s) => toggleSet(s, k))}
        />
      </div>

      {loading && (
        <div className="text-muted text-sm py-8 text-center">Loading nearby work…</div>
      )}

      {error && !loading && (
        <div className="text-rose-400 text-sm py-4">Failed to load: {error}</div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="text-muted text-sm py-8 text-center">
          No unscheduled work within {radiusMiles} miles of today&apos;s scheduled jobs
          {anchorKinds.size === 0 || candidateKinds.size === 0
            ? " — pick at least one Anchor and one Candidate type above."
            : "."}
        </div>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((g) => (
            <NearbyGroupCard key={g.anchor.id} group={g} />
          ))}
        </div>
      )}

      {!loading && !error && totalCandidates > 0 && (
        <div className="text-xs text-muted mt-3">
          {totalCandidates} candidate{totalCandidates === 1 ? "" : "s"} across {groups.length} scheduled job
          {groups.length === 1 ? "" : "s"}. Same candidate may appear under multiple anchors.
        </div>
      )}
    </div>
  );
}

function FilterPills({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: Set<JobMarkerKind>;
  onToggle: (k: JobMarkerKind) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted mr-1">{label}:</span>
      {ALL_KINDS.map((k) => {
        const lob = LOB_COLORS[KIND_TO_LOB[k]];
        const active = selected.has(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => onToggle(k)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              active
                ? `${lob.badgeBg} ${lob.badgeText} border-transparent`
                : "border-t-border text-muted hover:text-foreground"
            }`}
          >
            {KIND_LABELS[k]}
          </button>
        );
      })}
    </div>
  );
}

function NearbyGroupCard({ group }: { group: NearbyGroup }) {
  const { anchor, candidates } = group;
  const anchorLob = LOB_COLORS[KIND_TO_LOB[anchor.kind]];

  return (
    <div className="bg-surface-2 rounded-lg border border-t-border overflow-hidden">
      <div className={`flex items-center gap-2 px-3 py-2 border-l-4 ${anchorLob.borderLeft}`}>
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold ${anchorLob.badgeText} ${anchorLob.badgeBg} px-1.5 py-0.5 rounded`}
        >
          {KIND_LABELS[anchor.kind]}
        </span>
        <span className="text-sm font-medium truncate">{anchor.title}</span>
        <span className="text-xs text-muted truncate">
          {anchor.address.street}, {anchor.address.city}
        </span>
        {anchor.crewName && (
          <span className="text-xs text-muted ml-auto whitespace-nowrap">{anchor.crewName}</span>
        )}
      </div>
      <ul className="divide-y divide-t-border">
        {candidates.map((c) => (
          <li
            key={c.id}
            className="px-3 py-2 flex items-center gap-3 hover:bg-surface/50 transition-colors"
          >
            <span
              className={`w-2 h-2 rounded-full ${LOB_COLORS[KIND_TO_LOB[c.kind]].dot} flex-shrink-0`}
              aria-label={KIND_LABELS[c.kind]}
            />
            <span className={`text-[10px] uppercase font-semibold ${LOB_COLORS[KIND_TO_LOB[c.kind]].text} w-16 flex-shrink-0`}>
              {KIND_LABELS[c.kind]}
            </span>
            <span className="text-sm truncate flex-1">
              <span className="font-medium">{c.title}</span>
              <span className="text-muted ml-2">
                {c.address.street}, {c.address.city}
              </span>
            </span>
            <span className="text-xs text-amber-400 font-mono whitespace-nowrap">
              {c.distanceMiles.toFixed(1)} mi
            </span>
            {c.hubspotUrl ? (
              <a
                href={c.hubspotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap"
              >
                Open
              </a>
            ) : (
              <a
                href={`/dashboards/map?focus=${encodeURIComponent(c.id)}`}
                className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap"
              >
                Map
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
