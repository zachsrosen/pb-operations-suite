"use client";

import type { JobMarker } from "@/lib/map-types";

/**
 * Convert markers to CSV and trigger a browser download.
 * CSV schema: id, kind, scheduled, title, address, city, state, zip,
 * scheduledAt, crewId, status, stage, lat, lng.
 */
export function downloadMarkersCsv(markers: JobMarker[], filename = "map-jobs.csv") {
  const headers = [
    "id",
    "kind",
    "scheduled",
    "title",
    "address",
    "city",
    "state",
    "zip",
    "scheduledAt",
    "crewId",
    "status",
    "stage",
    "lat",
    "lng",
  ];

  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [headers.join(",")];
  for (const m of markers) {
    lines.push(
      [
        m.id,
        m.kind,
        m.scheduled,
        m.title,
        m.address.street,
        m.address.city,
        m.address.state,
        m.address.zip,
        m.scheduledAt ?? "",
        m.crewId ?? "",
        m.status ?? "",
        m.rawStage ?? "",
        m.lat.toFixed(6),
        m.lng.toFixed(6),
      ]
        .map(escape)
        .join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
