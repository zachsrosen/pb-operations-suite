"use client";

import type { PropertyDetail } from "@/lib/property-detail";
import { Skeleton } from "@/components/ui/Skeleton";

interface Props {
  property: PropertyDetail | null;
  loading: boolean;
  error: Error | null;
}

function formatSystemSize(kw: number | null): string {
  if (!kw) return "";
  return kw >= 1 ? `${kw.toFixed(1)} kW` : `${(kw * 1000).toFixed(0)} W`;
}

function formatCurrency(value: number | null | undefined): string {
  if (!value || value <= 0) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const ZUPER_WEB_BASE = "https://web.zuperpro.com";

export default function PropertyHubHeader({ property, loading, error }: Props) {
  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load property. Please try again.
      </div>
    );
  }

  if (loading || !property) {
    return (
      <div className="rounded-xl bg-surface border border-t-border p-6 space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <div className="flex gap-3">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
      </div>
    );
  }

  const systemSize = formatSystemSize(property.systemSizeKwDc);

  return (
    <div className="rounded-xl bg-surface border border-t-border p-6">
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
        {/* Address + Map */}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-foreground truncate">
            {property.fullAddress}
          </h1>

          {/* Badges */}
          <div className="flex flex-wrap gap-2 mt-3">
            {property.pbLocation && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {property.pbLocation}
              </span>
            )}
            {property.ahjName && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                AHJ: {property.ahjName}
              </span>
            )}
            {property.utilityName && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {property.utilityName}
              </span>
            )}
          </div>

          {/* Equipment chips — prefer summaries when available */}
          <div className="flex flex-wrap gap-2 mt-3">
            {property.moduleSummary ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                {property.moduleSummary}
              </span>
            ) : systemSize ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                {systemSize} System
              </span>
            ) : null}
            {property.inverterSummary && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {property.inverterSummary}
              </span>
            )}
            {property.batterySummary ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {property.batterySummary}
              </span>
            ) : property.hasBattery ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Battery
              </span>
            ) : null}
            {property.evChargerSummary ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                {property.evChargerSummary}
              </span>
            ) : property.hasEvCharger ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                EV Charger
              </span>
            ) : null}
            {property.openTicketsCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                {property.openTicketsCount} Open Ticket{property.openTicketsCount !== 1 ? "s" : ""}
              </span>
            )}
            {formatCurrency(property.totalDealValue) && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                {formatCurrency(property.totalDealValue)} Revenue
              </span>
            )}
          </div>

          {/* Owners */}
          {property.contacts.length > 0 && (
            <div className="mt-4">
              <span className="text-xs text-muted uppercase tracking-wider">
                Owners
              </span>
              <div className="flex flex-wrap gap-2 mt-1">
                {property.contacts.map((c) => (
                  <span
                    key={c.id}
                    className="text-sm text-foreground"
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex flex-col gap-2 shrink-0">
          {property.hubspotUrl && (
            <a
              href={property.hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-surface-2 border border-t-border text-foreground hover:bg-surface-elevated transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              Open in HubSpot
            </a>
          )}
          {property.zuperPropertyUid && (
            <a
              href={`${ZUPER_WEB_BASE}/property/${property.zuperPropertyUid}/details`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-surface-2 border border-t-border text-foreground hover:bg-surface-elevated transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              Open in Zuper
            </a>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(property.fullAddress);
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-surface-2 border border-t-border text-foreground hover:bg-surface-elevated transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            Copy Address
          </button>

          {/* Satellite map thumbnail */}
          {property.lat && property.lng && (
            <div className="mt-2 rounded-lg overflow-hidden border border-t-border w-[200px] h-[120px]">
              <img
                src={`https://maps.googleapis.com/maps/api/staticmap?center=${property.lat},${property.lng}&zoom=18&size=200x120&maptype=satellite&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""}`}
                alt="Satellite view"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
