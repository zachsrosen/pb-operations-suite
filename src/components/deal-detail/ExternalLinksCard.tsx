import type { SerializedDeal } from "./types";

interface ExternalLinksCardProps {
  deal: SerializedDeal;
}

interface LinkItem {
  label: string;
  url: string | null;
}

export default function ExternalLinksCard({ deal }: ExternalLinksCardProps) {
  const designFolderUrl =
    (deal.designDocumentsUrl as string | null) ||
    (deal.designFolderUrl as string | null) ||
    (deal.allDocumentFolderUrl as string | null);

  const zuperUrl = deal.zuperUid
    ? `https://app.zuper.co/app/job-detail/${deal.zuperUid}`
    : null;

  const links: LinkItem[] = [
    { label: "HubSpot Record", url: deal.hubspotUrl },
    { label: "Zuper Job", url: zuperUrl },
    { label: "Google Drive", url: deal.driveUrl },
    { label: "Design Folder", url: designFolderUrl },
    { label: "OpenSolar", url: deal.openSolarUrl },
  ];

  const visibleLinks = links.filter((l) => l.url);

  if (visibleLinks.length === 0) return null;

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        External Links
      </h3>
      <div className="space-y-1">
        {visibleLinks.map((link) => (
          <a
            key={link.label}
            href={link.url!}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded px-1.5 py-1 text-xs text-orange-500 transition-colors hover:bg-surface-2/50"
          >
            {link.label}
            <span className="text-[10px] text-muted">↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}
