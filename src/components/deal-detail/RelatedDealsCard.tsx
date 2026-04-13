import Link from "next/link";
import type { RelatedDeal } from "./types";
import { formatMoney } from "@/lib/format";

interface RelatedDealsCardProps {
  deals: RelatedDeal[];
}

export default function RelatedDealsCard({ deals }: RelatedDealsCardProps) {
  if (deals.length === 0) return null;

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Related Deals
      </h3>
      <div className="space-y-1.5">
        {deals.map((d) => (
          <Link
            key={d.id}
            href={`/dashboards/deals/${d.pipeline.toLowerCase()}/${d.id}`}
            className="block rounded px-1.5 py-1 transition-colors hover:bg-surface-2/50"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-foreground leading-tight line-clamp-1">
                {d.dealName}
              </span>
              {d.amount != null && (
                <span className="whitespace-nowrap text-[10px] text-green-500">
                  {formatMoney(d.amount)}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="text-[9px] text-muted">{d.pipeline}</span>
              <span className="text-[9px] text-muted">•</span>
              <span className="text-[9px] text-orange-500">{d.stage}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
