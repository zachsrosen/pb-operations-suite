"use client";

import type { SerializedDeal } from "./types";
import { getZuperJobUrl, getHubSpotDealUrl } from "@/lib/external-links";

interface QuickActionsCardProps {
  deal: SerializedDeal;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

function ActionButton({
  label,
  icon,
  onClick,
  href,
  disabled,
  variant = "default",
}: {
  label: string;
  icon: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  variant?: "default" | "primary";
}) {
  const base =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-orange-500/15 text-orange-500 hover:bg-orange-500/25"
      : "bg-surface-2/50 text-foreground hover:bg-surface-2";

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} ${styles}`}
      >
        <span>{icon}</span>
        {label}
      </a>
    );
  }

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      <span>{icon}</span>
      {label}
    </button>
  );
}

export default function QuickActionsCard({
  deal,
  onRefresh,
  isRefreshing,
}: QuickActionsCardProps) {
  const zuperUrl = getZuperJobUrl(deal.zuperUid);

  const hubspotUrl = deal.hubspotUrl || getHubSpotDealUrl(deal.hubspotDealId);

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Quick Actions
      </h3>
      <div className="space-y-1">
        <ActionButton
          icon={isRefreshing ? "⟳" : "↻"}
          label={isRefreshing ? "Syncing…" : "Sync from HubSpot"}
          onClick={onRefresh}
          disabled={isRefreshing}
          variant="primary"
        />
        <ActionButton icon="↗" label="Open in HubSpot" href={hubspotUrl} />
        {zuperUrl && (
          <ActionButton icon="🔧" label="Open in Zuper" href={zuperUrl} />
        )}
        {deal.driveUrl && (
          <ActionButton icon="📁" label="Google Drive" href={deal.driveUrl} />
        )}
        {deal.openSolarUrl && (
          <ActionButton icon="☀" label="OpenSolar" href={deal.openSolarUrl} />
        )}
      </div>
    </div>
  );
}
