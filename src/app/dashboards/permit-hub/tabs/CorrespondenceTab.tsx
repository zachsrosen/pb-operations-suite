import type { PermitProjectDetail } from "@/lib/permit-hub";

interface Props {
  searchUrl: string | null;
  threads: PermitProjectDetail["correspondenceThreads"];
  inbox: string | null;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameYear = d.getFullYear() === today.getFullYear();
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
  } catch {
    return iso;
  }
}

export function CorrespondenceTab({ searchUrl, threads, inbox }: Props) {
  const hasThreads = threads && threads.length > 0;

  return (
    <div className="space-y-4">
      <div className="text-muted flex items-center justify-between text-xs">
        <span>
          {inbox ? (
            <>
              Showing last {threads.length} thread{threads.length === 1 ? "" : "s"}{" "}
              from <span className="font-medium">{inbox}</span>
            </>
          ) : (
            "Shared inbox not configured for this region — showing Gmail search link only."
          )}
        </span>
        {searchUrl && (
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Open Gmail search →
          </a>
        )}
      </div>

      {hasThreads ? (
        <ul className="space-y-2">
          {threads.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border border-t-border p-3 transition-colors hover:bg-surface-2"
            >
              <a
                href={t.webUrl}
                target="_blank"
                rel="noreferrer"
                className="block"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {t.subject ?? "(no subject)"}
                    </div>
                    <div className="text-muted truncate text-xs">
                      {t.from ?? t.fromEmail ?? "—"}
                    </div>
                  </div>
                  <div className="text-muted shrink-0 text-xs">
                    {formatDate(t.date)}
                  </div>
                </div>
                {t.snippet && (
                  <div className="text-muted mt-1 line-clamp-2 text-xs">
                    {t.snippet}
                  </div>
                )}
              </a>
            </li>
          ))}
        </ul>
      ) : inbox ? (
        <div className="text-muted text-sm">
          No matching threads in the last 90 days.
        </div>
      ) : null}
    </div>
  );
}
