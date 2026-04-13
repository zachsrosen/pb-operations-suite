import type { SerializedDeal } from "./types";

interface ContactCardProps {
  deal: SerializedDeal;
}

export default function ContactCard({ deal }: ContactCardProps) {
  const hubspotContactUrl = deal.hubspotContactId
    ? `https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || ""}/record/0-1/${deal.hubspotContactId}`
    : null;

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Homeowner
      </h3>
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">
          {deal.customerName || "—"}
        </div>
        {deal.customerEmail && (
          <a
            href={`mailto:${deal.customerEmail}`}
            className="block text-xs text-orange-500 hover:underline"
          >
            {deal.customerEmail}
          </a>
        )}
        {deal.customerPhone && (
          <a
            href={`tel:${deal.customerPhone}`}
            className="block text-xs text-orange-500 hover:underline"
          >
            {deal.customerPhone}
          </a>
        )}
        {deal.companyName && (
          <div className="text-xs text-muted">{deal.companyName}</div>
        )}
        {hubspotContactUrl && (
          <a
            href={hubspotContactUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-[10px] text-muted hover:text-foreground"
          >
            View in HubSpot ↗
          </a>
        )}
      </div>
    </div>
  );
}
