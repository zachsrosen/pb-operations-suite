// src/components/PropertyDrawer.tsx
//
// Reusable slide-in drawer for HubSpot Property records. Gated behind
// `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED` at the module level. The spec
// originally called for a server-component boundary gate, but the drawer is
// inherently a client component (portal, state, escape-close), so we instead
// read the public flag here as a belt-and-suspenders check. Consumers should
// ideally gate the mount-site with the same flag to avoid shipping this
// bundle for disabled users.
"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PropertyDetail } from "@/lib/property-detail";
import PropertyEquipmentList from "./property/PropertyEquipmentList";
import PropertyOwnershipList from "./property/PropertyOwnershipList";

const UI_PROPERTY_VIEWS_ENABLED =
  process.env.NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED === "true";

interface PropertyDrawerProps {
  open: boolean;
  onClose: () => void;
  /** HubSpot object ID of the property. When null/undefined, drawer shows a "no property record" state. */
  hubspotObjectId: string | null;
}

async function fetchPropertyDetail(
  hubspotObjectId: string,
): Promise<PropertyDetail> {
  const r = await fetch(`/api/properties/${hubspotObjectId}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data as PropertyDetail;
}

export default function PropertyDrawer({
  open,
  onClose,
  hubspotObjectId,
}: PropertyDrawerProps) {
  // Escape-close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const {
    data: detail,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["property", hubspotObjectId],
    queryFn: () => fetchPropertyDetail(hubspotObjectId as string),
    enabled: open && hubspotObjectId != null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? "";

  // Compute the Google Maps Static URL once per (hubspotObjectId, lat, lng).
  // Keying the <img> on hubspotObjectId + URL ensures the browser only issues
  // one request per drawer-open per property.
  const mapUrl = useMemo(() => {
    if (!detail || !mapsKey) return null;
    const { lat, lng } = detail;
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=600x300&maptype=satellite&markers=color:red%7C${lat},${lng}&key=${mapsKey}`;
  }, [detail, mapsKey]);

  // Feature flag: belt-and-suspenders — never render even if mistakenly mounted.
  if (!UI_PROPERTY_VIEWS_ENABLED) return null;
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-surface shadow-card-lg flex flex-col">
        {/* Sticky header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-border bg-surface-2 flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">Property</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* No property record state */}
          {hubspotObjectId == null && (
            <div className="px-5 py-8 text-center space-y-4">
              <div className="text-sm text-muted">No property record yet</div>
              {/* TODO(task-6.2): wire to POST /api/properties/manual-create when triggered from legacy record */}
              <button
                type="button"
                disabled
                title="Manual creation coming soon"
                className="inline-flex items-center rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-muted cursor-not-allowed opacity-60"
              >
                Create Property
              </button>
            </div>
          )}

          {/* Loading */}
          {hubspotObjectId != null && isLoading && (
            <div className="px-5 py-12 text-center">
              <div
                className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-t-border border-t-cyan-500"
                aria-hidden
              />
              <div className="text-sm text-muted">Loading property…</div>
            </div>
          )}

          {/* Error */}
          {hubspotObjectId != null && isError && !isFetching && (
            <div className="m-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center justify-between gap-3">
              <span>Failed to load property</span>
              <button
                onClick={() => refetch()}
                className="rounded-md border border-red-500/40 bg-red-500/20 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/30"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loaded */}
          {detail && (
            <div className="px-5 py-4 space-y-6">
              {/* Header block */}
              <section>
                <h3 className="text-lg font-semibold text-foreground break-words">
                  {detail.fullAddress}
                </h3>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-muted text-xs">PB Shop</div>
                    <div className="text-foreground">
                      {detail.pbLocation ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted text-xs">AHJ</div>
                    <div className="text-foreground truncate">
                      {detail.ahjName ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted text-xs">Utility</div>
                    <div className="text-foreground truncate">
                      {detail.utilityName ?? "—"}
                    </div>
                  </div>
                </div>
              </section>

              {/* Map thumbnail */}
              <section>
                {mapUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={detail.hubspotObjectId}
                    src={mapUrl}
                    alt={`Satellite view of ${detail.fullAddress}`}
                    width={600}
                    height={300}
                    className="w-full rounded-lg border border-t-border bg-surface-2"
                  />
                ) : (
                  <div className="flex h-[180px] w-full items-center justify-center rounded-lg border border-t-border bg-surface-2 text-sm text-muted">
                    Map unavailable
                  </div>
                )}
              </section>

              {/* Equipment installed */}
              <section>
                <h4 className="mb-2 text-sm font-semibold text-foreground">
                  Equipment installed
                </h4>
                <PropertyEquipmentList
                  summary={detail.equipmentSummary}
                  systemSizeKwDc={detail.systemSizeKwDc}
                  hasBattery={detail.hasBattery}
                  hasEvCharger={detail.hasEvCharger}
                />
              </section>

              {/* Owners all-time */}
              <section>
                <h4 className="mb-2 text-sm font-semibold text-foreground">
                  Owners all-time
                </h4>
                <PropertyOwnershipList
                  contactIds={detail.contactIds}
                  primaryLabel={detail.ownershipLabel}
                  primaryAssociatedAt={detail.associatedAt}
                />
              </section>

              {/* Deals */}
              <section>
                <h4 className="mb-2 text-sm font-semibold text-foreground">
                  Deals{" "}
                  <span className="text-muted font-normal">
                    ({detail.dealIds.length})
                  </span>
                </h4>
                {detail.dealIds.length === 0 ? (
                  <div className="text-sm text-muted">No deals linked yet.</div>
                ) : (
                  <ul className="divide-y divide-t-border rounded-xl border border-t-border bg-surface overflow-hidden">
                    {detail.dealIds.map((id) => (
                      <li
                        key={id}
                        className="px-4 py-2 flex items-center justify-between gap-3 text-sm"
                      >
                        <a
                          href={
                            portalId
                              ? `https://app.hubspot.com/contacts/${portalId}/deal/${id}`
                              : "#"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:underline"
                        >
                          {id}
                        </a>
                        <span className="text-xs text-muted">—</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Tickets */}
              <section>
                <h4 className="mb-2 text-sm font-semibold text-foreground flex items-center gap-2">
                  <span>
                    Tickets{" "}
                    <span className="text-muted font-normal">
                      ({detail.ticketIds.length})
                    </span>
                  </span>
                  {detail.openTicketsCount > 0 ? (
                    <span className="inline-flex items-center rounded-md bg-red-500/15 px-1.5 py-0.5 text-xs font-semibold text-red-400 ring-1 ring-red-500/30">
                      ⚠ {detail.openTicketsCount} open
                    </span>
                  ) : null}
                </h4>
                {detail.ticketIds.length === 0 ? (
                  <div className="text-sm text-muted">
                    No tickets linked yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-t-border rounded-xl border border-t-border bg-surface overflow-hidden">
                    {detail.ticketIds.map((id) => (
                      <li
                        key={id}
                        className="px-4 py-2 flex items-center justify-between gap-3 text-sm"
                      >
                        <a
                          href={
                            portalId
                              ? `https://app.hubspot.com/contacts/${portalId}/ticket/${id}`
                              : "#"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:underline"
                        >
                          {id}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Property details placeholder */}
              <section>
                <details className="rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm">
                  <summary className="cursor-pointer select-none font-medium text-foreground">
                    Property data enrichment
                  </summary>
                  <p className="mt-2 text-muted">
                    Coming soon — integration with property-data provider will
                    surface year built, square footage, roof material, etc.
                  </p>
                </details>
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
