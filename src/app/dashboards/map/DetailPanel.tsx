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
      className="absolute z-20 bg-surface overflow-y-auto shadow-xl
        right-0 bottom-0 left-0 top-1/2 border-t border-t-border
        sm:top-0 sm:left-auto sm:w-[380px] sm:border-t-0 sm:border-l sm:border-l-t-border"
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
        <div className="flex-1 min-w-0">
          <h2 className="text-foreground font-semibold truncate">{marker.title}</h2>
          <div className="text-xs text-muted truncate">
            {marker.projectNumber
              ? marker.projectNumber
              : marker.ticketId
              ? `Ticket #${marker.ticketId}`
              : marker.zuperJobUid
              ? `Zuper ${marker.zuperJobUid.slice(0, 8)}`
              : ""}
            {" · "}{capitalize(marker.kind)}
            {" · "}{marker.scheduled ? "Scheduled" : "Ready to schedule"}
            {marker.pbLocation && ` · ${marker.pbLocation}`}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted hover:text-foreground">×</button>
      </header>

      {marker.scheduled && (
        <Section label="Schedule">
          <KV k="When" v={marker.scheduledAt ? new Date(marker.scheduledAt).toLocaleString() : "—"} />
          {marker.status && <KV k="Status" v={marker.status} />}
          {marker.installCrew && <KV k="Crew" v={marker.installCrew} />}
          {marker.expectedDaysForInstall != null && (
            <KV k="Days" v={`${marker.expectedDaysForInstall} install day${marker.expectedDaysForInstall === 1 ? "" : "s"}`} />
          )}
        </Section>
      )}

      {!marker.scheduled && marker.status && (
        <Section label="Stage">
          <div className="text-foreground text-sm">{marker.status}</div>
        </Section>
      )}

      {isTicket && marker.priorityScore != null && (
        <Section label="Priority">
          <KV k="Score" v={<strong className="text-red-400">{marker.priorityScore}</strong>} />
        </Section>
      )}

      <Section label="Location">
        <div className="text-foreground text-sm">{marker.address.street}</div>
        <div className="text-xs text-muted">
          {marker.address.city}, {marker.address.state} {marker.address.zip}
        </div>
        {(marker.ahj || marker.utility || marker.pbLocation) && (
          <div className="mt-2 text-xs text-muted space-y-0.5">
            {marker.pbLocation && <div>Shop: <span className="text-foreground">{marker.pbLocation}</span></div>}
            {marker.ahj && <div>AHJ: <span className="text-foreground">{marker.ahj}</span></div>}
            {marker.utility && <div>Utility: <span className="text-foreground">{marker.utility}</span></div>}
          </div>
        )}
      </Section>

      {(marker.systemSizeKwDc != null || marker.batteryCount || marker.projectType) && (
        <Section label="System">
          {marker.projectType && <KV k="Type" v={marker.projectType} />}
          {marker.systemSizeKwDc != null && marker.systemSizeKwDc > 0 && (
            <KV k="Size" v={`${marker.systemSizeKwDc.toFixed(2)} kW DC`} />
          )}
          {marker.batteryCount && marker.batteryCount > 0 && (
            <KV
              k="Battery"
              v={`${marker.batteryCount} × ${marker.batterySizeKwh ? marker.batterySizeKwh + " kWh" : "battery"}`}
            />
          )}
          {marker.evCount != null && marker.evCount > 0 && <KV k="EV" v={`${marker.evCount} charger${marker.evCount === 1 ? "" : "s"}`} />}
          {marker.amount != null && marker.amount > 0 && (
            <KV k="Value" v={`$${Math.round(marker.amount).toLocaleString()}`} />
          )}
        </Section>
      )}

      {(marker.projectManager || marker.dealOwner) && (
        <Section label="Team">
          {marker.projectManager && <KV k="PM" v={marker.projectManager} />}
          {marker.dealOwner && <KV k="Owner" v={marker.dealOwner} />}
        </Section>
      )}

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
          {scheduleLink(marker) && (
            <Link
              href={scheduleLink(marker)!}
              className="px-3 py-2 rounded text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white"
            >
              {marker.scheduled ? "Open in scheduler" : "Schedule this"}
            </Link>
          )}
          {marker.hubspotUrl ? (
            <a
              href={marker.hubspotUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-2 text-foreground border border-t-border"
            >
              Open in HubSpot
            </a>
          ) : marker.dealId ? (
            <a
              href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? ""}/record/0-3/${marker.dealId}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-2 text-foreground border border-t-border"
            >
              Open in HubSpot
            </a>
          ) : null}
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
          {marker.zuperJobUid && (
            <a
              href={`https://app.zuperpro.com/jobs/${marker.zuperJobUid}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-2 text-foreground border border-t-border"
            >
              Open Zuper
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

/**
 * Deep-link for "Schedule this" / "Open in scheduler". Each kind maps to the
 * right existing scheduler page with the marker pre-selected.
 */
function scheduleLink(m: JobMarker): string | null {
  switch (m.kind) {
    case "install":
      return m.dealId ? `/dashboards/construction-scheduler?dealId=${m.dealId}` : null;
    case "inspection":
      return m.dealId ? `/dashboards/inspection-scheduler?dealId=${m.dealId}` : null;
    case "survey":
      return m.dealId ? `/dashboards/site-survey-scheduler?dealId=${m.dealId}` : null;
    case "service":
      if (m.ticketId) return `/dashboards/service-scheduler?ticketId=${m.ticketId}`;
      if (m.zuperJobUid) return `/dashboards/service-scheduler?jobUid=${m.zuperJobUid}`;
      return null;
    case "dnr":
      return m.dealId ? `/dashboards/dnr-scheduler?dealId=${m.dealId}` : null;
    case "roofing":
      return m.dealId ? `/dashboards/roofing-scheduler?dealId=${m.dealId}` : null;
    default:
      return null;
  }
}
