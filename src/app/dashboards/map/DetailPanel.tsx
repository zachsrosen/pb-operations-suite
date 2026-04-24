"use client";

import type { JobMarker, CrewPin } from "@/lib/map-types";
import { MARKER_COLORS } from "@/lib/map-colors";
import { nearbyMarkers, closestCrews } from "@/lib/map-proximity";
import Link from "next/link";

interface DetailPanelProps {
  marker: JobMarker;
  markers: JobMarker[];   // full set, for proximity
  crews: CrewPin[];
  onClose: () => void;
}

export function DetailPanel({ marker, markers, crews, onClose }: DetailPanelProps) {
  const isTicket = marker.kind === "service" && !marker.scheduled;
  const nearby = nearbyMarkers(
    { lat: marker.lat, lng: marker.lng },
    markers,
    { maxMiles: 10, limit: 5, excludeId: marker.id }
  );
  const nearestCrews = isTicket
    ? closestCrews({ lat: marker.lat, lng: marker.lng }, crews, { maxMiles: 15, limit: 3 })
    : [];

  return (
    <aside
      className="absolute right-0 top-0 bottom-0 w-[380px] bg-surface border-l border-t-border overflow-y-auto z-20 shadow-xl"
      aria-label="Job detail panel"
    >
      <header className="flex items-start gap-2 p-4 border-b border-t-border">
        {marker.scheduled ? (
          <span
            className="inline-block w-3.5 h-3.5 rounded-full mt-1 flex-shrink-0"
            style={{
              background: MARKER_COLORS[marker.kind],
              border: "2px solid #0b1220",
            }}
          />
        ) : (
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full mt-1 flex-shrink-0"
            style={{
              background: "white",
              border: `2.5px solid ${MARKER_COLORS[marker.kind]}`,
            }}
          >
            <span className="w-1 h-1 rounded-full" style={{ background: MARKER_COLORS[marker.kind] }} />
          </span>
        )}
        <div className="flex-1">
          <h2 className="text-foreground font-semibold">{marker.title}</h2>
          <div className="text-xs text-muted">
            {marker.dealId ? `PROJ-${marker.dealId}` : marker.ticketId ? `TICKET-${marker.ticketId}` : ""} · {capitalize(marker.kind)} · {marker.scheduled ? "Scheduled" : "Ready to schedule"}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted hover:text-foreground">×</button>
      </header>

      {marker.scheduled && (
        <Section label="Schedule">
          <KV k="When" v={marker.scheduledAt ? new Date(marker.scheduledAt).toLocaleString() : "—"} />
          {marker.status && <KV k="Status" v={marker.status} />}
        </Section>
      )}

      {isTicket && marker.priorityScore != null && (
        <Section label="Priority">
          <KV k="Score" v={<strong className="text-red-400">{marker.priorityScore}</strong>} />
          {marker.status && <KV k="Stage" v={marker.status} />}
        </Section>
      )}

      <Section label="Location">
        <div className="text-foreground text-sm">{marker.address.street}</div>
        <div className="text-xs text-muted">
          {marker.address.city}, {marker.address.state} {marker.address.zip}
        </div>
      </Section>

      {nearestCrews.length > 0 && (
        <Section label="Closest crew today">
          {nearestCrews.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-1 text-xs">
              <span className="text-foreground flex-1">{c.name}</span>
              <span className="text-blue-400 font-semibold">{c.distanceMiles.toFixed(1)} mi</span>
            </div>
          ))}
        </Section>
      )}

      {nearby.length > 0 && (
        <Section label="Nearby open work">
          {nearby.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1 text-xs">
              {m.scheduled ? (
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{
                    background: MARKER_COLORS[m.kind],
                    border: "1.5px solid #0b1220",
                  }}
                />
              ) : (
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{
                    background: "white",
                    border: `2px solid ${MARKER_COLORS[m.kind]}`,
                  }}
                />
              )}
              <span className="text-foreground flex-1 truncate">
                {m.title}
                {!m.scheduled && <span className="text-muted ml-1">· ready</span>}
              </span>
              <span className="text-blue-400 font-semibold">{m.distanceMiles.toFixed(1)} mi</span>
            </div>
          ))}
        </Section>
      )}

      <Section label="">
        <div className="flex flex-wrap gap-2">
          {isTicket && (
            <Link
              href={`/dashboards/service-scheduler?ticketId=${marker.ticketId}`}
              className="px-3 py-2 rounded text-xs font-semibold bg-orange-500 text-white"
            >
              Schedule this
            </Link>
          )}
          {!isTicket && marker.kind === "install" && !marker.scheduled && (
            <Link
              href={`/dashboards/construction-scheduler?dealId=${marker.dealId}`}
              className="px-3 py-2 rounded text-xs font-semibold bg-orange-500 text-white"
            >
              Schedule this
            </Link>
          )}
          {marker.dealId && (
            <a
              href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? ""}/record/0-3/${marker.dealId}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-2 text-foreground border border-t-border"
            >
              Open in HubSpot
            </a>
          )}
          {marker.ticketId && (
            <a
              href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? ""}/record/0-5/${marker.ticketId}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-2 text-foreground border border-t-border"
            >
              Open ticket
            </a>
          )}
        </div>
      </Section>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-b border-t-border">
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 font-semibold">
          {label}
        </div>
      )}
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-x-2 text-xs py-0.5">
      <span className="text-muted">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
