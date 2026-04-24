export function CorrespondenceTab({ searchUrl }: { searchUrl: string | null }) {
  return (
    <div className="space-y-3">
      <p className="text-muted text-sm">
        Opens Gmail pre-filtered to the AHJ email and site address. Thread
        summaries + AI rejection parsing are on the roadmap.
      </p>
      {searchUrl ? (
        <a
          href={searchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Open Gmail search →
        </a>
      ) : (
        <div className="text-muted text-sm">
          No AHJ email on file — link unavailable.
        </div>
      )}
    </div>
  );
}
