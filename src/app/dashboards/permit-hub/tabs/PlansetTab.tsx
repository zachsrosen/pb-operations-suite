export function PlansetTab({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="text-muted text-sm">
        No planset Drive folder URL on this deal.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-muted text-sm">
        Stamped planset files live in Google Drive.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
      >
        Open planset folder →
      </a>
    </div>
  );
}
