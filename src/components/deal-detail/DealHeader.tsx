import type { SerializedDeal } from "./types";
import { formatMoney } from "@/lib/format";

interface DealHeaderProps {
  deal: SerializedDeal;
  stageColor: string;
}

export default function DealHeader({ deal, stageColor }: DealHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{deal.dealName}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span
            className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: stageColor }}
          >
            {deal.stage}
          </span>
          <span className="text-xs text-muted">{deal.pipeline}</span>
          {deal.pbLocation && (
            <span className="text-xs text-muted">• {deal.pbLocation}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {deal.amount != null && (
          <span className="text-lg font-semibold text-green-500">
            {formatMoney(deal.amount)}
          </span>
        )}
        {deal.hubspotUrl && (
          <a
            href={deal.hubspotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-500 transition-colors hover:bg-orange-500/20"
          >
            Open in HubSpot ↗
          </a>
        )}
      </div>
    </div>
  );
}
