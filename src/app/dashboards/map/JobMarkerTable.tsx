"use client";

import type { JobMarker } from "@/lib/map-types";
import { MARKER_COLORS } from "@/lib/map-colors";

export function JobMarkerTable({
  markers,
  onMarkerClick,
}: {
  markers: JobMarker[];
  onMarkerClick: (m: JobMarker) => void;
}) {
  return (
    <div className="p-4 bg-surface-2 min-h-full">
      <div className="mb-3 text-sm text-muted">
        Google Maps unavailable — showing list view. {markers.length} job{markers.length === 1 ? "" : "s"}.
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted text-xs uppercase">
            <th className="px-2 py-1">Type</th>
            <th className="px-2 py-1">Title</th>
            <th className="px-2 py-1">Address</th>
            <th className="px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {markers.map((m) => (
            <tr
              key={m.id}
              className="border-t border-t-border cursor-pointer hover:bg-surface-elevated"
              onClick={() => onMarkerClick(m)}
            >
              <td className="px-2 py-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                  style={{
                    background: m.scheduled ? MARKER_COLORS[m.kind] : "transparent",
                    border: `2px ${m.scheduled ? "solid" : "dashed"} ${MARKER_COLORS[m.kind]}`,
                  }}
                />
                {m.kind}
              </td>
              <td className="px-2 py-2 text-foreground">{m.title}</td>
              <td className="px-2 py-2 text-muted text-xs">
                {m.address.street}, {m.address.city}, {m.address.state} {m.address.zip}
              </td>
              <td className="px-2 py-2 text-muted">{m.status ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
