export function PlansetTab({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="text-muted text-sm">
        No design folder URL on this deal.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-muted text-sm">
        Stamped planset and single-line diagrams for utility submission.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600"
      >
        Open design folder →
      </a>
    </div>
  );
}
