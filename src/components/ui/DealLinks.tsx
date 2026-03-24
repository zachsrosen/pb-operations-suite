"use client";

import { getHubSpotDealUrl, getZuperJobUrl } from "@/lib/external-links";

export function DealLinks({
  dealId,
  zuperJobUid,
}: {
  dealId: string;
  zuperJobUid?: string | null;
}) {
  const hubspotUrl = getHubSpotDealUrl(dealId);
  const zuperUrl = getZuperJobUrl(zuperJobUid);

  return (
    <div className="flex items-center justify-center gap-2">
      <a
        href={hubspotUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-400 hover:text-emerald-300 underline text-xs"
      >
        HubSpot ↗
      </a>
      {zuperUrl && (
        <a
          href={zuperUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 underline text-xs"
        >
          Zuper ↗
        </a>
      )}
    </div>
  );
}
