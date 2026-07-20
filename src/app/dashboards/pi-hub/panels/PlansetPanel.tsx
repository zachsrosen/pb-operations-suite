import { ACCENTS, type Accent } from "../accents";

/**
 * There is no separate "planset" property on the deal — this renders the same
 * `designFolderUrl` as the header's Design Folder button, so the copy names it
 * the design folder (the stamped plansets live inside it).
 */
export function PlansetPanel({
  url,
  accent,
}: {
  url: string | null;
  accent: Accent;
}) {
  if (!url) {
    return (
      <div className="text-muted text-sm">
        No design Drive folder URL on this deal.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-muted text-sm">
        Stamped planset files live in the design folder on Google Drive.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${ACCENTS[accent].primaryButton}`}
      >
        Open design folder →
      </a>
    </div>
  );
}
