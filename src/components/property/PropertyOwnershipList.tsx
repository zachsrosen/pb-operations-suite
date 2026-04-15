// src/components/property/PropertyOwnershipList.tsx
"use client";

import type { PropertyDetail } from "@/lib/property-detail";

/**
 * Renders the all-time owners list for a property.
 *
 * v1 limitation: the drawer API only returns the MOST RECENT contact link's
 * (label, associatedAt). v2 will lift full (label, associatedAt) tuples per
 * contact from the API; for now only the primary link is fully populated and
 * remaining contacts render as "Other associated contact" with no date.
 */
interface Props {
  contactIds: string[];
  primaryLabel: PropertyDetail["ownershipLabel"];
  primaryAssociatedAt: Date;
}

function formatDate(d: Date): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PropertyOwnershipList({
  contactIds,
  primaryLabel,
  primaryAssociatedAt,
}: Props) {
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID ?? "";
  const contactUrl = (id: string) =>
    portalId
      ? `https://app.hubspot.com/contacts/${portalId}/contact/${id}`
      : `#`;

  if (contactIds.length === 0) {
    return (
      <div className="text-sm text-muted">No contacts linked yet.</div>
    );
  }

  const [primaryId, ...rest] = contactIds;

  return (
    <ul className="divide-y divide-t-border rounded-xl border border-t-border bg-surface overflow-hidden">
      <li className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {primaryLabel}
            </div>
            <a
              href={contactUrl(primaryId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-400 hover:underline"
            >
              {primaryId}
            </a>
          </div>
          <div className="text-xs text-muted whitespace-nowrap">
            {formatDate(primaryAssociatedAt)}
          </div>
        </div>
      </li>
      {rest.map((id) => (
        <li key={id} className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Other associated contact
              </div>
              <a
                href={contactUrl(id)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-cyan-400 hover:underline"
              >
                {id}
              </a>
            </div>
            <div className="text-xs text-muted whitespace-nowrap">—</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
