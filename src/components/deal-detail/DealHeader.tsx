import type { SerializedDeal } from "./types";
import { formatMoney } from "@/lib/format";

interface DealHeaderProps {
  deal: SerializedDeal;
  stageColor: string;
}

function formatStageDuration(dateEnteredStr: string | null): string | null {
  if (!dateEnteredStr) return null;
  const entered = new Date(dateEnteredStr.split("T")[0] + "T00:00:00");
  if (isNaN(entered.getTime())) return null;
  const now = new Date();
  const days = Math.floor((now.getTime() - entered.getTime()) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export default function DealHeader({ deal, stageColor }: DealHeaderProps) {
  const stageDuration = formatStageDuration(
    (deal.dateEnteredCurrentStage as string | null) ?? null
  );

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
          {stageDuration && (
            <span className="text-[10px] text-muted">({stageDuration} in stage)</span>
          )}
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
