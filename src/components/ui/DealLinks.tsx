"use client";

import Link from "next/link";
import { getHubSpotDealUrl, getInternalDealUrl, getZuperJobUrl } from "@/lib/external-links";

/**
 * Renders the three canonical deal-row links in a consistent color-coded order:
 *   Deal ↗     — purple, internal PB Ops Suite deal detail page
 *   HubSpot ↗  — orange, HubSpot deal record
 *   Zuper ↗    — cyan,   Zuper job (when linked)
 *
 * `dealId` is the HubSpot deal ID. `pipeline` is optional; the internal route
 * redirects to canonical if it's missing or wrong.
 */
export function DealLinks({
  dealId,
  zuperJobUid,
  pipeline,
}: {
  dealId: string;
  zuperJobUid?: string | null;
  pipeline?: string | null;
}) {
  const internalUrl = getInternalDealUrl(dealId, pipeline);
  const hubspotUrl = getHubSpotDealUrl(dealId);
  const zuperUrl = getZuperJobUrl(zuperJobUid);

  return (
    <div className="flex items-center justify-center gap-2">
      <Link
        href={internalUrl}
        className="text-purple-400 hover:text-purple-300 underline text-xs"
      >
        Deal ↗
      </Link>
      <a
        href={hubspotUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-orange-400 hover:text-orange-300 underline text-xs"
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
